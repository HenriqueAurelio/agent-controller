import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { CheckService, type CheckTarget } from '@core/checks/CheckService';
import type { RunResult } from '@core/tools/ToolRunner';
import { sanitizeChecks, type CheckConfig, type ChecksRun } from '@shared/checks';
import { removeDir, tempDir, waitFor } from './helpers';

interface Pending {
  sessionId: string;
  check: CheckConfig;
  signal: AbortSignal;
  finish(exitCode: number, output?: string): void;
}

const outcome = (exitCode: number | null, output: string, cancelled = false): RunResult => ({
  exitCode,
  stdout: output,
  stderr: '',
  output,
  truncated: false,
  timedOut: false,
  cancelled,
  durationMs: 10,
});

describe('CheckService', () => {
  let targets: Record<string, CheckTarget>;
  let fingerprints: Record<string, string | null>;
  let pending: Pending[];
  let events: { sessionId: string; run: ChecksRun | null }[];
  let service: CheckService;

  const build = (maxParallel = 2) => {
    service = new CheckService({
      targetOf: (id) => targets[id] ?? null,
      fingerprint: async (cwd) => fingerprints[cwd] ?? null,
      maxParallel,
      run: (check, cwd, signal) =>
        new Promise<RunResult>((resolve) => {
          const sessionId = Object.keys(targets).find((id) => targets[id]!.cwd === cwd)!;
          const item: Pending = {
            sessionId,
            check,
            signal,
            finish: (code, output = '') => {
              pending.splice(pending.indexOf(item), 1);
              resolve(outcome(code, output));
            },
          };
          signal.addEventListener('abort', () => {
            pending.splice(pending.indexOf(item), 1);
            resolve(outcome(null, '', true));
          });
          pending.push(item);
        }),
    });
    service.on('changed', (sessionId, run) => events.push({ sessionId, run }));
  };
  const checks = (...list: Partial<CheckConfig>[]) =>
    sanitizeChecks(list.map((c, i) => ({ command: `check ${i}`, ...c })));
  const running = (sessionId: string) =>
    waitFor(() => pending.find((p) => p.sessionId === sessionId), {
      message: `nada rodando em ${sessionId}`,
    });
  const states = (sessionId: string) =>
    events.filter((e) => e.sessionId === sessionId).map((e) => e.run?.state);

  beforeEach(() => {
    targets = {
      s1: { cwd: '/p1', checks: checks({ label: 'lint' }, { label: 'test' }) },
    };
    fingerprints = { '/p1': 'f1' };
    pending = [];
    events = [];
    build();
  });
  afterEach(() => service.dispose());

  it('runs the checks of the folder, one after the other, when a turn ends', async () => {
    await service.turnEnded('s1');
    const first = await running('s1');
    expect(first.check.label).toBe('lint');
    expect(service.get('s1')).toMatchObject({ state: 'running', current: first.check.id });
    first.finish(0, 'ok');
    const second = await running('s1');
    expect(second.check.label).toBe('test');
    second.finish(1, '\x1b[31mFALHOU\x1b[0m');
    await waitFor(() => service.get('s1')?.state === 'done');

    expect(service.get('s1')).toMatchObject({
      trigger: 'turnEnd',
      state: 'done',
      results: [
        { label: 'lint', outcome: 'passed', exitCode: 0, output: 'ok' },
        { label: 'test', outcome: 'failed', exitCode: 1, output: 'FALHOU' },
      ],
    });
    // Queued, started, then for each check: the one running now, and its result.
    expect(states('s1')).toEqual([
      'queued',
      'running',
      'running',
      'running',
      'running',
      'running',
      'done',
    ]);
  });

  it('leaves out the checks that only run when asked, and runs them all when asked', async () => {
    targets.s1!.checks = checks({ label: 'lint' }, { label: 'e2e', onTurnEnd: false });
    await service.turnEnded('s1');
    (await running('s1')).finish(0);
    await waitFor(() => service.get('s1')?.state === 'done');
    expect(service.get('s1')!.checks.map((c) => c.label)).toEqual(['lint']);

    service.runNow('s1');
    (await running('s1')).finish(0);
    (await running('s1')).finish(0);
    await waitFor(() => service.get('s1')?.state === 'done');
    expect(service.get('s1')).toMatchObject({ trigger: 'manual' });
    expect(service.get('s1')!.results.map((r) => r.label)).toEqual(['lint', 'e2e']);
  });

  it('does nothing for a session without checks', async () => {
    targets.s1!.checks = [];
    await service.turnEnded('s1');
    service.runNow('s1');
    await service.turnEnded('nao-existe');
    expect(events).toEqual([]);
  });

  it('skips a turn that changed nothing since the last run, but not one that did', async () => {
    await service.turnEnded('s1');
    (await running('s1')).finish(0);
    (await running('s1')).finish(0);
    await waitFor(() => service.get('s1')?.state === 'done');
    const count = events.length;

    await service.turnEnded('s1');
    expect(events).toHaveLength(count);

    fingerprints['/p1'] = 'f2';
    await service.turnEnded('s1');
    expect(service.get('s1')?.state).toBe('running');
  });

  it('always runs when there is no telling what changed (no repository)', async () => {
    fingerprints['/p1'] = null;
    for (let turn = 0; turn < 2; turn++) {
      await service.turnEnded('s1');
      (await running('s1')).finish(0);
      (await running('s1')).finish(0);
      await waitFor(() => service.get('s1')?.state === 'done');
    }
    expect(states('s1').filter((s) => s === 'done')).toHaveLength(2);
  });

  it('is cancelled when the agent goes back to work, and the command with it', async () => {
    await service.turnEnded('s1');
    const first = await running('s1');
    service.turnStarted('s1');
    expect(first.signal.aborted).toBe(true);
    expect(service.get('s1')).toMatchObject({ state: 'cancelled', results: [] });
    await new Promise((resolve) => setTimeout(resolve, 50));
    // Nothing of the cancelled run comes after.
    expect(states('s1').at(-1)).toBe('cancelled');
    expect(pending).toEqual([]);
  });

  it('a cancelled run does not count as checked: the same state runs again', async () => {
    await service.turnEnded('s1');
    await running('s1');
    service.cancel('s1');
    await service.turnEnded('s1');
    expect(service.get('s1')?.state).toBe('running');
  });

  it('replaces a run of the session asked for again', async () => {
    service.runNow('s1');
    const first = await running('s1');
    service.runNow('s1');
    expect(first.signal.aborted).toBe(true);
    const second = await running('s1');
    expect(second.signal.aborted).toBe(false);
    expect(service.get('s1')?.state).toBe('running');
  });

  it('runs a few sessions at a time; the others wait in line', async () => {
    targets.s2 = { cwd: '/p2', checks: checks({ label: 'a' }) };
    targets.s3 = { cwd: '/p3', checks: checks({ label: 'a' }) };
    service.runNow('s2');
    service.runNow('s3');
    service.runNow('s1');
    await running('s2');
    await running('s3');
    expect(service.get('s1')?.state).toBe('queued');
    expect(pending.map((p) => p.sessionId).sort()).toEqual(['s2', 's3']);

    pending.find((p) => p.sessionId === 's2')!.finish(0);
    await running('s1');
    expect(service.get('s2')?.state).toBe('done');
  });

  it('a queued run cancelled never starts', async () => {
    build(1);
    targets.s2 = { cwd: '/p2', checks: checks({ label: 'a' }) };
    service.runNow('s2');
    await running('s2');
    service.runNow('s1');
    service.cancel('s1');
    pending[0]!.finish(0);
    await waitFor(() => service.get('s2')?.state === 'done');
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(pending).toEqual([]);
    expect(service.get('s1')?.state).toBe('cancelled');
  });

  it('forgets a session that is gone', async () => {
    service.runNow('s1');
    const first = await running('s1');
    service.forget('s1');
    expect(first.signal.aborted).toBe(true);
    expect(service.get('s1')).toBeNull();
  });
});

