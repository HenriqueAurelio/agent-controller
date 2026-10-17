import fs from 'node:fs';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { FlowEngine } from '@core/handoff/FlowEngine';
import { HandoffService } from '@core/handoff/HandoffService';
import { PtyManager } from '@core/pty/PtyManager';
import { SessionManager } from '@core/sessions/SessionManager';
import { sanitizeGroups } from '@core/store/appStore';
import {
  closesCycle,
  parseFlowRules,
  sanitizeFlow,
  type FlowRule,
  type FlowWhen,
} from '@shared/flows';
import { UserError } from '@shared/i18n';
import type { SessionGroup, SessionStatus } from '@shared/session';
import { DEFAULT_PREFERENCES } from '@shared/prefs';
import { removeDir, sleep, tempDir, waitFor } from './helpers';

const rule = (
  id: string,
  from: string,
  to: string,
  when: FlowWhen = 'turnEnded',
  extra: Partial<FlowRule> = {},
): FlowRule => ({ id, from, to, when, prompt: `go ${id}`, confirm: false, maxRounds: 3, ...extra });

describe('rules of a flow (shared)', () => {
  const members = new Set(['a', 'b', 'c']);

  it('finds the rules that close a cycle', () => {
    const rules = [rule('1', 'a', 'b'), rule('2', 'b', 'c'), rule('3', 'c', 'b')];
    expect(closesCycle(rules, rules[0]!)).toBe(false);
    expect(closesCycle(rules, rules[1]!)).toBe(true);
    expect(closesCycle(rules, rules[2]!)).toBe(true);
  });

  it('refuses a round limit outside 1..10, a rule with an outsider and an empty prompt', () => {
    const bad = (value: unknown) => {
      try {
        parseFlowRules(value, members);
      } catch (error) {
        return (error as UserError).key;
      }
      return null;
    };
    expect(bad([rule('1', 'a', 'b', 'turnEnded', { maxRounds: 0 })])).toBe('error.flow.rounds');
    expect(bad([rule('1', 'a', 'b', 'turnEnded', { maxRounds: 11 })])).toBe('error.flow.rounds');
    expect(bad([rule('1', 'a', 'x')])).toBe('error.flow.notInGroup');
    expect(bad([rule('1', 'a', 'a')])).toBe('error.flow.invalid');
    expect(bad([rule('1', 'a', 'b', 'turnEnded', { prompt: '  ' })])).toBe('error.flow.invalid');
    expect(bad([rule('1', 'a', 'b'), rule('1', 'b', 'c')])).toBe('error.flow.invalid');
    expect(bad('nope')).toBe('error.flow.invalid');
    expect(bad([rule('1', 'a', 'b', 'turnEnded', { maxRounds: 10 })])).toBeNull();
  });

  it('asks for confirmation unless the rule says otherwise', () => {
    const flow = sanitizeFlow({
      rules: [{ ...rule('1', 'a', 'b'), confirm: undefined }, rule('2', 'b', 'a')],
    });
    expect(flow?.rules[0]?.confirm).toBe(true);
    expect(flow?.rules[1]?.confirm).toBe(false);
  });

  it('loads groups saved before flows existed, and drops what does not fit', () => {
    const groups = sanitizeGroups([
      { id: 'g1', name: 'Velho', collapsed: false },
      {
        id: 'g2',
        name: 'Novo',
        collapsed: false,
        flow: { paused: true, rules: [rule('1', 'a', 'b'), { id: 'lixo' }, rule('2', 'b', 'b')] },
      },
      { id: 'g3', name: 'Quebrado', collapsed: false, flow: { rules: 'x' } },
    ]);
    expect(groups[0]?.flow).toBeUndefined();
    expect(groups[1]?.flow?.paused).toBe(true);
    expect(groups[1]?.flow?.rules.map((r) => r.id)).toEqual(['1']);
    expect(groups[2]?.flow).toBeUndefined();
  });
});

