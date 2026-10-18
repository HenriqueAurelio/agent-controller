import fs from 'node:fs';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { PromptQueue, readyForQueue, type QueueAgentState } from '@core/prompts/PromptQueue';
import type { ChecksRun } from '@shared/checks';
import { UserError } from '@shared/i18n';
import { QUEUE_LIMIT, type QueueItem } from '@shared/prompts';
import { STATUS_DETAIL, type SessionState, type SessionStatus } from '@shared/session';
import { removeDir, tempDir } from './helpers';

const S = 'sessao-1';

const status = (
  state: SessionState,
  extra: Partial<SessionStatus> = {},
  at = Date.now(),
): SessionStatus => ({ state, origin: 'hook', confirmed: true, since: at, ...extra });

const run = (state: ChecksRun['state'], outcomes: ('passed' | 'failed')[] = []): ChecksRun => ({
  trigger: 'manual',
  state,
  startedAt: 0,
  checks: outcomes.map((_, i) => ({ id: `c${i}`, label: `c${i}`, command: 'x' })),
  results: outcomes.map((outcome, i) => ({
    id: `c${i}`,
    label: `c${i}`,
    command: 'x',
    outcome,
    exitCode: outcome === 'passed' ? 0 : 1,
    durationMs: 1,
    output: '',
    truncated: false,
    problems: [],
    moreProblems: 0,
  })),
});