describe('CheckService with the real shell', { timeout: 120_000 }, () => {
  let dir: string;
  beforeEach(() => {
    dir = tempDir('ac-checks-');
  });
  afterEach(() => removeDir(dir));

  it('runs the commands in the folder of the session and records how each went', async () => {
    const service = new CheckService({
      targetOf: () => ({
        cwd: dir,
        checks: sanitizeChecks([
          { label: 'passa', command: `node -e "console.log('tudo certo em ' + process.cwd())"` },
          { label: 'falha', command: `node -e "console.error('2 != 3'); process.exit(2)"` },
          { label: 'lenta', command: `node -e "setTimeout(() => {}, 60000)"`, timeoutSec: 5 },
        ]),
      }),
    });
    await service.turnEnded('s1');
    const run = await waitFor(
      () => (service.get('s1')?.state === 'done' ? service.get('s1') : null),
      { timeout: 90_000 },
    );
    expect(run.results.map((r) => [r.label, r.outcome, r.exitCode])).toEqual([
      ['passa', 'passed', 0],
      ['falha', 'failed', 2],
      ['lenta', 'timedOut', null],
    ]);
    expect(run.results[0]!.output).toContain('tudo certo em');
    expect(run.results[1]!.output).toContain('2 != 3');
    service.dispose();
  });
});
