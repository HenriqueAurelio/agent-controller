import { describe, expect, it } from 'vitest';
import { CLAUDE_CODE, CODEX } from '@core/agents/profiles';
import { SignalAggregator } from '@core/sessions/SignalAggregator';
import type { SessionState, Signal, SignalKind, SignalOrigin } from '@shared/session';

type Step = [kind: SignalKind, origin: SignalOrigin, at: number, exitCode?: number];

function run(steps: Step[], priorities = CLAUDE_CODE.priorities) {
  const aggregator = new SignalAggregator({ priorities, graceMs: 1000, confirmedRecentMs: 5000 });
  const seen: SessionState[] = [];
  for (const [kind, origin, at, exitCode] of steps) {
    const signal: Signal = { sessionId: 's', kind, origin, at, exitCode };
    const next = aggregator.apply(signal);
    if (next) seen.push(next.state);
  }
  return { status: aggregator.status, seen };
}

const START: Step = ['started', 'processo', 0];

describe('SignalAggregator transitions', () => {
  it.each<[name: string, steps: Step[], expected: SessionState[]]>([
    ['starts', [START], ['iniciando']],
    ['ready at the prompt', [START, ['waiting', 'titulo', 100]], ['iniciando', 'aguardando']],
    [
      'a full turn',
      [START, ['working', 'titulo', 100], ['done', 'hook', 5000]],
      ['iniciando', 'trabalhando', 'terminou'],
    ],
    [
      'permission, approved, finished',
      [
        START,
        ['working', 'titulo', 100],
        ['waiting', 'hook', 2000],
        ['working', 'titulo', 6000],
        ['done', 'hook', 9000],
      ],
      ['iniciando', 'trabalhando', 'aguardando', 'trabalhando', 'terminou'],
    ],
    [
      'a new prompt after finishing',
      [START, ['working', 'titulo', 100], ['done', 'hook', 2000], ['working', 'titulo', 8000]],
      ['iniciando', 'trabalhando', 'terminou', 'trabalhando'],
    ],
    [
      'idle prompt one minute after the end',
      [START, ['working', 'titulo', 100], ['done', 'hook', 2000], ['waiting', 'hook', 62000]],
      ['iniciando', 'trabalhando', 'terminou', 'aguardando'],
    ],
    [
      'exit code 0 means finished',
      [START, ['working', 'titulo', 100], ['exited', 'processo', 500, 0]],
      ['iniciando', 'trabalhando', 'terminou'],
    ],
    [
      'any other exit code is an error',
      [START, ['working', 'titulo', 100], ['exited', 'processo', 500, 3]],
      ['iniciando', 'trabalhando', 'erro'],
    ],
    [
      'stopped by the user',
      [START, ['working', 'titulo', 100], ['stopped', 'processo', 500]],
      ['iniciando', 'trabalhando', 'parada'],
    ],
    [
      'restart after an error',
      [START, ['exited', 'processo', 10, 1], ['started', 'processo', 20]],
      ['iniciando', 'erro', 'iniciando'],
    ],
  ])('%s', (_name, steps, expected) => {
    expect(run(steps).seen).toEqual(expected);
  });

  it('ignores agent signals while the session is stopped', () => {
    expect(
      run([
        ['working', 'titulo', 10],
        ['done', 'hook', 20],
        ['waiting', 'hook', 30],
      ]).seen,
    ).toEqual([]);
    const afterExit = run([START, ['exited', 'processo', 10, 1], ['working', 'titulo', 20]]);
    expect(afterExit.status.state).toBe('erro');
  });

  it('does not report repeated signals as changes', () => {
    const { seen } = run([
      START,
      ['working', 'titulo', 100],
      ['working', 'titulo', 200],
      ['working', 'titulo', 300],
      ['done', 'hook', 400],
      ['done', 'titulo', 500],
    ]);
    expect(seen).toEqual(['iniciando', 'trabalhando', 'terminou']);
  });
});

