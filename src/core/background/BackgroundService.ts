// Runs the user's background commands (a database proxy, a tunnel, a local server) apart from
// any session: each in a terminal of its own, with its output kept, until it is turned off or the
// app closes.
import { EventEmitter } from 'node:events';
import { homedir } from 'node:os';
import {
  BACKGROUND_OUTPUT_LIMIT,
  type BackgroundCommand,
  type BackgroundRun,
  type BackgroundState,
} from '@shared/background';
import type { LaunchCommand } from '../agents/commandLine';
import { shellCommandLine } from '../agents/shellCommand';
import { PtyManager, type PtyExit } from '../pty/PtyManager';

export interface BackgroundNotice {
  command: BackgroundCommand;
  exitCode: number;
}

interface Events {
  changed: [state: BackgroundState];
  data: [id: string, chunk: string];
  /** A command that was on ended by itself. */
  notice: [notice: BackgroundNotice];
}

export interface BackgroundServiceOptions {
  ptys?: PtyManager;
  /** How a command line becomes a process; by default, the user's shell with its profile. */
  launch?: (command: string) => LaunchCommand;
  home?: string;
  now?: () => number;
}

interface Running {
  ptyId: string;
  /** What it was started with: a change to the command or the folder starts it again. */
  command: string;
  cwd: string;
  /** Stopped by the app (turned off, changed, closing): its end is no news. */
  stopping: boolean;
}

const STOPPED: BackgroundRun = { status: 'stopped', startedAt: null, exitCode: null, error: null };
const SIZE = { cols: 120, rows: 30 };

export class BackgroundService extends EventEmitter<Events> {
  private readonly ptys: PtyManager;
  private readonly launch: (command: string) => LaunchCommand;
  private readonly home: string;
  private readonly now: () => number;
  private commands: BackgroundCommand[] = [];
  private readonly runs = new Map<string, BackgroundRun>();
  private readonly running = new Map<string, Running>();
  private readonly output = new Map<string, string>();
  /** Commands that ended by themselves while on: they stay down until asked again. */
  private readonly down = new Set<string>();
  private size = SIZE;
  private generation = 0;
  private disposed = false;

  constructor(options: BackgroundServiceOptions = {}) {
    super();
    this.ptys = options.ptys ?? new PtyManager();
    this.launch = options.launch ?? ((command) => shellCommandLine(command));
    this.home = options.home ?? homedir();
    this.now = options.now ?? Date.now;
    this.ptys.on('data', (ptyId, chunk) => this.onData(ptyId, chunk));
    this.ptys.on('exit', (ptyId, exit) => this.onExit(ptyId, exit));
  }

  get(): BackgroundState {
    const runs: Record<string, BackgroundRun> = {};
    for (const command of this.commands) runs[command.id] = this.runs.get(command.id) ?? STOPPED;
    return { runs };
  }

  /** The saved list: what is on and not running starts, what is off or gone stops. */
  configure(commands: readonly BackgroundCommand[]): void {
    if (this.disposed) return;
    this.commands = [...commands];
    const ids = new Set(commands.map((c) => c.id));
    for (const id of [...this.running.keys()]) {
      if (!ids.has(id)) void this.stop(id);
    }
    for (const id of [...this.runs.keys()]) {
      if (!ids.has(id) && !this.running.has(id)) {
        this.runs.delete(id);
        this.output.delete(id);
      }
    }
    for (const command of commands) {
      const run = this.running.get(command.id);
      if (!command.on) {
        // Turned off: whatever happened before is forgotten, the next turn on starts it.
        this.down.delete(command.id);
        if (run) void this.stop(command.id);
        else this.runs.set(command.id, STOPPED);
      } else if (run && (run.command !== command.command || run.cwd !== command.cwd)) {
        void this.stop(command.id).then(() => this.start(command.id));
      } else if (!run && !this.down.has(command.id)) {
        this.start(command.id);
      }
    }
    this.changed();
  }

  /** Starts it again: after it fell, or to pick up something it reads only when starting. */
  async restart(id: string): Promise<void> {
    const command = this.commands.find((c) => c.id === id);
    if (!command?.on) return;
    this.down.delete(id);
    await this.stop(id);
    this.start(id);
  }

  /** The output of the latest run, for a view that opens now; what comes next is `data`. */
  outputOf(id: string): string {
    return this.output.get(id) ?? '';
  }

  input(id: string, data: string): void {
    const run = this.running.get(id);
    if (run) this.ptys.write(run.ptyId, data);
  }

  resize(cols: number, rows: number): void {
    this.size = { cols, rows };
    for (const run of this.running.values()) this.ptys.resize(run.ptyId, cols, rows);
  }

  /** Every command ends with the app: none is left holding a port. */
  async dispose(): Promise<void> {
    this.disposed = true;
    await Promise.all([...this.running.keys()].map((id) => this.stop(id)));
  }

  private start(id: string): void {
    const command = this.commands.find((c) => c.id === id);
    if (!command || this.running.has(id) || this.disposed) return;
    const ptyId = `bg:${id}:${++this.generation}`;
    const launch = this.launch(command.command);
    this.output.set(id, '');
    try {
      this.ptys.create({
        id: ptyId,
        file: launch.file,
        args: launch.args,
        env: launch.env,
        cwd: command.cwd || this.home,
        cols: this.size.cols,
        rows: this.size.rows,
      });
    } catch (err) {
      this.runs.set(id, {
        status: 'failed',
        startedAt: null,
        exitCode: null,
        error: err instanceof Error ? err.message : String(err),
      });
      this.down.add(id);
      this.changed();
      return;
    }
    this.running.set(id, { ptyId, command: command.command, cwd: command.cwd, stopping: false });
    this.runs.set(id, { status: 'running', startedAt: this.now(), exitCode: null, error: null });
    this.changed();
  }

  private async stop(id: string): Promise<void> {
    const run = this.running.get(id);
    if (!run) return;
    run.stopping = true;
    await this.ptys.kill(run.ptyId);
  }

  private idOf(ptyId: string): string | null {
    for (const [id, run] of this.running) if (run.ptyId === ptyId) return id;
    return null;
  }

  private onData(ptyId: string, chunk: string): void {
    const id = this.idOf(ptyId);
    if (!id) return;
    const text = (this.output.get(id) ?? '') + chunk;
    this.output.set(
      id,
      text.length > BACKGROUND_OUTPUT_LIMIT ? text.slice(-BACKGROUND_OUTPUT_LIMIT) : text,
    );
    this.emit('data', id, chunk);
  }

  private onExit(ptyId: string, exit: PtyExit): void {
    const id = this.idOf(ptyId);
    if (!id) return;
    const run = this.running.get(id)!;
    this.running.delete(id);
    const command = this.commands.find((c) => c.id === id);
    if (run.stopping || !command?.on || this.disposed) {
      this.runs.set(id, STOPPED);
    } else {
      // It ended by itself while on: a proxy that lost its login, a port in use. It stays down
      // until turned on again or restarted; starting it over and over would hide the reason.
      this.down.add(id);
      this.runs.set(id, {
        status: 'exited',
        startedAt: this.runs.get(id)?.startedAt ?? null,
        exitCode: exit.exitCode,
        error: null,
      });
      this.emit('notice', { command, exitCode: exit.exitCode });
    }
    if (!this.disposed) this.changed();
  }

  private changed(): void {
    this.emit('changed', this.get());
  }
}
