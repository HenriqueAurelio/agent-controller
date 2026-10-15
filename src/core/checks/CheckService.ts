import { EventEmitter } from 'node:events';
import {
  stripAnsi,
  type CheckConfig,
  type CheckOutcome,
  type CheckResult,
  type ChecksRun,
} from '@shared/checks';
import { runInShell, type RunResult } from '../tools/ToolRunner';
import { folderFingerprint } from './fingerprint';

export interface CheckTarget {
  /** The folder the checks run in: the one of the session. */
  cwd: string;
  checks: CheckConfig[];
}

export interface CheckServiceOptions {
  /** The folder and checks of a session right now, or null when it has none. */
  targetOf(sessionId: string): CheckTarget | null;
  /** How one check runs. The default is the user's shell; tests swap it. */
  run?: (check: CheckConfig, cwd: string, signal: AbortSignal) => Promise<RunResult>;
  fingerprint?: (cwd: string) => Promise<string | null>;
  /** Sessions whose checks may run at the same time. */
  maxParallel?: number;
  now?: () => number;
}

interface CheckEvents {
  /** The run of a session changed: queued, a check finished, done, cancelled. */
  changed: [sessionId: string, run: ChecksRun | null];
}

interface Entry {
  run: ChecksRun | null;
  /** The checks of the run, as they were when it was asked for. */
  checks: CheckConfig[];
  abort: AbortController | null;
  /** The fingerprint of the folder after the last run that went to the end. */
  checkedFingerprint: string | null;
  /** Bumped by every new request, so a stale async step knows to give up. */
  generation: number;
}

export const DEFAULT_MAX_PARALLEL = 2;

function defaultRun(check: CheckConfig, cwd: string, signal: AbortSignal): Promise<RunResult> {
  return runInShell(check.command, {
    cwd,
    // Tools print less color and no prompts when they know nobody is at the keyboard.
    env: { ...process.env, CI: '1' },
    timeoutMs: check.timeoutSec * 1000,
    signal,
  });
}

function outcomeOf(result: RunResult): CheckOutcome {
  if (result.cancelled) return 'cancelled';
  if (result.timedOut) return 'timedOut';
  if (result.error !== undefined) return 'error';
  return result.exitCode === 0 ? 'passed' : 'failed';
}

/**
 * Runs the checks of a session's folder when its agent ends a turn that changed files, or when
 * asked. A run is cancelled when the agent goes back to work, since its result would be stale.
 * Runs of different sessions wait in one queue, so a few of them do not take the machine over.
 */
export class CheckService extends EventEmitter<CheckEvents> {
  private readonly entries = new Map<string, Entry>();
  private readonly queue: string[] = [];
  private readonly active = new Set<string>();
  private readonly maxParallel: number;
  private readonly runCheck: NonNullable<CheckServiceOptions['run']>;
  private readonly fingerprint: NonNullable<CheckServiceOptions['fingerprint']>;
  private readonly now: () => number;
  private disposed = false;

  constructor(private readonly options: CheckServiceOptions) {
    super();
    this.maxParallel = Math.max(1, options.maxParallel ?? DEFAULT_MAX_PARALLEL);
    this.runCheck = options.run ?? defaultRun;
    this.fingerprint = options.fingerprint ?? folderFingerprint;
    this.now = options.now ?? Date.now;
  }

  private entry(sessionId: string): Entry {
    let entry = this.entries.get(sessionId);
    if (!entry) {
      entry = { run: null, checks: [], abort: null, checkedFingerprint: null, generation: 0 };
      this.entries.set(sessionId, entry);
    }
    return entry;
  }

  get(sessionId: string): ChecksRun | null {
    return this.entries.get(sessionId)?.run ?? null;
  }

  isBusy(sessionId: string): boolean {
    const state = this.get(sessionId)?.state;
    return state === 'queued' || state === 'running';
  }

  /** The agent ended a turn. Runs the checks meant for that, unless nothing changed since. */
  async turnEnded(sessionId: string): Promise<void> {
    const target = this.options.targetOf(sessionId);
    const checks = target?.checks.filter((check) => check.onTurnEnd) ?? [];
    if (!target || checks.length === 0) return;
    const entry = this.entry(sessionId);
    const generation = ++entry.generation;
    const fingerprint = await this.fingerprint(target.cwd);
    if (this.disposed || entry.generation !== generation) return;
    if (fingerprint !== null && fingerprint === entry.checkedFingerprint) return;
    this.enqueue(sessionId, entry, 'turnEnd', checks);
  }