describe('SignalAggregator conflicts', () => {
  it('a stale spinner title right after the Stop hook does not undo "terminou"', () => {
    const { status } = run([
      START,
      ['working', 'titulo', 100],
      ['done', 'hook', 5000],
      ['working', 'titulo', 5040],
      ['working', 'titulo', 5300],
    ]);
    expect(status.state).toBe('terminou');
  });

  it('a lower-priority signal wins once the grace period is over', () => {
    const { status } = run([
      START,
      ['working', 'titulo', 100],
      ['waiting', 'hook', 5000],
      ['working', 'titulo', 6200],
    ]);
    expect(status).toMatchObject({ state: 'trabalhando', origin: 'titulo' });
  });

  it('a higher-priority signal wins immediately', () => {
    const { status } = run([START, ['working', 'titulo', 100], ['waiting', 'hook', 101]]);
    expect(status).toMatchObject({ state: 'aguardando', origin: 'hook', confirmed: true });
  });

  it('drops signals older than the one that set the state', () => {
    const { status } = run([
      START,
      ['working', 'titulo', 1000],
      ['done', 'hook', 5000],
      ['waiting', 'hook', 4000], // Delivered late: happened before the turn ended.
    ]);
    expect(status.state).toBe('terminou');
  });

  it('priorities are per profile: in Codex the title outranks the hook', () => {
    const steps: Step[] = [
      START,
      ['working', 'titulo', 100],
      ['waiting', 'titulo', 3000],
      ['done', 'notify', 3200],
    ];
    expect(run(steps, CODEX.priorities).status.state).toBe('aguardando');
    // With the notify above the title, the same sequence ends the turn.
    const inverted = { ...CODEX.priorities, notify: 5 };
    expect(run(steps, inverted).status.state).toBe('terminou');
  });

  it('Codex with trusted hooks: the spinner frame behind the permission hook does not flicker', () => {
    // As recorded with Codex 0.158.0: hook, a late spinner title, then "Action Required".
    const { seen, status } = run(
      [
        START,
        ['working', 'titulo', 5800],
        ['waiting', 'hook', 11500],
        ['working', 'titulo', 11505],
        ['waiting', 'titulo', 11510],
        ['working', 'titulo', 15500],
      ],
      CODEX.priorities,
    );
    expect(seen).toEqual(['iniciando', 'trabalhando', 'aguardando', 'trabalhando']);
    expect(status.state).toBe('trabalhando');
  });

  it('process signals are never outranked nor stale', () => {
    const { status } = run([
      START,
      ['working', 'titulo', 100],
      ['done', 'hook', 5000],
      ['exited', 'processo', 4000, 2],
    ]);
    expect(status.state).toBe('erro');
  });
});

describe('SignalAggregator silence', () => {
  it('marks the state as inferred', () => {
    const { status } = run([START, ['working', 'titulo', 100], ['waiting', 'silencio', 30000]]);
    expect(status).toMatchObject({ state: 'aguardando', origin: 'silencio', confirmed: false });
  });

  it('does not decide when a confirmed signal arrived recently', () => {
    const { status } = run([
      START,
      ['working', 'titulo', 100],
      ['working', 'titulo', 28000],
      ['waiting', 'silencio', 30000],
    ]);
    expect(status.state).toBe('trabalhando');
  });

  it('only applies while working', () => {
    expect(run([START, ['waiting', 'silencio', 30000]]).status.state).toBe('iniciando');
    const done = run([
      START,
      ['working', 'titulo', 1],
      ['done', 'hook', 2],
      ['waiting', 'silencio', 30000],
    ]);
    expect(done.status.state).toBe('terminou');
  });

  it('an inferred state is upgraded when the agent confirms it', () => {
    const { status, seen } = run([
      START,
      ['working', 'titulo', 100],
      ['waiting', 'silencio', 30000],
      ['waiting', 'hook', 31000],
    ]);
    expect(status).toMatchObject({ state: 'aguardando', origin: 'hook', confirmed: true });
    expect(seen).toEqual(['iniciando', 'trabalhando', 'aguardando', 'aguardando']);
  });

  it('output resuming after an inferred wait goes back to working', () => {
    const { status } = run([
      START,
      ['working', 'titulo', 100],
      ['waiting', 'silencio', 30000],
      ['working', 'titulo', 30010],
    ]);
    expect(status).toMatchObject({ state: 'trabalhando', confirmed: true });
  });
});
