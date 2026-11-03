// Runs the analyses of Sonar, one per session, and keeps the result of each. The setup is the
// group's; the result never is: two sessions of the same repository on different branches get
// their own analysis, problems and verdict.
import { EventEmitter } from 'node:events';
import fs from 'node:fs';
import path from 'node:path';
import { UserError } from '@shared/i18n';
import type { SonarConfig, SonarRun } from '@shared/sonar';
import { runInShell, type RunResult, type ShellRunOptions } from '../tools/ToolRunner';
import { SonarApi, type SonarApiError } from './SonarApi';

interface Events {
  changed: [sessionId: string, run: SonarRun | null];
}

/** One analysis to do: where, with which setup and token, and what to call it. */
export interface SonarJob {
  sessionId: string;
  /** The repository: analyses of the same one wait for each other (caches, the server's queue). */
  repoKey: string;
  cwd: string;
  branch: string | null;
  config: SonarConfig;
  token: string;
}

export interface SonarServiceOptions {
  /** Where each session's working folder of the scanner lives: the app's data, never the copy. */
  workDirectory: string;
  run?: (command: string, options: ShellRunOptions) => Promise<RunResult>;
  api?: (config: SonarConfig, token: string) => Pick<SonarApi, 'task' | 'gate' | 'issues'>;
  now?: () => number;
  /** Between two looks at the processing of the report. */
  pollMs?: number;
  scannerTimeoutMs?: number;
  processingTimeoutMs?: number;
  describeError?: (err: unknown) => string;
}

const SCANNER_TIMEOUT_MS = 15 * 60_000;
const PROCESSING_TIMEOUT_MS = 5 * 60_000;

/** The id of the report the scanner left for the server, in its working folder. */
export function readTaskId(workDir: string): string | null {
  try {
    const report = fs.readFileSync(path.join(workDir, 'report-task.txt'), 'utf8');
    return /^ceTaskId=(.+)$/m.exec(report)?.[1]?.trim() ?? null;
  } catch {
    return null;
  }
}

/** The parameters of an analysis, as the scanner reads them from `SONAR_SCANNER_JSON_PARAMS`. */
export function scannerParams(job: SonarJob, workDir: string): Record<string, string> {
  return {
    'sonar.projectKey': job.config.projectKey,
    'sonar.host.url': job.config.url,
    'sonar.working.directory': workDir,
    ...(job.config.organization ? { 'sonar.organization': job.config.organization } : {}),
    ...(job.config.branches && job.branch ? { 'sonar.branch.name': job.branch } : {}),
  };
}

const safeName = (id: string) => id.replace(/[^\w-]/g, '_');

export class SonarService extends EventEmitter<Events> {
  private readonly runs = new Map<string, SonarRun>();
  private readonly running = new Map<string, AbortController>();
  /** The analysis each repository is doing now, so the next one waits. */
  private readonly repoBusy = new Map<string, Promise<void>>();
  private readonly options: Required<Omit<SonarServiceOptions, 'describeError'>> &
    Pick<SonarServiceOptions, 'describeError'>;

  constructor(options: SonarServiceOptions) {
    super();
    this.options = {
      run: runInShell,
      api: (config, token) => new SonarApi(config, token),
      now: Date.now,
      pollMs: 2000,
      scannerTimeoutMs: SCANNER_TIMEOUT_MS,
      processingTimeoutMs: PROCESSING_TIMEOUT_MS,
      ...options,
    };
  }

  get(sessionId: string): SonarRun | null {
    return this.runs.get(sessionId) ?? null;
  }

  all(): Record<string, SonarRun> {
    return Object.fromEntries(this.runs);
  }

  /** Starts an analysis of the session; one of it already going is cancelled first. */
  start(job: SonarJob): void {
    this.cancel(job.sessionId);
    const controller = new AbortController();
    this.running.set(job.sessionId, controller);
    this.set(job.sessionId, {
      status: 'queued',
      startedAt: this.options.now(),
      branch: job.branch,
      problems: [],
      more: 0,
    });
    const before = this.repoBusy.get(job.repoKey) ?? Promise.resolve();
    const mine = before.then(() => this.analyse(job, controller.signal));
    const done = mine.catch(() => {});
    this.repoBusy.set(job.repoKey, done);
    void done.finally(() => {
      if (this.repoBusy.get(job.repoKey) === done) this.repoBusy.delete(job.repoKey);
      if (this.running.get(job.sessionId) === controller) this.running.delete(job.sessionId);
    });
  }

