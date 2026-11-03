// The session resumes the conversation of its agent (ADR 0030).
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { buildLaunchCommand, type LaunchConversation } from '@core/agents/commandLine';
import type { AgentctlInstall } from '@core/signals/agentctlInstall';
import { CLAUDE_CODE, CODEX } from '@core/agents/profiles';
import { PtyManager } from '@core/pty/PtyManager';
import { SessionManager } from '@core/sessions/SessionManager';
import { createAppStore } from '@core/store/appStore';
import { DEFAULT_PREFERENCES } from '@shared/prefs';
import type { Session } from '@shared/session';
import { FIXTURES, removeDir, tempDir, waitFor } from './helpers';
import fs from 'node:fs';

const agentctl: AgentctlInstall = {
  program: '/home/dev/bin/agentctl',
  notify: ['/home/dev/bin/agentctl'],
  command: '/home/dev/bin/agentctl',
  directory: '/home/dev/bin',
};
const context = () => ({ agentctl, dataDirectory: tempDir(), socketPath: 'SOCKET' });

describe('the command line of a conversation', () => {
  it('opens Claude Code with the id the app chose, and resumes it', () => {
    const fresh = buildLaunchCommand(CLAUDE_CODE, { id: 's' }, context(), {
      id: 'c1',
      mode: 'new',
    });
    expect(fresh.args.slice(0, 2)).toEqual(['--session-id', 'c1']);
    const resumed = buildLaunchCommand(CLAUDE_CODE, { id: 's' }, context(), {
      id: 'c1',
      mode: 'resume',
    });
    expect(resumed.args.join(' ')).toContain('--resume c1');
    expect(resumed.args).not.toContain('--session-id');
  });

  it('resumes Codex with its subcommand first, and opens a new one with no id', () => {
    const resumed = buildLaunchCommand(CODEX, { id: 's' }, context(), { id: 't1', mode: 'resume' });
    expect(resumed.args.slice(0, 2)).toEqual(['resume', 't1']);
    expect(resumed.args).toContain('-c');
    const fresh = buildLaunchCommand(CODEX, { id: 's' }, context(), { id: 't1', mode: 'new' });
    expect(fresh.args).not.toContain('t1');
  });
});

describe('the conversation of a session', () => {
  let dir: string;
  let ptys: PtyManager;
  let manager: SessionManager;
  let launched: (LaunchConversation | undefined)[];
  let script: string;

  const build = (sessions: Session[] = []) => {
    manager = new SessionManager({
      ptys,
      sessions,
      groups: [],
      selectedId: null,
      prefs: { ...DEFAULT_PREFERENCES, silenceSeconds: 0 },
      persist: () => {},
      resolveLaunch: (_session, conversation) => {
        launched.push(conversation);
        return { file: process.execPath, args: [script], env: {} };
      },
    });
    return manager;
  };

  beforeEach(() => {
    dir = tempDir();
    ptys = new PtyManager();
    launched = [];
    script = path.join(FIXTURES, 'fake-agent.cjs');
  });
  afterEach(async () => {
    await manager.dispose(0);
    await ptys.killAll({ graceMs: 0 });
    removeDir(dir);
  });

  it('opens Claude Code with a new id, and resumes it on the next start', async () => {
    build();
    const s = manager.create({ name: 'A', cwd: dir, profile: 'claude-code' });
    manager.start(s.id);
    expect(launched[0]).toMatchObject({ mode: 'new' });
    const id = launched[0]!.id;
    expect(manager.get(s.id)!.conversationId).toBe(id);

    // The agent says it is another conversation now (a /clear inside it): that one is kept.
    manager.handleHook({
      sessionId: s.id,
      source: 'claude-hook',
      payload: { hook_event_name: 'SessionStart', session_id: 'outra-conversa' },
    });
    expect(manager.get(s.id)!.conversationId).toBe('outra-conversa');

    await manager.stop(s.id, 0);
    manager.start(s.id);
    expect(launched[1]).toEqual({ id: 'outra-conversa', mode: 'resume' });
  });

  it('learns the conversation of Codex from it, and opens without one before', async () => {
    build();
    const s = manager.create({ name: 'B', cwd: dir, profile: 'codex' });
    manager.start(s.id);
    expect(launched[0]).toBeUndefined();
    manager.handleHook({
      sessionId: s.id,
      source: 'codex-notify',
      payload: { type: 'agent-turn-complete', 'thread-id': 'thread-9', 'input-messages': ['oi'] },
    });
    expect(manager.get(s.id)!.conversationId).toBe('thread-9');
  });

  it('forgets a conversation that could not be resumed, and says so', async () => {
    // An agent that leaves at once with an error, as one with an unknown conversation does.
    script = path.join(dir, 'fails.cjs');
    fs.writeFileSync(script, 'process.exit(1);\n');
    build([
      {
        id: 's1',
        name: 'C',
        cwd: dir,
        profile: 'claude-code',
        conversationId: 'apagada',
        order: 0,
      },
    ]);
    manager.start('s1');
    expect(launched[0]).toEqual({ id: 'apagada', mode: 'resume' });
    await waitFor(() => !manager.get('s1')!.conversationId);
    const screen = (await manager.screenText('s1')).replace(/\s+/g, ' ');
    expect(screen).toContain('Retomando a conversa anterior.');
    expect(screen).toContain('Não foi possível retomar a conversa');
  });

  it('does not carry the conversation to a copy, nor to another folder, and starts over on request', async () => {
    const other = tempDir();
    try {
      build([
        { id: 's1', name: 'D', cwd: dir, profile: 'claude-code', conversationId: 'c-1', order: 0 },
      ]);
      const copy = manager.duplicate('s1');
      expect(manager.get(copy.id)!.conversationId).toBeUndefined();
      await manager.setCwd('s1', other);
      expect(manager.get('s1')!.conversationId).toBeUndefined();

      await manager.setCwd('s1', dir);
      manager.start('s1');
      const first = launched.at(-1)!;
      await manager.newConversation('s1');
      expect(launched.at(-1)).toMatchObject({ mode: 'new' });
      expect(launched.at(-1)!.id).not.toBe(first.id);
    } finally {
      removeDir(other);
    }
  });
});

describe('the conversation on disk', () => {
  it('keeps only an id that is plainly one', () => {
    const dir = tempDir();
    try {
      const store = createAppStore(dir);
      const data = store.load();
      store.save({
        ...data,
        sessions: [
          {
            id: 'a',
            name: 'a',
            cwd: dir,
            profile: 'claude-code',
            conversationId: 'ok-1',
            order: 0,
          },
          {
            id: 'b',
            name: 'b',
            cwd: dir,
            profile: 'codex',
            conversationId: 'x; rm -rf /',
            order: 1,
          },
        ],
      });
      const back = createAppStore(dir).load();
      expect(back.sessions.map((s) => s.conversationId)).toEqual(['ok-1', undefined]);
    } finally {
      removeDir(dir);
    }
  });
});
