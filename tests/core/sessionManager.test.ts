import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { CheckpointService } from '@core/git/CheckpointService';
import { isAlive } from '@core/pty/killTree';
import { turnEdge } from '@core/sessions/turns';
import { PtyManager } from '@core/pty/PtyManager';
import {
  BACKGROUND_FLUSH_MS,
  SessionManager,
  type SessionTransition,
} from '@core/sessions/SessionManager';
import { createSocketPath, HookServer } from '@core/signals/HookServer';
import { UserError } from '@shared/i18n';
import { DEFAULT_PREFERENCES } from '@shared/prefs';
import type { Session, SessionGroup, SessionState } from '@shared/session';
import { AGENTCTL_SCRIPT, FIXTURES, removeDir, sleep, tempDir, waitFor } from './helpers';

const SIZE = { cols: 100, rows: 30 };
const FAKE_AGENT = path.join(FIXTURES, 'fake-agent.cjs');

describe('SessionManager', () => {
  let dir: string;
  let ptys: PtyManager;
  let hooks: HookServer;
  let manager: SessionManager;
  let persisted: { sessions: Session[]; selectedId: string | null; groups: SessionGroup[] }[];
  let transitions: SessionTransition[];
  let data: Record<string, string>;
  let launch: (session: Session) => { file: string; args: string[] };

  const build = (
    sessions: Session[] = [],
    selectedId: string | null = null,
    groups: SessionGroup[] = [],
  ) => {
    manager = new SessionManager({
      ptys,
      sessions,
      groups,
      selectedId,
      prefs: { ...DEFAULT_PREFERENCES, silenceSeconds: 0 },
      persist: (s, selected, g) => persisted.push({ sessions: s, selectedId: selected, groups: g }),
      resolveLaunch: (session) => ({
        ...launch(session),
        env: {
          AGENTCTL_SESSION_ID: session.id,
          AGENTCTL_SOCKET: hooks.socketPath,
          FAKE_AGENTCTL: AGENTCTL_SCRIPT,
        },
      }),
    });
    manager.on('transition', (t) => transitions.push(t));
    manager.on('data', (id, chunk) => (data[id] = (data[id] ?? '') + chunk));
    return manager;
  };

  const states = (id: string): SessionState[] =>
    transitions.filter((t) => t.session.id === id).map((t) => t.session.status.state);
  const state = (id: string) => manager.statusOf(id).state;
  const until = (id: string, expected: SessionState) =>
    waitFor(() => state(id) === expected, { message: `${expected}, mas está em ${state(id)}` });
  const create = (name = 'Sessão', profile: Session['profile'] = 'claude-code') =>
    manager.create({ name, cwd: dir, profile });

  beforeEach(async () => {
    dir = tempDir();
    ptys = new PtyManager();
    persisted = [];
    transitions = [];
    data = {};
    launch = () => ({ file: process.execPath, args: [FAKE_AGENT] });
    hooks = new HookServer({
      socketPath: createSocketPath(),
      isKnownSession: (id) => manager.has(id),
    });
    hooks.on('message', (message) => manager.handleHook(message));
    await hooks.listen();
    build();
  });
  afterEach(async () => {
    await manager.dispose(0);
    await ptys.killAll({ graceMs: 0 });
    await hooks.close();
    removeDir(dir);
  });

  describe('list', () => {
    it('creates, renames, reorders and removes, persisting each step', async () => {
      const a = create('Primeira');
      const b = create('Segunda', 'codex');
      const c = create('Terceira');
      expect(manager.list().map((s) => [s.name, s.profile, s.order])).toEqual([
        ['Primeira', 'claude-code', 0],
        ['Segunda', 'codex', 1],
        ['Terceira', 'claude-code', 2],
      ]);
      expect(manager.selected).toBe(c.id);

      manager.rename(b.id, '  Renomeada  ');
      manager.rename(a.id, '   ');
      manager.reorder([c.id, a.id, b.id]);
      expect(manager.list().map((s) => s.name)).toEqual(['Terceira', 'Primeira', 'Renomeada']);

      await manager.remove(c.id);
      expect(manager.selected).toBe(a.id);
      manager.flushPersist();
      const last = persisted.at(-1)!;
      expect(last.sessions).toEqual([
        { id: a.id, name: 'Primeira', cwd: dir, profile: 'claude-code', order: 0 },
        { id: b.id, name: 'Renomeada', cwd: dir, profile: 'codex', order: 1 },
      ]);
      expect(last.selectedId).toBe(a.id);
    });

    it('refuses a session without a name or with a folder that does not exist', () => {
      expect(() => manager.create({ name: ' ', cwd: dir, profile: 'codex' })).toThrow(/nome/);
      expect(() =>
        manager.create({ name: 'x', cwd: path.join(dir, 'nao-existe'), profile: 'codex' }),
      ).toThrow(/não existe/);
    });

    it('duplicates a session right below it, in the same folder and with the same agent', () => {
      const a = create('API', 'codex');
      const b = create('Web');
      const copy = manager.duplicate(a.id);
      const again = manager.duplicate(copy.id);
      expect(manager.list().map((s) => [s.name, s.profile, s.cwd])).toEqual([
        ['API', 'codex', dir],
        ['API (2)', 'codex', dir],
        ['API (3)', 'codex', dir],
        ['Web', 'claude-code', dir],
      ]);
      expect(new Set([a.id, b.id, copy.id, again.id]).size).toBe(4);
      expect(manager.selected).toBe(again.id);
      expect(copy).toMatchObject({ running: false, status: { state: 'parada' } });
      manager.flushPersist();
      expect(persisted.at(-1)!.sessions.map((s) => [s.name, s.order])).toEqual([
        ['API', 0],
        ['API (2)', 1],
        ['API (3)', 2],
        ['Web', 3],
      ]);
    });

    it('keeps the command a session was created with, and a duplicate runs the same', () => {
      const work = manager.create({
        name: 'Trabalho',
        cwd: dir,
        profile: 'claude-code',
        command: '  claude-work --model opus  ',
      });
      expect(work.command).toBe('claude-work --model opus');
      expect(manager.duplicate(work.id).command).toBe('claude-work --model opus');
      // No command, or one that is not a line: the session has none.
      expect(create('Sem comando')).not.toHaveProperty('command');
      const broken = manager.create({
        name: 'Duas linhas',
        cwd: dir,
        profile: 'codex',
        command: 'a\nb',
      });
      expect(broken).not.toHaveProperty('command');
      manager.flushPersist();
      expect(persisted.at(-1)!.sessions.map((s) => s.command)).toEqual([
        'claude-work --model opus',
        'claude-work --model opus',
        undefined,
        undefined,
      ]);
    });

    it('moves a session to another folder, ending the agent that was running in the old one', async () => {
      const other = tempDir();
      try {
        const s = create();
        await expect(manager.setCwd(s.id, path.join(dir, 'nao-existe'))).rejects.toThrow(
          /não existe/,
        );
        await expect(manager.setCwd(s.id, FAKE_AGENT)).rejects.toThrow(/Não é uma pasta/);
        expect(manager.get(s.id)!.cwd).toBe(dir);

        expect(await manager.setCwd(s.id, other)).toBe(false);
        expect(manager.list()[0]!.cwd).toBe(other);
        manager.flushPersist();
        expect(persisted.at(-1)!.sessions[0]!.cwd).toBe(other);

        const cwds: string[] = [];
        launch = (session) => {
          cwds.push(session.cwd);
          return { file: process.execPath, args: [FAKE_AGENT] };
        };
        manager.start(s.id, SIZE);
        await until(s.id, 'aguardando');
        expect(cwds).toEqual([other]);

        // A folder that cannot be used leaves the running agent alone.
        await expect(manager.setCwd(s.id, path.join(dir, 'nao-existe'))).rejects.toThrow();
        expect(await manager.setCwd(s.id, other)).toBe(false);
        expect(manager.isRunning(s.id)).toBe(true);

        expect(await manager.setCwd(s.id, dir)).toBe(true);
        expect(manager.list()[0]).toMatchObject({ cwd: dir, running: false });
        expect(state(s.id)).toBe('parada');
      } finally {
        await manager.stopAll(0);
        removeDir(other);
      }
    });

    it('restores saved sessions as stopped, with the last selection', async () => {
      await manager.dispose(0);
      const saved: Session[] = [
        { id: 'b', name: 'B', cwd: dir, profile: 'codex', order: 1 },
        { id: 'a', name: 'A', cwd: dir, profile: 'claude-code', order: 0 },
      ];
      build(saved, 'b');
      expect(manager.list().map((s) => [s.id, s.status.state, s.running])).toEqual([
        ['a', 'parada', false],
        ['b', 'parada', false],
      ]);
      expect(manager.selected).toBe('b');
      expect(manager.runningSessions()).toEqual([]);
    });
  });

  describe('state from a running agent', () => {
    it('follows a turn: ready, working, finished', async () => {
      const s = create();
      manager.start(s.id, SIZE);
      await until(s.id, 'aguardando');
      expect(manager.list()[0]).toMatchObject({ running: true, hooks: 'active' });
      manager.input(s.id, 'work\r');
      await until(s.id, 'terminou');
      expect(states(s.id)).toEqual(['iniciando', 'aguardando', 'trabalhando', 'terminou']);
      expect(manager.statusOf(s.id)).toMatchObject({ origin: 'hook', confirmed: true });
    });

    it('the end of a turn takes one checkpoint, however many signals say the turn ended', async () => {
      const git = (...args: string[]) =>
        execFileSync('git', args, { cwd: dir, stdio: ['ignore', 'pipe', 'pipe'] });
      git('init', '-q');
      fs.writeFileSync(path.join(dir, 'a.txt'), 'um\n');
      const indexes = tempDir('ac-checkpoints-');
      const checkpoints = new CheckpointService({ directory: indexes, rootOf: async () => dir });
      const photos: string[] = [];
      checkpoints.on('changed', (id) => photos.push(id));
      // The same wiring as the app: the edge of the turn, not each signal of it.
      manager.on('transition', ({ session, previous }) => {
        if (turnEdge(session.status, previous) === 'ended') void checkpoints.turnEnded(session.id);
      });
      try {
        const s = create();
        manager.start(s.id, SIZE);
        await until(s.id, 'aguardando');
        fs.writeFileSync(path.join(dir, 'a.txt'), 'dois\n');
        manager.input(s.id, 'work\r');
        await until(s.id, 'terminou');
        await sleep(500);
        await checkpoints.idle(s.id);
        // The hook and the title both said "done": one photo.
        expect(photos).toEqual([s.id]);
        expect((await checkpoints.list(s.id)).items).toMatchObject([{ kind: 'turn', turn: 1 }]);
      } finally {
        removeDir(indexes);
      }
    });

    it('a permission request becomes "aguardando você" within 2 seconds', async () => {
      const s = create();
      manager.start(s.id, SIZE);
      await until(s.id, 'aguardando');
      manager.input(s.id, 'perm\r');
      await until(s.id, 'trabalhando');
      const started = Date.now();
      await until(s.id, 'aguardando');
      expect(Date.now() - started).toBeLessThan(2000);
      expect(manager.statusOf(s.id)).toMatchObject({ origin: 'hook', detail: 'Bash' });
    });

    it('hook messages only reach the session they name', async () => {
      const a = create('A');
      const b = create('B');
      manager.start(a.id, SIZE);
      manager.start(b.id, SIZE);
      await until(a.id, 'aguardando');
      await until(b.id, 'aguardando');
      manager.input(b.id, 'work\r');
      await until(b.id, 'terminou');
      expect(state(a.id)).toBe('aguardando');
      expect(states(a.id)).toEqual(['iniciando', 'aguardando']);
    });

    it('an agent that leaves on its own ends as "terminou" or "erro"', async () => {
      const ok = create('ok');
      const bad = create('ruim');
      manager.start(ok.id, SIZE);
      manager.start(bad.id, SIZE);
      await until(ok.id, 'aguardando');
      await until(bad.id, 'aguardando');
      manager.input(ok.id, 'exit 0\r');
      manager.input(bad.id, 'exit 7\r');
      await waitFor(() => !manager.isRunning(ok.id) && !manager.isRunning(bad.id));
      expect(state(ok.id)).toBe('terminou');
      expect(state(bad.id)).toBe('erro');
      expect(await manager.screenText(bad.id)).toContain('O agente saiu (código 7)');
    });

    it('stopping a session ends its process and leaves it "parada"; it can start again', async () => {
      const s = create();
      manager.start(s.id, SIZE);
      await until(s.id, 'aguardando');
      const pid = manager.pidOf(s.id)!;
      await manager.stop(s.id, 200);
      expect(state(s.id)).toBe('parada');
      expect(manager.isRunning(s.id)).toBe(false);
      await waitFor(() => !isAlive(pid));

      manager.start(s.id, SIZE);
      await until(s.id, 'aguardando');
      expect(manager.pidOf(s.id)).not.toBe(pid);
    });

    it('an agent that left says how to start it again, and Enter does it', async () => {
      const s = create();
      manager.start(s.id, SIZE);
      await until(s.id, 'aguardando');
      manager.input(s.id, 'exit 0\r');
      await waitFor(() => !manager.isRunning(s.id));
      expect(await manager.screenText(s.id)).toContain('Pressione Enter para iniciar de novo.');

      // Other keys do nothing while it is stopped.
      manager.input(s.id, 'x');
      expect(manager.isRunning(s.id)).toBe(false);
      manager.input(s.id, '\r');
      expect(manager.isRunning(s.id)).toBe(true);
      await until(s.id, 'aguardando');
    });

    it('gives the last lines of an agent with no terminal attached, and counts its output', async () => {
      const never = create('nunca');
      expect(manager.outputSeq(never.id)).toBe(0);
      expect(await manager.tail(never.id, 6)).toEqual([]);

      const s = create();
      manager.start(s.id, SIZE);
      await until(s.id, 'aguardando');
      const before = manager.outputSeq(s.id);
      expect(before).toBeGreaterThan(0);
      manager.input(s.id, 'exit 0\r');
      await waitFor(() => !manager.isRunning(s.id));
      expect(manager.outputSeq(s.id)).toBeGreaterThan(before);
      const tail = await manager.tail(s.id, 6);
      expect(tail.length).toBeLessThanOrEqual(6);
      expect(tail.at(-1)).toContain('Pressione Enter para iniciar de novo.');
    });

    it('an agent that cannot be opened ends in "erro", with the reason on screen', async () => {
      launch = () => {
        throw new Error('Codex não foi encontrado no PATH.');
      };
      const s = create('x', 'codex');
      manager.start(s.id, SIZE);
      expect(manager.statusOf(s.id)).toMatchObject({ state: 'erro' });
      expect(await manager.screenText(s.id)).toContain('Codex não foi encontrado no PATH.');
      expect(manager.isRunning(s.id)).toBe(false);
    });

    it('writes its notices in the language of the preferences', async () => {
      manager.setPreferences({ ...DEFAULT_PREFERENCES, silenceSeconds: 0, language: 'en' });
      launch = () => {
        throw new UserError('agent.missing', { name: 'Codex', command: 'npm install -g x' });
      };
      const s = create('x', 'codex');
      manager.start(s.id, SIZE);
      const reason = 'Codex was not found on the PATH. Install it with: npm install -g x';
      expect(manager.statusOf(s.id)).toMatchObject({ state: 'erro', detail: reason });
      expect(await manager.screenText(s.id)).toContain(`Could not start: ${reason}`);
    });

    it('removing a running session ends its process', async () => {
      const s = create();
      manager.start(s.id, SIZE);
      await until(s.id, 'aguardando');
      const pid = manager.pidOf(s.id)!;
      await manager.remove(s.id);
      expect(manager.has(s.id)).toBe(false);
      await waitFor(() => !isAlive(pid));
    });

    it('dispose ends every session, as closing the app does', async () => {
      const a = create('A');
      const b = create('B');
      manager.start(a.id, SIZE);
      manager.start(b.id, SIZE);
      await until(a.id, 'aguardando');
      await until(b.id, 'aguardando');
      const pids = [manager.pidOf(a.id)!, manager.pidOf(b.id)!];
      await manager.dispose(200);
      await waitFor(() => pids.every((pid) => !isAlive(pid)));
    });
  });

  describe('text pasted for the user', () => {
    it('goes to the agent as one line, in one paste, and waits there for Enter', async () => {
      const s = create();
      manager.start(s.id, SIZE);
      await until(s.id, 'aguardando');
      // What the app writes is what is checked: the bytes do not need to reach the real PTY.
      const write = vi.spyOn(ptys, 'write').mockImplementation(() => {});

      // No line break that could send it, and nothing that could end the paste or act as a key.
      manager.paste(s.id, 'linha um\r\n  indentada\n\n\x1b[201~fim\x03\rúltima\t ');
      expect(write.mock.calls).toEqual([
        [s.id, '\x1b[200~linha um ⏎ indentada ⏎ [201~fim ⏎ última\x1b[201~'],
      ]);
      write.mockRestore();
      await sleep(300);
      expect(state(s.id)).toBe('aguardando');
    });

    it('is refused when the agent is not running', () => {
      const s = create();
      expect(() => manager.paste(s.id, 'oi')).toThrow(UserError);
      expect(() => manager.sendText(s.id, 'oi', { submit: false })).toThrow(UserError);
    });
  });

  describe('prompts sent to agents', () => {
    const PASTE = (text: string) => `\x1b[200~${text}\x1b[201~`;

    it('go at once to a free agent, wait for the turn of a busy one, and can be cancelled', async () => {
      const free = create('Livre');
      const busy = create('Ocupada');
      const dropped = create('Cancelada');
      for (const s of [free, busy, dropped]) manager.start(s.id, SIZE);
      for (const s of [free, busy, dropped]) await until(s.id, 'aguardando');
      manager.input(busy.id, 'work\r');
      manager.input(dropped.id, 'work\r');
      await until(busy.id, 'trabalhando');
      await until(dropped.id, 'trabalhando');

      // Recorded, and still written: the fake agent ignores a line it does not know.
      const write = vi.spyOn(ptys, 'write');
      const sent = (id: string) => write.mock.calls.filter(([to]) => to === id).map(([, d]) => d);

      expect(manager.sendText(free.id, 'revise\no diff', { submit: false })).toBe('sent');
      expect(manager.sendText(busy.id, 'rode os testes', { submit: false })).toBe('queued');
      expect(manager.sendText(dropped.id, 'nunca', { submit: false })).toBe('queued');
      expect(sent(free.id)).toEqual([PASTE('revise ⏎ o diff')]);
      expect(sent(busy.id)).toEqual([]);
      const pending = () => manager.list().map((s) => [s.name, s.pendingSends]);
      expect(pending()).toEqual([
        ['Livre', undefined],
        ['Ocupada', 1],
        ['Cancelada', 1],
      ]);

      manager.cancelPending(dropped.id);
      await until(busy.id, 'terminou');
      await until(dropped.id, 'terminou');
      expect(sent(busy.id)).toEqual([PASTE('rode os testes')]);
      expect(sent(dropped.id)).toEqual([]);
      expect(pending()).toEqual([
        ['Livre', undefined],
        ['Ocupada', undefined],
        ['Cancelada', undefined],
      ]);
      write.mockRestore();
    });

    it('press Enter a moment after the paste when asked, and wait for nothing when told to', async () => {
      const s = create();
      manager.start(s.id, SIZE);
      await until(s.id, 'aguardando');
      manager.input(s.id, 'work\r');
      await until(s.id, 'trabalhando');
      const write = vi.spyOn(ptys, 'write').mockImplementation(() => {});

      expect(manager.sendText(s.id, 'já', { submit: true, now: true })).toBe('sent');
      expect(write.mock.calls).toEqual([[s.id, PASTE('já')]]);
      await waitFor(() => write.mock.calls.length === 2);
      expect(write.mock.calls[1]).toEqual([s.id, '\r']);
      write.mockRestore();
    });

    it('release one submitted text per turn, in order, and are dropped when the agent exits', async () => {
      const s = create();
      manager.start(s.id, SIZE);
      await until(s.id, 'aguardando');
      manager.input(s.id, 'work\r');
      await until(s.id, 'trabalhando');
      const write = vi.spyOn(ptys, 'write').mockImplementation(() => {});
      manager.sendText(s.id, 'primeiro', { submit: false });
      manager.sendText(s.id, 'segundo', { submit: true });
      manager.sendText(s.id, 'terceiro', { submit: true });
      await until(s.id, 'terminou');
      await waitFor(() => write.mock.calls.some(([, data]) => data === '\r'));
      // The third would land in the middle of the turn the second starts.
      expect(write.mock.calls.map(([, data]) => data)).toEqual([
        PASTE('primeiro'),
        PASTE('segundo'),
        '\r',
      ]);
      expect(manager.list()[0]!.pendingSends).toBe(1);
      write.mockRestore();

      manager.input(s.id, 'exit 0\r');
      await until(s.id, 'terminou');
      await waitFor(() => !manager.isRunning(s.id));
      expect(manager.list()[0]!.pendingSends).toBeUndefined();
    });

    it('wait while the agent asks for a permission, where a paste would answer it', async () => {
      const s = create();
      manager.start(s.id, SIZE);
      await until(s.id, 'aguardando');
      manager.input(s.id, 'perm\r');
      await waitFor(() => manager.statusOf(s.id).detail === 'Bash');
      expect(manager.sendText(s.id, 'depois', { submit: false })).toBe('queued');
    });
  });

  describe('permission requests answered from outside the terminal', () => {
    const MENU = path.join(FIXTURES, 'permission-menu.cjs');
    const ask = (id: string) => manager.list().find((s) => s.id === id)?.permission;
    const opened = (args: string[]) => {
      launch = () => ({ file: process.execPath, args: [MENU, ...args] });
      const s = create();
      manager.start(s.id, SIZE);
      return s;
    };
    const screenHas = (id: string, text: string) =>
      waitFor(async () => (await manager.screenText(id)).includes(text), { message: text });

    it('shows the request once its menu is on screen, and answers with the key of the menu', async () => {
      const shown: string[] = [];
      manager.on('permission', (session) => shown.push(session.id));
      const s = opened(['Bash', 'npm', 'install']);
      const request = await waitFor(() => ask(s.id));
      expect(request).toMatchObject({
        tool: 'Bash',
        target: 'npm install',
        choices: ['allow', 'allowAlways', 'deny'],
      });
      expect(state(s.id)).toBe('aguardando');
      expect(shown).toEqual([s.id]);

      expect(await manager.answerPermission(s.id, request.id, 'allow')).toBe('answered');
      await screenHas(s.id, 'resposta: 1');
      expect(ask(s.id)).toBeUndefined();
      // Answered once: the same request cannot be answered again.
      expect(await manager.answerPermission(s.id, request.id, 'allow')).toBe('stale');
    });

    it('denies with Esc, and "always" with the option the menu offers for it', async () => {
      const denied = opened(['Edit', 'src/app.ts']);
      const always = opened(['Bash', 'npm', 'test']);
      const first = await waitFor(() => ask(denied.id));
      expect(first).toMatchObject({ tool: 'Edit', target: 'src/app.ts' });
      expect(await manager.answerPermission(denied.id, first.id, 'deny')).toBe('answered');
      const second = await waitFor(() => ask(always.id));
      expect(await manager.answerPermission(always.id, second.id, 'allowAlways')).toBe('answered');
      await screenHas(denied.id, 'resposta: esc');
      await screenHas(always.id, 'resposta: 2');
    });

    it('a request that was replaced by another is stale, and nothing is written', async () => {
      const s = opened(['Bash', 'npm', 'install']);
      const old = await waitFor(() => ask(s.id));
      // The agent asks something else before the click arrives.
      manager.handleHook({
        sessionId: s.id,
        source: 'claude-hook',
        payload: {
          hook_event_name: 'PermissionRequest',
          tool_name: 'Bash',
          tool_input: { command: 'npm publish' },
        },
      });
      const replaced = await waitFor(() => {
        const current = ask(s.id);
        return current && current.id !== old.id ? current : null;
      });
      expect(replaced.target).toBe('npm publish');
      const write = vi.spyOn(ptys, 'write');
      expect(await manager.answerPermission(s.id, old.id, 'allow')).toBe('stale');
      expect(write).not.toHaveBeenCalled();
      write.mockRestore();
      expect(await manager.answerPermission(s.id, replaced.id, 'deny')).toBe('answered');
      await screenHas(s.id, 'resposta: esc');
    });

    it('a menu that left the screen is stale: nothing is written and the buttons go', async () => {
      const s = opened(['Bash', 'npm', 'install']);
      const request = await waitFor(() => ask(s.id));
      fs.writeFileSync(path.join(dir, 'limpar'), '');
      await screenHas(s.id, 'o agente seguiu sozinho');
      const write = vi.spyOn(ptys, 'write');
      expect(await manager.answerPermission(s.id, request.id, 'allow')).toBe('stale');
      expect(write).not.toHaveBeenCalled();
      write.mockRestore();
      expect(ask(s.id)).toBeUndefined();
      await sleep(300);
      expect(await manager.screenText(s.id)).not.toContain('resposta');
    });

    it('"always" is only there when the menu offers it; the request goes when the agent stops', async () => {
      const s = opened(['--sem-sempre', 'Bash', 'curl', 'exemplo.com']);
      const request = await waitFor(() => ask(s.id));
      expect(request.choices).toEqual(['allow', 'deny']);
      expect(await manager.answerPermission(s.id, request.id, 'allowAlways')).toBe('unsupported');
      expect(ask(s.id)).toBeDefined();
      await manager.stop(s.id);
      await until(s.id, 'parada');
      expect(ask(s.id)).toBeUndefined();
      expect(await manager.answerPermission(s.id, request.id, 'allow')).toBe('stale');
    });

    it('a session that is gone is an error for the user', async () => {
      await expect(manager.answerPermission('nao-existe', 'x', 'allow')).rejects.toThrow(UserError);
    });
  });

  describe('groups', () => {
    const names = () => manager.list().map((s) => [s.name, s.groupId ?? null]);
    const nameOf = (id: string | undefined) =>
      manager.listGroups().find((g) => g.id === id)?.name ?? null;
    const layout = () => manager.list().map((s) => `${nameOf(s.groupId) ?? '-'}/${s.name}`);

    it('lists the sessions with no group first, then each group with its own, in order', () => {
      const a = create('A');
      const b = create('B');
      const c = create('C');
      const d = create('D');
      const api = manager.createGroup('  api-repo  ', [c.id, a.id]);
      const web = manager.createGroup('web', [b.id]);
      expect(manager.listGroups()).toEqual([
        { id: api.id, name: 'api-repo', collapsed: false },
        { id: web.id, name: 'web', collapsed: false },
      ]);
      // Joining keeps the order the sessions had among themselves.
      expect(layout()).toEqual(['-/D', 'api-repo/A', 'api-repo/C', 'web/B']);
      expect(manager.list().map((s) => s.order)).toEqual([0, 1, 2, 3]);

      manager.reorderGroups([web.id, api.id]);
      expect(layout()).toEqual(['-/D', 'web/B', 'api-repo/A', 'api-repo/C']);

      // A reorder never takes a session out of its group.
      manager.reorder([c.id, d.id, b.id, a.id]);
      expect(layout()).toEqual(['-/D', 'web/B', 'api-repo/C', 'api-repo/A']);
    });

    it('moves sessions in and out of a group; one that joins goes to its end', () => {
      const a = create('A');
      const b = create('B');
      const c = create('C');
      const g = manager.createGroup('repo', [b.id, c.id]);
      manager.setGroup([a.id], g.id);
      expect(layout()).toEqual(['repo/B', 'repo/C', 'repo/A']);
      manager.setGroup([c.id], null);
      expect(layout()).toEqual(['-/C', 'repo/B', 'repo/A']);
      expect(manager.list()[0]).not.toHaveProperty('groupId');
      expect(() => manager.setGroup([a.id], 'nope')).toThrow(UserError);
    });

    it('edits a group: its name, folding, and exactly the sessions it holds', () => {
      const a = create('A');
      const b = create('B');
      const c = create('C');
      const g = manager.createGroup('repo', [a.id, b.id]);
      manager.updateGroup(g.id, { name: 'repo-novo', collapsed: true, sessionIds: [b.id, c.id] });
      expect(manager.listGroups()).toEqual([{ id: g.id, name: 'repo-novo', collapsed: true }]);
      expect(layout()).toEqual(['-/A', 'repo-novo/B', 'repo-novo/C']);
      expect(() => manager.updateGroup(g.id, { name: '   ' })).toThrow(UserError);
      expect(() => manager.createGroup('')).toThrow(UserError);
      expect(manager.listGroups()[0]!.name).toBe('repo-novo');
    });

    it('removing a group keeps its sessions, with no group', () => {
      const a = create('A');
      const b = create('B');
      const g = manager.createGroup('repo', [a.id]);
      manager.removeGroup(g.id);
      expect(manager.listGroups()).toEqual([]);
      // They stay where they were seen: below the ones that had no group.
      expect(names()).toEqual([
        ['B', null],
        ['A', null],
      ]);
      expect(manager.has(a.id) && manager.has(b.id)).toBe(true);
    });

    it('a session is created in a group, and its duplicate stays in it', () => {
      create('Solta');
      const g = manager.createGroup('repo');
      const s = manager.create({ name: 'Nova', cwd: dir, profile: 'codex', groupId: g.id });
      expect(s.groupId).toBe(g.id);
      manager.duplicate(s.id);
      expect(layout()).toEqual(['-/Solta', 'repo/Nova', 'repo/Nova (2)']);
      expect(() =>
        manager.create({ name: 'X', cwd: dir, profile: 'codex', groupId: 'nope' }),
      ).toThrow(UserError);
    });

    it('persists the groups and comes back with them; a group that is gone drops its sessions out', async () => {
      const a = create('A');
      create('B');
      const g = manager.createGroup('repo', [a.id]);
      manager.updateGroup(g.id, { collapsed: true });
      manager.flushPersist();
      const saved = persisted.at(-1)!;
      expect(saved.groups).toEqual([{ id: g.id, name: 'repo', collapsed: true }]);
      expect(saved.sessions.map((s) => [s.name, s.groupId ?? null])).toEqual([
        ['B', null],
        ['A', g.id],
      ]);

      await manager.dispose(0);
      build(saved.sessions, null, saved.groups);
      expect(layout()).toEqual(['-/B', 'repo/A']);
      expect(manager.listGroups()[0]!.collapsed).toBe(true);

      await manager.dispose(0);
      build(saved.sessions, null, []);
      expect(names()).toEqual([
        ['B', null],
        ['A', null],
      ]);
    });
  });

  describe('checks', () => {
    it('the latest run shows in the list until the app closes, and is not persisted', () => {
      const s = create();
      manager.setChecks(s.id, { state: 'failed', failed: 1, total: 2 });
      expect(manager.list()[0]!.checks).toEqual({ state: 'failed', failed: 1, total: 2 });
      manager.flushPersist();
      expect(persisted.at(-1)!.sessions[0]).not.toHaveProperty('checks');
      manager.setChecks(s.id, undefined);
      expect(manager.list()[0]).not.toHaveProperty('checks');
    });
  });

  describe('unread marker and focus', () => {
    it('marks a session that finished while another one was selected', async () => {
      const a = create('A');
      const b = create('B');
      manager.start(a.id, SIZE);
      await until(a.id, 'aguardando');
      expect(manager.list()[0]!.unread).toBe(false); // "Ready" is not news.
      manager.select(b.id);
      manager.input(a.id, 'work\r');
      await until(a.id, 'terminou');
      expect(manager.list()[0]!.unread).toBe(true);
      manager.select(a.id);
      expect(manager.list()[0]!.unread).toBe(false);
    });

    it('does not mark the session in focus, unless the window is in the background', async () => {
      const a = create('A');
      manager.start(a.id, SIZE);
      await until(a.id, 'aguardando');
      manager.input(a.id, 'work\r');
      await until(a.id, 'terminou');
      expect(manager.list()[0]!.unread).toBe(false);

      manager.setWindowFocused(false);
      manager.input(a.id, 'work\r');
      await waitFor(() => states(a.id).filter((s) => s === 'terminou').length === 2);
      expect(manager.list()[0]!.unread).toBe(true);
      manager.setWindowFocused(true);
      expect(manager.list()[0]!.unread).toBe(false);
    });
  });

  describe('terminal stream', () => {
    it('sends nothing while no terminal is mounted, and a snapshot when one is', async () => {
      const s = create();
      manager.start(s.id, SIZE);
      await until(s.id, 'aguardando');
      await sleep(100);
      expect(data[s.id]).toBeUndefined();
      expect(manager.attachedCount()).toBe(0);

      // Same size as the PTY: a resize makes the Windows console repaint the whole screen.
      const snapshot = await manager.attach(s.id, SIZE);
      expect(snapshot).toMatchObject(SIZE);
      expect(snapshot.data).toContain('pronto>');
      expect(manager.attachedCount()).toBe(1);

      manager.setVisible(s.id, true);
      manager.input(s.id, 'work\r');
      await waitFor(() => data[s.id]?.includes('feito'));
      // What came before the snapshot is not sent again. (The Windows console repaints whole
      // lines on its own, so there the check would not mean anything.)
      if (process.platform !== 'win32') expect(data[s.id]).not.toContain('pronto>');
    });

    it('a remounted terminal gets back the same screen', async () => {
      const s = create();
      manager.start(s.id, SIZE);
      await until(s.id, 'aguardando');
      await manager.attach(s.id, SIZE);
      manager.input(s.id, 'work\r');
      await until(s.id, 'terminou');
      const before = await manager.screenText(s.id);
      manager.detach(s.id);
      expect(manager.attachedCount()).toBe(0);
      const snapshot = await manager.attach(s.id, SIZE);
      expect(snapshot.data).toContain('feito');
      expect(await manager.screenText(s.id)).toBe(before);
    });

    it('a mounted terminal in the background is fed in slow batches', async () => {
      const s = create();
      manager.start(s.id, SIZE);
      await until(s.id, 'aguardando');
      await manager.attach(s.id, SIZE);
      let events = 0;
      manager.on('data', () => events++);
      manager.input(s.id, 'spam 300\r');
      await waitFor(async () => (await manager.screenText(s.id)).includes('fim-do-spam'));
      await sleep(BACKGROUND_FLUSH_MS + 100);
      expect(data[s.id]).toContain('fim-do-spam');
      expect(events).toBeLessThan(20);
    });

    it('a flood of output is held back when the renderer does not keep up, and nothing is lost', async () => {
      const s = create();
      manager.start(s.id, SIZE);
      await until(s.id, 'aguardando');
      await manager.attach(s.id, SIZE);
      manager.setVisible(s.id, true);
      let sent = 0;
      let peak = 0;
      let acked = 0;
      manager.on('data', (_id, chunk) => {
        sent += chunk.length;
        peak = Math.max(peak, sent - acked);
      });
      manager.input(s.id, 'spam 20000\r'); // About 4 MB.
      await sleep(1500);
      // Without acknowledgements the PTY is paused long before everything is read.
      expect(sent).toBeLessThan(1024 * 1024);
      expect(data[s.id]).not.toContain('fim-do-spam');

      const drain = setInterval(() => {
        manager.ack(s.id, sent - acked);
        acked = sent;
      }, 5);
      try {
        await waitFor(() => data[s.id]?.includes('fim-do-spam'), { timeout: 30000 });
      } finally {
        clearInterval(drain);
      }
      expect(sent).toBeGreaterThan(4 * 1000 * 1000);
      expect(peak).toBeLessThan(1024 * 1024);
    }, 40000);

    it('state signals keep arriving while the terminal output is held back', async () => {
      const s = create();
      manager.start(s.id, SIZE);
      await until(s.id, 'aguardando');
      // No terminal mounted at all: the parser still reads everything.
      manager.input(s.id, 'spam 2000\r');
      manager.input(s.id, 'work\r');
      // 400 KB of output first: on a busy machine this alone can take several seconds.
      await waitFor(() => state(s.id) === 'terminou', { timeout: 40000 }).catch(async (err) => {
        const screen = (await manager.screenText(s.id)).split('\n').slice(-6).join('\n');
        throw new Error(`${err.message}\nestados: ${states(s.id).join(' → ')}\ntela:\n${screen}`);
      });
      expect(data[s.id]).toBeUndefined();
    }, 60000);

    it('a restart clears the mounted terminal', async () => {
      const s = create();
      const resets: string[] = [];
      manager.on('reset', (id) => resets.push(id));
      manager.start(s.id, SIZE);
      await until(s.id, 'aguardando');
      await manager.attach(s.id, SIZE);
      manager.input(s.id, 'exit 0\r');
      await waitFor(() => !manager.isRunning(s.id));
      manager.start(s.id, SIZE);
      expect(resets).toEqual([s.id, s.id]);
      await until(s.id, 'aguardando');
      expect(await manager.screenText(s.id)).not.toContain('O agente saiu');
    });
  });
});