  /** The agent of the session went back to work: its analysis would be about code that is moving. */
  cancel(sessionId: string): void {
    const controller = this.running.get(sessionId);
    if (!controller) return;
    controller.abort();
    this.running.delete(sessionId);
    const run = this.runs.get(sessionId);
    if (
      run &&
      (run.status === 'queued' || run.status === 'running' || run.status === 'processing')
    ) {
      this.set(sessionId, { ...run, status: 'cancelled', finishedAt: this.options.now() });
    }
  }

  forget(sessionId: string): void {
    this.cancel(sessionId);
    if (this.runs.delete(sessionId)) this.emit('changed', sessionId, null);
    fs.promises
      .rm(path.join(this.options.workDirectory, safeName(sessionId)), {
        recursive: true,
        force: true,
      })
      .catch(() => {});
  }

  dispose(): void {
    for (const controller of this.running.values()) controller.abort();
    this.running.clear();
    this.removeAllListeners();
  }

  private set(sessionId: string, run: SonarRun): void {
    this.runs.set(sessionId, run);
    this.emit('changed', sessionId, run);
  }

  private async analyse(job: SonarJob, signal: AbortSignal): Promise<void> {
    if (signal.aborted) return;
    const base = this.runs.get(job.sessionId)!;
    const fail = (error: string) =>
      this.set(job.sessionId, { ...base, status: 'error', error, finishedAt: this.options.now() });
    this.set(job.sessionId, { ...base, status: 'running' });
    const workDir = path.join(this.options.workDirectory, safeName(job.sessionId));
    await fs.promises.rm(workDir, { recursive: true, force: true }).catch(() => {});
    await fs.promises.mkdir(workDir, { recursive: true });

    const params = JSON.stringify(scannerParams(job, workDir));
    const result = await this.options.run(job.config.scanner, {
      cwd: job.cwd,
      env: {
        ...process.env,
        // The token never goes in the command line or the output: only here.
        SONAR_TOKEN: job.token,
        SONAR_SCANNER_JSON_PARAMS: params,
        SONARQUBE_SCANNER_PARAMS: params,
      },
      timeoutMs: this.options.scannerTimeoutMs,
      maxOutputChars: 20_000,
      signal,
    });
    if (signal.aborted || result.cancelled) return;
    if (result.timedOut) return fail(this.describe(new UserError('error.sonar.scannerTimeout')));
    if (result.error || result.exitCode !== 0) {
      const tail = (result.error ?? result.output).trim().split(/\r?\n/).slice(-12).join('\n');
      return fail(tail.replaceAll(job.token, '***') || `exit ${result.exitCode}`);
    }
    const taskId = readTaskId(workDir);
    if (!taskId) return fail(this.describe(new UserError('error.sonar.noReport')));

    this.set(job.sessionId, { ...base, status: 'processing' });
    const api = this.options.api(job.config, job.token);
    try {
      const deadline = this.options.now() + this.options.processingTimeoutMs;
      for (;;) {
        const task = await api.task(taskId);
        if (signal.aborted) return;
        if (task.status === 'SUCCESS') break;
        if (task.status === 'FAILED' || task.status === 'CANCELED') {
          return fail(task.error || task.status);
        }
        if (this.options.now() > deadline) {
          return fail(this.describe(new UserError('error.sonar.processingTimeout')));
        }
        await new Promise((resolve) => setTimeout(resolve, this.options.pollMs));
      }
      const branch = job.config.branches ? job.branch : null;
      const [gate, issues] = await Promise.all([api.gate(branch), api.issues(branch)]);
      if (signal.aborted) return;
      this.set(job.sessionId, {
        ...base,
        // Without a quality gate, any open issue is a failure.
        status: gate === 'ERROR' || (gate === null && issues.total > 0) ? 'failed' : 'passed',
        gate,
        problems: issues.problems,
        more: Math.max(0, issues.total - issues.problems.length),
        finishedAt: this.options.now(),
      });
    } catch (err) {
      if (!signal.aborted) fail(this.describe(err as SonarApiError));
    }
  }

  private describe(err: unknown): string {
    return this.options.describeError?.(err) ?? (err instanceof Error ? err.message : String(err));
  }
}
