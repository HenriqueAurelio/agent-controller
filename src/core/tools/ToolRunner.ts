import { spawn } from 'node:child_process';
import { wrapInShellForPipes } from '../agents/shellCommand';
import { killProcessTree } from '../pty/killTree';

export interface RunOptions {
  file: string;
  args: string[];
  cwd: string;
  env?: NodeJS.ProcessEnv;
  stdin?: string;
  timeoutMs: number;
  /** Characters kept of the output; beyond that, only its end. */
  maxOutputChars?: number;
  signal?: AbortSignal;
}

export interface RunResult {
  /** Null when the process could not start, or was ended by the app. */
  exitCode: number | null;
  stdout: string;
  stderr: string;
  /** Both streams in the order they came, as a terminal would have shown them. */
  output: string;
  truncated: boolean;
  timedOut: boolean;
  cancelled: boolean;
  durationMs: number;
  /** Why the process could not start. */
  error?: string;
}

export const DEFAULT_MAX_OUTPUT_CHARS = 200 * 1024;

/** Keeps the end of a stream: the end is where a failing tool says what went wrong. */
class Tail {
  text = '';
  truncated = false;
  constructor(private readonly max: number) {}
  push(chunk: string): void {
    this.text += chunk;
    if (this.text.length > this.max) {
      this.text = this.text.slice(this.text.length - this.max);
      this.truncated = true;
    }
  }
}

/**
 * Runs a tool of the user's project outside any terminal: no PTY, a deadline, a cap on what is
 * kept of the output, and the whole process tree ended when it is over its time or cancelled.
 * Nothing is left running in between: each call is one process, gone when it resolves.
 */
export function runTool(options: RunOptions): Promise<RunResult> {
  const started = Date.now();
  const max = options.maxOutputChars ?? DEFAULT_MAX_OUTPUT_CHARS;
  const stdout = new Tail(max);
  const stderr = new Tail(max);
  const output = new Tail(max);

  return new Promise((resolve) => {
    let timedOut = false;
    let cancelled = false;
    let settled = false;
    const result = (exitCode: number | null, error?: string): RunResult => ({
      exitCode: timedOut || cancelled ? null : exitCode,
      stdout: stdout.text,
      stderr: stderr.text,
      output: output.text,
      truncated: output.truncated,
      timedOut,
      cancelled,
      durationMs: Date.now() - started,
      ...(error !== undefined && { error }),
    });

    if (options.signal?.aborted) {
      cancelled = true;
      resolve(result(null));
      return;
    }

    const child = spawn(options.file, options.args, {
      cwd: options.cwd,
      env: options.env ?? process.env,
      windowsHide: true,
      // A session of its own on POSIX: an interactive shell has no terminal to fight over, and
      // the whole group can be ended at once.
      detached: process.platform !== 'win32',
      stdio: ['pipe', 'pipe', 'pipe'],
    });
    const end = () => {
      if (child.pid) void killProcessTree(child.pid, { termGraceMs: 300 });
      else child.kill();
    };
    const onAbort = () => {
      cancelled = true;
      end();
    };
    const timer = setTimeout(() => {
      timedOut = true;
      end();
    }, options.timeoutMs);
    options.signal?.addEventListener('abort', onAbort, { once: true });
    const finish = (exitCode: number | null, error?: string) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      options.signal?.removeEventListener('abort', onAbort);
      resolve(result(exitCode, error));
    };

    child.stdout.setEncoding('utf8');
    child.stderr.setEncoding('utf8');
    child.stdout.on('data', (chunk: string) => {
      stdout.push(chunk);
      output.push(chunk);
    });
    child.stderr.on('data', (chunk: string) => {
      stderr.push(chunk);
      output.push(chunk);
    });
    child.on('error', (err) => finish(null, err.message));
    child.on('close', (code) => finish(code));
    child.stdin.on('error', () => {});
    child.stdin.end(options.stdin ?? '');
  });
}

export interface ShellRunOptions extends Omit<RunOptions, 'file' | 'args'> {
  platform?: NodeJS.Platform;
}

/**
 * Runs one line as the user would type it, in their own shell started as they start it: the
 * same way the command of a session runs (ADR 0013), so their aliases and PATH apply.
 */
export function runInShell(command: string, options: ShellRunOptions): Promise<RunResult> {
  const env = options.env ?? process.env;
  const { file, args } = wrapInShellForPipes({ file: '', args: [], env: {} }, command, {
    platform: options.platform,
    env,
  });
  return runTool({ ...options, file, args, env });
}