describe('FlowEngine', () => {
  let state: string;
  let ptys: PtyManager;
  let manager: SessionManager;
  let handoff: HandoffService;
  let engine: FlowEngine;
  let added: { to: string; text: string }[];
  let saved: SessionGroup[];
  let a: string;
  let b: string;
  let c: string;
  let groupId: string;
  let status: SessionStatus;

  beforeEach(() => {
    state = tempDir('ac flows ação-');
    ptys = new PtyManager();
    saved = [];
    manager = new SessionManager({
      ptys,
      sessions: [],
      selectedId: null,
      prefs: { ...DEFAULT_PREFERENCES, silenceSeconds: 0 },
      persist: (_sessions, _selected, groups) => {
        saved = groups;
      },
      resolveLaunch: () => ({ file: process.execPath, args: ['-e', ''], env: {} }),
    });
    status = { state: 'terminou', origin: 'hook', confirmed: true, since: 0 };
    vi.spyOn(manager, 'statusOf').mockImplementation(() => status);
    handoff = new HandoffService({ root: path.join(state, 'handoffs'), pollMs: 25, stableMs: 100 });
    added = [];
    a = manager.create({ name: 'planejar', cwd: state, profile: 'claude-code' }).id;
    b = manager.create({ name: 'implementar', cwd: state, profile: 'claude-code' }).id;
    c = manager.create({ name: 'revisar', cwd: state, profile: 'codex' }).id;
    groupId = manager.createGroup('Fluxo', [a, b, c]).id;
    engine = new FlowEngine({
      manager,
      handoff,
      checkpoints: { idle: async () => {}, latestPair: async () => null } as never,
      queue: {
        add: (to: string, input: { text: string }) => {
          added.push({ to, text: input.text });
          return {} as never;
        },
      },
      expand: async (_id, text) => text,
      watchMs: 500,
    });
    engine.start();
  });
  afterEach(async () => {
    engine.dispose();
    await manager.dispose(0);
    await ptys.killAll({ graceMs: 0 });
    vi.restoreAllMocks();
    removeDir(state);
  });

  const settle = () => sleep(80);

  it('goes around a cycle three times and then stops, saying why', async () => {
    engine.set(groupId, [rule('ida', b, c), rule('volta', c, b)]);
    for (let i = 0; i < 3; i++) {
      engine.turnEnded(b);
      await waitFor(() => added.filter((x) => x.to === c).length === i + 1);
      engine.turnEnded(c);
      await waitFor(() => added.filter((x) => x.to === b).length === i + 1);
    }
    expect(added).toHaveLength(6);
    engine.turnEnded(b);
    await waitFor(() => engine.get(groupId).paused);
    const flow = engine.get(groupId);
    expect(flow.reason).toBe('limit');
    expect(added).toHaveLength(6);
    expect(flow.history.at(-1)).toMatchObject({ kind: 'stopped', reason: 'limit' });
    manager.flushPersist();
    // The stop is kept with the group, and resuming starts the count again.
    expect(saved.find((g) => g.id === groupId)?.flow?.paused).toBe(true);
    engine.pause(groupId, false);
    expect(engine.get(groupId).rounds).toEqual({});
    engine.turnEnded(b);
    await waitFor(() => added.length === 7);
  });

  it('only prepares the send when the rule asks for confirmation, and sends on approval', async () => {
    engine.set(groupId, [rule('1', a, b, 'turnEnded', { confirm: true })]);
    engine.turnEnded(a);
    const pending = await waitFor(() => engine.get(groupId).pending[0]);
    expect(added).toEqual([]);
    expect(pending).toMatchObject({ fromId: a, toId: b, text: 'go 1' });
    expect(manager.list().find((s) => s.id === a)?.flow?.pending).toEqual([
      { id: pending.id, toId: b },
    ]);
    await engine.approve(groupId, pending.id);
    expect(added).toEqual([{ to: b, text: 'go 1' }]);
    expect(engine.get(groupId).pending).toEqual([]);
    expect(manager.list().find((s) => s.id === a)?.flow?.pending).toEqual([]);
    await expect(engine.approve(groupId, pending.id)).rejects.toMatchObject({
      key: 'error.flow.pendingGone',
    });
  });

  it('throws a prepared send away when asked', async () => {
    engine.set(groupId, [rule('1', a, b, 'turnEnded', { confirm: true })]);
    engine.turnEnded(a);
    const pending = await waitFor(() => engine.get(groupId).pending[0]);
    engine.discard(groupId, pending.id);
    expect(added).toEqual([]);
    expect(engine.get(groupId).history.map((h) => h.kind)).toEqual(['prepared', 'discarded']);
  });

  it('does not fire on a state that was only guessed', async () => {
    engine.set(groupId, [rule('1', a, b)]);
    status = { ...status, confirmed: false };
    engine.turnEnded(a);
    status = { ...status, confirmed: true, origin: 'silencio' };
    engine.turnEnded(a);
    await settle();
    expect(added).toEqual([]);
  });

  it('follows the checks, and only the outcome the rule is for', async () => {
    engine.set(groupId, [
      rule('ok', a, b, 'checksPassed'),
      rule('ruim', a, c, 'checksFailed', { prompt: 'conserte' }),
    ]);
    engine.checksFinished(a, 'failed');
    await waitFor(() => added.length === 1);
    expect(added[0]).toEqual({ to: c, text: 'conserte' });
    engine.checksFinished(a, 'passed');
    await waitFor(() => added.length === 2);
    expect(added[1]).toEqual({ to: b, text: 'go ok' });
  });

  it('stops by itself when a session of the flow asks something, and resumes on request', async () => {
    engine.set(groupId, [rule('1', a, b)]);
    engine.asking(c);
    expect(engine.get(groupId).paused).toBe(false);
    engine.asking(a);
    expect(engine.get(groupId)).toMatchObject({ paused: true, reason: 'question' });
    engine.turnEnded(a);
    await settle();
    expect(added).toEqual([]);
    engine.pause(groupId, false);
    expect(engine.get(groupId)).toMatchObject({ paused: false });
    expect(engine.get(groupId).reason).toBeUndefined();
    engine.turnEnded(a);
    await waitFor(() => added.length === 1);
  });

  it('drops the rules of a session that was closed in the middle', async () => {
    engine.set(groupId, [rule('1', a, b, 'turnEnded', { confirm: true }), rule('2', b, c)]);
    engine.turnEnded(a);
    await waitFor(() => engine.get(groupId).pending.length === 1);
    await manager.remove(b);
    const flow = engine.get(groupId);
    expect(flow.rules).toEqual([]);
    expect(flow.pending).toEqual([]);
    expect(manager.list().find((s) => s.id === a)?.flow).toBeUndefined();
    engine.turnEnded(a);
    await settle();
    expect(added).toEqual([]);
  });

  it('fills in the variables of the rule, with the files of the handoff folder', async () => {
    engine.set(groupId, [
      rule('1', a, b, 'turnEnded', {
        prompt: 'de {sessao_origem}: diff {diff_do_turno}, leia {saida}, escreva {saida_destino}',
      }),
    ]);
    engine.turnEnded(a);
    await waitFor(() => added.length === 1);
    const text = added[0]!.text;
    const files = handoff.files(a);
    expect(text).toContain('de planejar:');
    expect(text).toContain(`diff ${files.diffFile}`);
    expect(text).toContain(`leia ${files.reviewFile}`);
    expect(text).toContain(`escreva ${handoff.files(b).reviewFile}`);
    expect(fs.existsSync(files.diffFile)).toBe(true);
  });

  it('goes off when the session writes its file back, not for an answer from before', async () => {
    const out = handoff.files(c);
    fs.mkdirSync(out.dir, { recursive: true });
    fs.writeFileSync(out.reviewFile, 'resposta velha');
    await sleep(30);
    engine.set(groupId, [rule('1', c, b, 'fileWritten', { prompt: 'corrija {saida}' })]);
    await sleep(400);
    expect(added).toEqual([]);
    fs.writeFileSync(out.reviewFile, '- app.ts:1 — problema');
    await waitFor(() => added.length === 1);
    expect(added[0]).toEqual({ to: b, text: `corrija ${out.reviewFile}` });
    // The same file does not fire the rule again.
    await sleep(400);
    expect(added).toHaveLength(1);
  });

  it('refuses rules that leave the group, and keeps the old ones', () => {
    engine.set(groupId, [rule('1', a, b)]);
    const outsider = manager.create({ name: 'solta', cwd: state, profile: 'codex' }).id;
    expect(() => engine.set(groupId, [rule('1', a, outsider)])).toThrow(UserError);
    expect(engine.get(groupId).rules.map((r) => r.id)).toEqual(['1']);
    expect(() => engine.set(groupId, [rule('1', a, b, 'turnEnded', { maxRounds: 11 })])).toThrow(
      UserError,
    );
  });

  it('keeps the rules with the group, where sessions.json has them', () => {
    engine.set(groupId, [rule('1', a, b)]);
    manager.flushPersist();
    expect(saved.find((g) => g.id === groupId)?.flow).toEqual({
      rules: [rule('1', a, b)],
      paused: false,
    });
  });
});