  /** The agent is working again: whatever is pending or running would check a moving target. */
  turnStarted(sessionId: string): void {
    const entry = this.entries.get(sessionId);
    if (!entry) return;
    entry.generation++;
    if (this.isBusy(sessionId)) this.cancel(sessionId);
  }

  /** Every check of the folder, now. */
  runNow(sessionId: string): void {
    const checks = this.options.targetOf(sessionId)?.checks ?? [];
    if (checks.length === 0) return;
    const entry = this.entry(sessionId);
    entry.generation++;
    this.enqueue(sessionId, entry, 'manual', checks);
  }

  cancel(sessionId: string): void {
    const entry = this.entries.get(sessionId);
    if (!entry?.run || !this.isBusy(sessionId)) return;
    const queued = this.queue.indexOf(sessionId);
    if (queued >= 0) this.queue.splice(queued, 1);
    entry.abort?.abort();
    entry.abort = null;
    entry.run = { ...entry.run, state: 'cancelled', finishedAt: this.now(), current: undefined };
    this.emit('changed', sessionId, entry.run);
  }

  /** The session is gone: its run ends and nothing of it is kept. */
  forget(sessionId: string): void {
    this.cancel(sessionId);
    this.entries.delete(sessionId);
  }

  dispose(): void {
    this.disposed = true;
    for (const sessionId of [...this.entries.keys()]) this.cancel(sessionId);
    this.queue.length = 0;
  }

  private enqueue(
    sessionId: string,
    entry: Entry,
    trigger: ChecksRun['trigger'],
    checks: CheckConfig[],
  ): void {
    // One run per session: a new request replaces the one before.
    if (this.isBusy(sessionId)) this.cancel(sessionId);
    entry.run = {
      trigger,
      state: 'queued',
      startedAt: this.now(),
      checks: checks.map(({ id, label, command }) => ({ id, label, command })),
      results: [],
    };
    entry.checks = checks;
    entry.abort = new AbortController();
    this.queue.push(sessionId);
    this.emit('changed', sessionId, entry.run);
    this.pump();
  }

  private pump(): void {
    while (this.active.size < this.maxParallel && this.queue.length > 0) {
      const sessionId = this.queue.shift()!;
      const entry = this.entries.get(sessionId);
      if (!entry?.run || entry.run.state !== 'queued' || !entry.abort) continue;
      // The slot is the session's until its run is over, cancelled or not.
      this.active.add(sessionId);
      void this.execute(sessionId, entry, entry.run, entry.abort).finally(() => {
        this.active.delete(sessionId);
        if (!this.disposed) this.pump();
      });
    }
  }

  private async execute(
    sessionId: string,
    entry: Entry,
    run: ChecksRun,
    abort: AbortController,
  ): Promise<void> {
    const cwd = this.options.targetOf(sessionId)?.cwd;
    if (!cwd) {
      this.cancel(sessionId);
      return;
    }
    // A cancelled run aborts its controller first: from then on, nothing of it is published.
    let state: ChecksRun = { ...run, state: 'running' };
    const publish = (next: ChecksRun) => {
      state = next;
      if (abort.signal.aborted) return;
      entry.run = next;
      this.emit('changed', sessionId, next);
    };
    publish(state);
    for (const check of entry.checks) {
      if (abort.signal.aborted) return;
      publish({ ...state, current: check.id });
      const result = await this.runCheck(check, cwd, abort.signal);
      if (abort.signal.aborted) return;
      const checkResult: CheckResult = {
        id: check.id,
        label: check.label,
        command: check.command,
        outcome: outcomeOf(result),
        exitCode: result.exitCode,
        durationMs: result.durationMs,
        output: stripAnsi(result.error ? `${result.output}${result.error}` : result.output),
        truncated: result.truncated,
      };
      publish({ ...state, results: [...state.results, checkResult] });
    }
    const fingerprint = await this.fingerprint(cwd);
    if (abort.signal.aborted) return;
    entry.checkedFingerprint = fingerprint;
    entry.abort = null;
    publish({ ...state, state: 'done', current: undefined, finishedAt: this.now() });
  }
}