describe('PromptQueue', () => {
  let dir: string;
  let agent: QueueAgentState;
  let delivered: string[];
  let checksAsked: number;
  let hasChecks: boolean;
  let failDelivery: boolean;
  let queue: PromptQueue;

  const build = (sessionIds = [S]) => {
    queue = new PromptQueue({
      directory: dir,
      sessionIds,
      stateOf: (id) => (sessionIds.includes(id) ? agent : null),
      deliver: async (_id, item: QueueItem) => {
        if (failDelivery) throw new Error('grande demais');
        delivered.push(item.text);
      },
      runChecks: () => {
        checksAsked++;
        return hasChecks;
      },
    });
    return queue;
  };

  /** The agent goes from `agent.status` to `state`, as the session manager reports it. */
  const move = async (state: SessionState, extra: Partial<SessionStatus> = {}) => {
    const previous = agent.status;
    agent = { ...agent, status: status(state, extra) };
    queue.onTransition(S, agent.status, previous, agent.running);
    // Delivery is async: let it settle.
    await vi.runAllTimersAsync();
  };
  /** One turn of the agent: it works on what it got, then ends. */
  const turn = async () => {
    await move('trabalhando');
    await move('terminou');
  };

  beforeEach(() => {
    vi.useFakeTimers();
    dir = path.join(tempDir('ac-queue-'), 'queues');
    agent = { running: true, status: status('trabalhando') };
    delivered = [];
    checksAsked = 0;
    hasChecks = true;
    failDelivery = false;
    build();
  });

  afterEach(() => {
    vi.useRealTimers();
    removeDir(path.dirname(dir));
  });

  it('sends one item per turn, in order, each when the turn before it ends', async () => {
    queue.add(S, { text: 'implemente' });
    queue.add(S, { text: 'escreva os testes' });
    queue.add(S, { text: 'atualize o README' });
    await vi.runAllTimersAsync();
    expect(delivered).toEqual([]); // The agent is working.
    expect(queue.summary(S)).toEqual({ items: 3, paused: false });

    await move('terminou');
    expect(delivered).toEqual(['implemente']);
    // Still "done" from before the item: nothing else goes until the agent moves.
    queue.onTransition(S, agent.status, agent.status, true);
    await vi.runAllTimersAsync();
    expect(delivered).toEqual(['implemente']);

    await turn();
    expect(delivered).toEqual(['implemente', 'escreva os testes']);
    await turn();
    expect(delivered).toEqual(['implemente', 'escreva os testes', 'atualize o README']);
    expect(queue.get(S).items).toEqual([]);
    expect(queue.summary(S)).toBeUndefined();
  });

  it('gives a free agent the first item at once, and the next one only after its turn', async () => {
    agent = { running: true, status: status('aguardando', { detail: STATUS_DETAIL.ready }) };
    queue.add(S, { text: 'um' });
    await vi.runAllTimersAsync();
    expect(delivered).toEqual(['um']);
    // Added before the agent started on the first: it waits.
    queue.add(S, { text: 'dois' });
    await vi.runAllTimersAsync();
    expect(delivered).toEqual(['um']);
    await turn();
    expect(delivered).toEqual(['um', 'dois']);
  });

  it('an item put in after the queue emptied goes at once to an agent that finished since', async () => {
    queue.add(S, { text: 'um' });
    await move('terminou');
    expect(delivered).toEqual(['um']);
    await turn();
    queue.add(S, { text: 'dois' });
    await vi.runAllTimersAsync();
    expect(delivered).toEqual(['um', 'dois']);
  });

  it('never moves on "waiting": a permission in the middle waits for the next "done"', async () => {
    queue.add(S, { text: 'um' });
    queue.add(S, { text: 'dois' });
    await move('terminou');
    expect(delivered).toEqual(['um']);
    await move('trabalhando');
    await move('aguardando', { detail: 'Bash' });
    expect(queue.get(S).blockedBy).toBe('agentAsks');
    expect(delivered).toEqual(['um']);
    // The idle notice of Claude Code is "waiting" too, and moves nothing.
    await move('aguardando', { detail: STATUS_DETAIL.idle });
    expect(delivered).toEqual(['um']);
    await move('trabalhando');
    expect(queue.get(S).blockedBy).toBeUndefined();
    await move('terminou');
    expect(delivered).toEqual(['um', 'dois']);
  });

  it('does not move on a state guessed from silence', async () => {
    queue.add(S, { text: 'um' });
    await move('terminou', { confirmed: false, origin: 'silencio' });
    expect(delivered).toEqual([]);
    // The user's click sends it.
    await queue.sendNext(S);
    expect(delivered).toEqual(['um']);
  });

  it('waits for the checks when the item asks, and stops when they fail', async () => {
    queue.add(S, { text: 'com verificação', condition: 'checksPassed' });
    queue.add(S, { text: 'depois' });
    await move('terminou');
    expect(checksAsked).toBe(1);
    expect(queue.get(S).checking).toBe(true);
    expect(delivered).toEqual([]);

    // A run it replaced says "cancelled" before: once checking, a cancel waits for the next turn.
    queue.onChecks(S, run('running'));
    queue.onChecks(S, run('done', ['passed', 'failed']));
    await vi.runAllTimersAsync();
    expect(delivered).toEqual([]);
    expect(queue.get(S)).toMatchObject({ paused: true, blockedBy: 'checksFailed' });

    // Resumed after the error went to the agent: the next end of turn checks again.
    queue.resume(S, { afterTurn: true });
    await vi.runAllTimersAsync();
    expect(checksAsked).toBe(1);
    await turn();
    expect(checksAsked).toBe(2);
    queue.onChecks(S, run('done', ['passed', 'passed']));
    await vi.runAllTimersAsync();
    expect(delivered).toEqual(['com verificação']);
    await turn();
    expect(delivered).toEqual(['com verificação', 'depois']);
  });

  it('skipping the item that failed sends the next one to a free agent', async () => {
    queue.add(S, { text: 'falha', condition: 'checksPassed' });
    queue.add(S, { text: 'seguinte' });
    await move('terminou');
    queue.onChecks(S, run('done', ['failed']));
    const first = queue.get(S).items[0]!;
    queue.remove(S, first.id);
    queue.resume(S);
    await vi.runAllTimersAsync();
    expect(delivered).toEqual(['seguinte']);
  });

  it('stops when an item asks for checks the folder does not have', async () => {
    hasChecks = false;
    queue.add(S, { text: 'x', condition: 'checksPassed' });
    await move('terminou');
    expect(queue.get(S)).toMatchObject({ paused: true, blockedBy: 'noChecks' });
    expect(delivered).toEqual([]);
  });

  it('a run cancelled because the agent went back to work is checked again at its next turn', async () => {
    queue.add(S, { text: 'x', condition: 'checksPassed' });
    await move('terminou');
    queue.onChecks(S, run('cancelled'));
    expect(queue.get(S).checking).toBeUndefined();
    await turn();
    expect(checksAsked).toBe(2);
  });

  it('pauses and resumes; a paused queue sends nothing', async () => {
    queue.add(S, { text: 'um' });
    queue.pause(S);
    await move('terminou');
    expect(delivered).toEqual([]);
    expect(queue.summary(S)).toEqual({ items: 1, paused: true });
    queue.resume(S);
    await vi.runAllTimersAsync();
    expect(delivered).toEqual(['um']);
  });

  it('stops when the agent leaves, and when an item cannot be sent', async () => {
    queue.add(S, { text: 'um' });
    agent = { ...agent, running: false };
    await move('terminou');
    expect(queue.get(S)).toMatchObject({ paused: true, blockedBy: 'exited' });
    expect(delivered).toEqual([]);

    agent = { running: true, status: status('trabalhando') };
    queue.resume(S);
    failDelivery = true;
    await move('terminou');
    expect(queue.get(S)).toMatchObject({
      paused: true,
      blockedBy: 'sendFailed',
      error: 'grande demais',
    });
    expect(queue.get(S).items.map((i) => i.text)).toEqual(['um']);
  });

  it('edits, reorders and removes items', async () => {
    const a = queue.add(S, { text: 'a' });
    const b = queue.add(S, { text: 'b' });
    const c = queue.add(S, { text: 'c' });
    queue.reorder(S, [c.id, a.id]);
    expect(queue.get(S).items.map((i) => i.text)).toEqual(['c', 'a', 'b']);
    queue.update(S, b.id, { text: 'b editado', condition: 'checksPassed' });
    queue.remove(S, a.id);
    expect(queue.get(S).items.map((i) => [i.text, i.condition])).toEqual([
      ['c', 'turnEnd'],
      ['b editado', 'checksPassed'],
    ]);
    expect(() => queue.update(S, 'nao-existe', { text: 'x' })).toThrow(UserError);
    expect(() => queue.update(S, b.id, { text: '  ' })).toThrow(UserError);
  });

  it(`holds at most ${QUEUE_LIMIT} items`, () => {
    for (let i = 0; i < QUEUE_LIMIT; i++) queue.add(S, { text: `item ${i}` });
    expect(queue.fits(S)).toBe(false);
    expect(() => queue.add(S, { text: 'demais' })).toThrow(UserError);
  });

  it('is kept on disk, comes back paused when the app opens again, and goes with its session', async () => {
    queue.add(S, { text: 'um', values: { answers: { Prioridade: 'alta' } } });
    queue.add(S, { text: 'dois', condition: 'checksPassed' });
    const file = path.join(dir, `${S}.json`);
    expect(fs.existsSync(file)).toBe(true);

    // The app opens again: the queue is there, paused, and a turn that ends sends nothing.
    build();
    expect(queue.get(S)).toMatchObject({ paused: true, blockedBy: 'restored' });
    expect(queue.get(S).items.map((i) => [i.text, i.condition, i.values.answers])).toEqual([
      ['um', 'turnEnd', { Prioridade: 'alta' }],
      ['dois', 'checksPassed', {}],
    ]);
    await move('terminou');
    expect(delivered).toEqual([]);
    queue.resume(S);
    await vi.runAllTimersAsync();
    expect(delivered).toEqual(['um']);

    queue.forget(S);
    expect(fs.existsSync(file)).toBe(false);
    expect(queue.get(S).items).toEqual([]);
  });

  it('deletes the queue of a session closed while the app was away, and ignores a broken file', () => {
    queue.add(S, { text: 'um' });
    fs.writeFileSync(path.join(dir, 'quebrada.json'), '{ nada');
    build(['quebrada']);
    expect(fs.existsSync(path.join(dir, `${S}.json`))).toBe(false);
    expect(queue.get('quebrada')).toEqual({ items: [], paused: false });
  });

  it('removing the last item clears the file and the block', async () => {
    hasChecks = false;
    const item = queue.add(S, { text: 'x', condition: 'checksPassed' });
    await move('terminou');
    expect(queue.get(S).blockedBy).toBe('noChecks');
    queue.remove(S, item.id);
    expect(queue.get(S)).toEqual({ items: [], paused: false });
    expect(fs.existsSync(path.join(dir, `${S}.json`))).toBe(false);
  });
});

describe('readyForQueue', () => {
  it('only between turns, confirmed by the agent', () => {
    const at = (state: SessionState, extra: Partial<SessionStatus> = {}) =>
      readyForQueue({ running: true, status: status(state, extra) });
    expect(at('terminou')).toBe(true);
    expect(at('aguardando', { detail: STATUS_DETAIL.ready })).toBe(true);
    expect(at('aguardando', { detail: STATUS_DETAIL.idle })).toBe(true);
    expect(at('aguardando', { detail: 'Bash' })).toBe(false);
    expect(at('trabalhando')).toBe(false);
    expect(at('terminou', { confirmed: false })).toBe(false);
    expect(readyForQueue({ running: false, status: status('terminou') })).toBe(false);
    expect(readyForQueue(null)).toBe(false);
  });
});
