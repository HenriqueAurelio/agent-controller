import { EventEmitter } from 'node:events';
import type { IPty } from 'node-pty';
import * as nodePty from 'node-pty';
import { buildChildEnv } from './env';
import { isAlive, killProcessTree } from './killTree';
import { toLongPath } from './longPath';
import { resolveWindowsSpawn } from './windowsArgs';

export interface PtyCreateOptions {
  id: string;
  file: string;
  args: string[];
  cwd: string;
  /** Added on top of the inherited environment (minus the app's own variables). */
  env?: Record<string, string>;
  cols?: number;
  rows?: number;
}

export interface PtyExit {
  exitCode: number;
  signal?: number;
}

export interface PtyKillOptions {
  /** How long to wait for the process to leave on its own after the polite request. */
  graceMs?: number;
}

interface PtyEvents {
  data: [id: string, chunk: string];
  exit: [id: string, exit: PtyExit];
}

interface Entry {
  pty: IPty;
  pid: number;
  exited: boolean;
  exit: Promise<PtyExit>;
  paused: boolean;
  killing: Promise<void> | null;
}

const CTRL_C = '\x03';

export class PtyManager extends EventEmitter<PtyEvents> {
  private readonly ptys = new Map<string, Entry>();

  constructor(private readonly parentEnv: NodeJS.ProcessEnv = process.env) {
    super();
  }

  create(options: PtyCreateOptions): { pid: number } {
    if (this.ptys.has(options.id)) throw new Error(`PTY ${options.id} já existe`);
    const cwd = toLongPath(options.cwd);
    const env = buildChildEnv(this.parentEnv, options.env);
    const target =
      process.platform === 'win32'
        ? resolveWindowsSpawn(options.file, options.args)
        : { file: options.file, args: options.args };

    const pty = nodePty.spawn(target.file, target.args, {
      name: 'xterm-256color',
      cols: options.cols ?? 80,
      rows: options.rows ?? 24,
      cwd,
      env,
      // The ConPTY shipped with node-pty, not the one built into Windows: Windows 10's drops the
      // markers of a bracketed paste and repaints the screen on its own, so programs behaved
      // differently here than in Windows Terminal or VS Code.
      useConptyDll: process.platform === 'win32',
    });

    let resolveExit!: (exit: PtyExit) => void;
    const entry: Entry = {
      pty,
      pid: pty.pid,
      exited: false,
      exit: new Promise<PtyExit>((resolve) => (resolveExit = resolve)),
      paused: false,
      killing: null,
    };
    this.ptys.set(options.id, entry);

    pty.onData((chunk) => this.emit('data', options.id, chunk));
    pty.onExit(({ exitCode, signal }) => {
      entry.exited = true;
      this.ptys.delete(options.id);
      const exit = { exitCode, signal };
      resolveExit(exit);
      this.emit('exit', options.id, exit);
    });
    return { pid: pty.pid };
  }

  has(id: string): boolean {
    return this.ptys.has(id);
  }

  ids(): string[] {
    return [...this.ptys.keys()];
  }

  pid(id: string): number | undefined {
    return this.ptys.get(id)?.pid;
  }

  write(id: string, data: string): void {
    const entry = this.ptys.get(id);
    if (!entry || entry.exited) return;
    entry.pty.write(data);
  }

  resize(id: string, cols: number, rows: number): void {
    const entry = this.ptys.get(id);
    if (!entry || entry.exited) return;
    try {
      entry.pty.resize(Math.max(2, Math.floor(cols)), Math.max(1, Math.floor(rows)));
    } catch {
      // The process ended between the check and the call.
    }
  }

  /** Backpressure: stop reading from the PTY until `resume`. */
  pause(id: string): void {
    const entry = this.ptys.get(id);
    if (!entry || entry.paused || entry.exited) return;
    entry.paused = true;
    entry.pty.pause();
  }

  resume(id: string): void {
    const entry = this.ptys.get(id);
    if (!entry || !entry.paused || entry.exited) return;
    entry.paused = false;
    entry.pty.resume();
  }

  /**
   * Ends a PTY in stages: Ctrl+C (twice, as the agents ask for confirmation), a short wait, then
   * the whole process tree by force. Resolves when the process is gone.
   */
  kill(id: string, options: PtyKillOptions = {}): Promise<void> {
    const entry = this.ptys.get(id);
    if (!entry || entry.exited) return Promise.resolve();
    entry.killing ??= this.killEntry(entry, options.graceMs ?? 1500);
    return entry.killing;
  }

  async killAll(options: PtyKillOptions = {}): Promise<void> {
    await Promise.all(this.ids().map((id) => this.kill(id, options)));
  }

  private async killEntry(entry: Entry, graceMs: number): Promise<void> {
    const exitedWithin = (ms: number) =>
      Promise.race([
        entry.exit.then(() => true),
        new Promise<boolean>((resolve) => setTimeout(() => resolve(false), ms)),
      ]);

    if (entry.paused) {
      entry.paused = false;
      try {
        entry.pty.resume();
      } catch {
        // Nothing to resume.
      }
    }
    if (graceMs > 0) {
      try {
        entry.pty.write(CTRL_C);
        setTimeout(() => {
          if (!entry.exited) {
            try {
              entry.pty.write(CTRL_C);
            } catch {
              // Closed in the meantime.
            }
          }
        }, 150);
      } catch {
        // The PTY is already closed.
      }
      if (await exitedWithin(graceMs)) {
        // The agent left, but what it started may still be running.
        await killProcessTree(entry.pid);
        return;
      }
    }

    // On Windows, node-pty's own kill() forks a helper that fails with "AttachConsole failed"
    // when the console is already gone. Killing the tree first makes the PTY close by itself,
    // so kill() is only the last resort.
    await killProcessTree(entry.pid);
    if (await exitedWithin(2000)) return;
    try {
      entry.pty.kill();
    } catch {
      // The process is already gone.
    }
    if (!(await exitedWithin(2000)) && !isAlive(entry.pid)) {
      // The process is dead but node-pty never reported it; do not leave callers hanging.
      entry.exited = true;
    }
  }
}
