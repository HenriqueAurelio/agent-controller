import { randomUUID } from 'node:crypto';
import { EventEmitter } from 'node:events';
import fs from 'node:fs';
import { errorText, translate, UserError, type MessageKey, type MessageParams } from '@shared/i18n';
import type { Preferences } from '@shared/prefs';
import {
  initialStatus,
  type HooksMode,
  type NewSessionInput,
  type Session,
  type SessionStatus,
  type SessionView,
  type Signal,
  type TerminalSize,
} from '@shared/session';
import { createAdapter, getProfile, type AgentAdapter, type LaunchCommand } from '../agents';
import { ScreenHistory } from '../history/ScreenHistory';
import type { PtyManager } from '../pty/PtyManager';
import { toLongPath } from '../pty/longPath';
import type { HookMessage } from '../signals/HookServer';
import { SilenceDetector } from '../signals/SilenceDetector';
import { StreamParser } from '../signals/StreamParser';
import { SignalAggregator } from './SignalAggregator';

export interface TerminalSnapshotData {
  data: string;
  cols: number;
  rows: number;
}

export interface SessionTransition {
  session: SessionView;
  previous: SessionStatus;
}

interface ManagerEvents {
  /** The list, or something shown in it, changed. */
  sessions: [];
  data: [id: string, data: string];
  /** The session restarted: a mounted terminal must be cleared. */
  reset: [id: string];
  transition: [SessionTransition];
  started: [session: Session];
  removed: [id: string];
}

export interface SessionManagerOptions {
  ptys: PtyManager;
  sessions: Session[];
  selectedId: string | null;
  prefs: Preferences;
  /** How to open the agent of a session. Throws with a message for the user when it cannot. */
  resolveLaunch: (session: Session) => LaunchCommand;
  /** Called (debounced) whenever what is persisted changed. */
  persist: (sessions: Session[], selectedId: string | null) => void;
  now?: () => number;
}

interface Runtime {
  history: ScreenHistory;
  parser: StreamParser;
  adapter: AgentAdapter;
  silence: SilenceDetector;
  running: boolean;
  stopRequested: boolean;
  /** `pending`: an attach is waiting for the history to catch up. */
  attached: 'no' | 'pending' | 'yes';
  visible: boolean;
  buffer: string[];
  bufferedChars: number;
  flushTimer: ReturnType<typeof setTimeout> | null;
  /** Characters sent to the renderer and not yet acknowledged. */
  unacked: number;
  paused: boolean;
}

interface Entry {
  session: Session;
  aggregator: SignalAggregator;
  hooks: HooksMode;
  unread: boolean;
  /** A visual terminal exists for this session, whether or not the agent is running. */
  mounted: boolean;
  visible: boolean;
  runtime: Runtime | null;
}

const DEFAULT_SIZE: TerminalSize = { cols: 100, rows: 30 };
// Visible terminals are fed once per frame; the ones kept mounted in the background, rarely.
export const FOREGROUND_FLUSH_MS = 8;
export const BACKGROUND_FLUSH_MS = 250;
const FLUSH_NOW_CHARS = 128 * 1024;
// Backpressure thresholds, in characters waiting on the renderer plus the history.
export const HIGH_WATER = 256 * 1024;
export const LOW_WATER = 32 * 1024;

/**
 * Owns the sessions: their list, their processes and their state. Knows nothing about Electron;
 * the main process only forwards its events over IPC.
 */
export class SessionManager extends EventEmitter<ManagerEvents> {
  private readonly entries = new Map<string, Entry>();
  private order: string[] = [];
  private selectedId: string | null;
  private windowFocused = true;
  private prefs: Preferences;
  private persistTimer: ReturnType<typeof setTimeout> | null = null;
  private readonly now: () => number;

  constructor(private readonly options: SessionManagerOptions) {
    super();
    this.now = options.now ?? Date.now;
    this.prefs = options.prefs;
    for (const session of [...options.sessions].sort((a, b) => a.order - b.order)) {
      this.entries.set(session.id, this.newEntry(session));
      this.order.push(session.id);
    }
    this.selectedId =
      options.selectedId && this.entries.has(options.selectedId)
        ? options.selectedId
        : (this.order[0] ?? null);
    options.ptys.on('data', this.onPtyData);
    options.ptys.on('exit', this.onPtyExit);
  }

  private newEntry(session: Session): Entry {
    return {
      session,
      aggregator: new SignalAggregator({ priorities: getProfile(session.profile).priorities }),
      hooks: 'unknown',
      unread: false,
      mounted: false,
      visible: false,
      runtime: null,
    };
  }

  // ---- list ---------------------------------------------------------------------------------

  private view(entry: Entry): SessionView {
    return {
      ...entry.session,
      order: this.order.indexOf(entry.session.id),
      status: entry.aggregator.status,
      running: entry.runtime?.running ?? false,
      hooks: entry.hooks,
      unread: entry.unread,
    };
  }

  list(): SessionView[] {
    return this.order.map((id) => this.view(this.entries.get(id)!));
  }

  get selected(): string | null {
    return this.selectedId;
  }

  has(id: string): boolean {
    return this.entries.has(id);
  }

  get(id: string): Session | undefined {
    return this.entries.get(id)?.session;
  }

  isRunning(id: string): boolean {
    return this.entries.get(id)?.runtime?.running ?? false;
  }

  runningSessions(): Session[] {
    return this.order.filter((id) => this.isRunning(id)).map((id) => this.entries.get(id)!.session);
  }

  private changed(persist = false): void {
    if (persist) this.schedulePersist();
    this.emit('sessions');
  }

  private schedulePersist(): void {
    if (this.persistTimer) return;
    this.persistTimer = setTimeout(() => this.flushPersist(), 300);
  }

  flushPersist(): void {
    if (this.persistTimer) clearTimeout(this.persistTimer);
    this.persistTimer = null;
    const sessions = this.order.map((id, order) => ({ ...this.entries.get(id)!.session, order }));
    this.options.persist(sessions, this.selectedId);
  }

  create(input: NewSessionInput): SessionView {
    const name = input.name.trim();
    if (!name) throw new UserError('error.session.noName');
    const cwd = this.folder(input.cwd);
    getProfile(input.profile); // Throws on an unknown profile.

    const session: Session = {
      id: randomUUID(),
      name,
      cwd,
      profile: input.profile,
      order: this.order.length,
    };
    const entry = this.newEntry(session);
    this.entries.set(session.id, entry);
    this.order.push(session.id);
    this.selectedId = session.id;
    this.changed(true);
    return this.view(entry);
  }

  /** The folder as a session keeps it. Throws a `UserError` when it cannot be one. */
  private folder(cwd: string): string {
    let stat: fs.Stats;
    try {
      stat = fs.statSync(cwd);
    } catch {
      throw new UserError('error.folder.missing', { folder: cwd });
    }
    if (!stat.isDirectory()) throw new UserError('error.folder.notFolder', { folder: cwd });
    return toLongPath(cwd);
  }

  /** The same folder and agent in a new session, listed right below the original. */
  duplicate(id: string): SessionView {
    const source = this.entries.get(id)?.session;
    if (!source) throw new UserError('error.session.notFound');
    const names = new Set([...this.entries.values()].map((e) => e.session.name));
    const base = source.name.replace(/ \(\d+\)$/, '');
    let copy = 2;
    while (names.has(`${base} (${copy})`)) copy++;

    const position = this.order.indexOf(id) + 1;
    const session: Session = {
      ...source,
      id: randomUUID(),
      name: `${base} (${copy})`,
      order: position,
    };
    const entry = this.newEntry(session);
    this.entries.set(session.id, entry);
    this.order.splice(position, 0, session.id);
    this.selectedId = session.id;
    this.changed(true);
    return this.view(entry);
  }

  /**
   * Moves a session to another folder. An agent works where it was opened, so a running one is
   * ended first: resolves to whether that happened. A folder that cannot be used ends nothing.
   */
  async setCwd(id: string, cwd: string): Promise<boolean> {
    const entry = this.entries.get(id);
    if (!entry) return false;
    const folder = this.folder(cwd);
    if (folder === entry.session.cwd) return false;
    const wasRunning = entry.runtime?.running ?? false;
    await this.stop(id);
    if (this.entries.get(id) !== entry) return false; // Closed in the meantime.
    entry.session = { ...entry.session, cwd: folder };
    this.changed(true);
    return wasRunning;
  }

  rename(id: string, name: string): void {
    const entry = this.entries.get(id);
    const trimmed = name.trim();
    if (!entry || !trimmed || trimmed === entry.session.name) return;
    entry.session = { ...entry.session, name: trimmed };
    this.changed(true);
  }

  reorder(orderedIds: string[]): void {
    const known = orderedIds.filter((id) => this.entries.has(id));
    const rest = this.order.filter((id) => !known.includes(id));
    this.order = [...new Set([...known, ...rest])];
    this.changed(true);
  }

  select(id: string | null): void {
    if (id !== null && !this.entries.has(id)) return;
    this.selectedId = id;
    this.clearUnread();
    this.changed(true);
  }

  /** Whether the app window is the active one; the focused session is never notified. */
  setWindowFocused(focused: boolean): void {
    this.windowFocused = focused;
    if (focused && this.clearUnread()) this.changed();
  }

  private clearUnread(): boolean {
    const entry = this.selectedId ? this.entries.get(this.selectedId) : undefined;
    if (!entry?.unread || !this.windowFocused) return false;
    entry.unread = false;
    return true;
  }

  isFocused(id: string): boolean {
    return this.windowFocused && this.selectedId === id;
  }

  async remove(id: string): Promise<void> {
    const entry = this.entries.get(id);
    if (!entry) return;
    await this.stop(id);
    this.disposeRuntime(entry);
    this.entries.delete(id);
    const index = this.order.indexOf(id);
    this.order = this.order.filter((other) => other !== id);
    if (this.selectedId === id) {
      this.selectedId = this.order[Math.min(index, this.order.length - 1)] ?? null;
    }
    this.emit('removed', id);
    this.changed(true);
  }

  setPreferences(prefs: Preferences): void {
    this.prefs = prefs;
    for (const entry of this.entries.values()) {
      entry.runtime?.history.setScrollback(prefs.scrollback);
      entry.runtime?.silence.setWindow(prefs.silenceSeconds * 1000);
    }
  }

  // ---- process lifecycle ----------------------------------------------------------------------

  start(id: string, size: TerminalSize = DEFAULT_SIZE): void {
    const entry = this.entries.get(id);
    if (!entry || entry.runtime?.running) return;
    const { session } = entry;
    const profile = getProfile(session.profile);

    const runtime: Runtime = {
      history: new ScreenHistory({ ...size, scrollback: this.prefs.scrollback }),
      parser: new StreamParser(),
      adapter: createAdapter(profile, {
        sessionId: id,
        emit: (signal) => this.applySignal(signal),
        setHooks: (mode) => this.setHooks(id, mode),
        now: this.now,
      }),
      silence: new SilenceDetector(
        this.prefs.silenceSeconds * 1000,
        (at) => this.applySignal({ sessionId: id, kind: 'waiting', origin: 'silencio', at }),
        this.now,
      ),
      running: false,
      stopRequested: false,
      // A terminal that is already mounted receives this run from its first byte.
      attached: entry.mounted ? 'yes' : 'no',
      visible: entry.visible,
      buffer: [],
      bufferedChars: 0,
      flushTimer: null,
      unacked: 0,
      paused: false,
    };
    // A mounted terminal answers the program's queries itself; otherwise the history does, so
    // an agent started in the background does not stall.
    runtime.history.onReply((reply) => {
      if (runtime.attached === 'no' && runtime.running) this.options.ptys.write(id, reply);
    });
    this.disposeRuntime(entry);
    entry.runtime = runtime;
    entry.hooks = 'unknown';
    this.emit('reset', id);

    try {
      const launch = this.options.resolveLaunch(session);
      this.options.ptys.create({
        id,
        file: launch.file,
        args: launch.args,
        env: launch.env,
        cwd: session.cwd,
        cols: size.cols,
        rows: size.rows,
      });
      runtime.running = true;
    } catch (err) {
      const message = errorText(this.prefs.language, err);
      this.writeNotice(id, runtime, this.t('notice.startFailed', { error: message }));
      this.applySignal({ sessionId: id, kind: 'started', origin: 'processo', at: this.now() });
      this.applySignal({
        sessionId: id,
        kind: 'exited',
        origin: 'processo',
        at: this.now(),
        exitCode: 1,
        detail: message,
      });
      return;
    }
    this.applySignal({ sessionId: id, kind: 'started', origin: 'processo', at: this.now() });
    this.emit('started', session);
  }

  /** Ends the agent and everything it started. Resolves when the process is gone. */
  async stop(id: string, graceMs?: number): Promise<void> {
    const runtime = this.entries.get(id)?.runtime;
    if (!runtime?.running) return;
    runtime.stopRequested = true;
    await this.options.ptys.kill(id, { graceMs });
  }

  async stopAll(graceMs?: number): Promise<void> {
    await Promise.all(this.order.map((id) => this.stop(id, graceMs)));
  }

  private disposeRuntime(entry: Entry): void {
    const runtime = entry.runtime;
    if (!runtime) return;
    if (runtime.flushTimer) clearTimeout(runtime.flushTimer);
    runtime.adapter.dispose();
    runtime.silence.dispose();
    runtime.history.dispose();
    entry.runtime = null;
  }

  private readonly onPtyExit = (id: string, exit: { exitCode: number }): void => {
    const entry = this.entries.get(id);
    const runtime = entry?.runtime;
    if (!entry || !runtime) return;
    runtime.running = false;
    runtime.paused = false;
    runtime.adapter.dispose();
    runtime.silence.dispose();
    this.writeNotice(
      id,
      runtime,
      runtime.stopRequested
        ? this.t('notice.stopped')
        : this.t('notice.exited', { code: exit.exitCode }),
    );
    const changed = this.applySignal({
      sessionId: id,
      kind: runtime.stopRequested ? 'stopped' : 'exited',
      origin: 'processo',
      at: this.now(),
      exitCode: exit.exitCode,
    });
    if (!changed) this.changed(); // `running` flipped even if the state did not.
  };

  /** Notices are written in the language of the moment; the ones already on screen stay. */
  private t(key: MessageKey, params?: MessageParams): string {
    return translate(this.prefs.language, key, params);
  }

  private writeNotice(id: string, runtime: Runtime, text: string): void {
    this.deliver(id, runtime, `\r\n\x1b[0m\x1b[2m[${text}]\x1b[0m\r\n`);
  }

  // ---- signals ----------------------------------------------------------------------------------

  /** Entry point of the hook server. */
  handleHook(message: HookMessage): void {
    const runtime = this.entries.get(message.sessionId)?.runtime;
    if (runtime?.running) runtime.adapter.onHook(message);
  }

  private setHooks(id: string, mode: HooksMode): void {
    const entry = this.entries.get(id);
    if (!entry || entry.hooks === mode) return;
    entry.hooks = mode;
    this.changed();
  }

  private applySignal(signal: Signal): boolean {
    const entry = this.entries.get(signal.sessionId);
    if (!entry) return false;
    const previous = entry.aggregator.status;
    const next = entry.aggregator.apply(signal);
    if (!next) return false;
    const attention = next.state === 'aguardando' || next.state === 'terminou';
    if (attention && previous.state === 'trabalhando' && !this.isFocused(signal.sessionId)) {
      entry.unread = true;
    }
    if (next.state === 'trabalhando' || next.state === 'parada') entry.unread = false;
    this.changed();
    this.emit('transition', { session: this.view(entry), previous });
    return true;
  }

  /** For restored sessions and tests. */
  statusOf(id: string): SessionStatus {
    return this.entries.get(id)?.aggregator.status ?? initialStatus();
  }

  // ---- terminal stream ----------------------------------------------------------------------------

  private readonly onPtyData = (id: string, chunk: string): void => {
    const runtime = this.entries.get(id)?.runtime;
    if (!runtime) return;
    // The signal parser reads everything, with no throttling, whatever the terminal is doing.
    for (const event of runtime.parser.feed(chunk)) {
      if (event.type === 'title') runtime.adapter.onTitle(event.title);
    }
    runtime.silence.activity();
    this.deliver(id, runtime, chunk);
  };

  private deliver(id: string, runtime: Runtime, chunk: string): void {
    runtime.history.write(chunk, () => this.relieve(id, runtime));
    if (runtime.attached !== 'no') {
      runtime.buffer.push(chunk);
      runtime.bufferedChars += chunk.length;
      if (runtime.attached === 'yes') this.scheduleFlush(id, runtime);
    }
    this.applyPressure(id, runtime);
  }

  private scheduleFlush(id: string, runtime: Runtime): void {
    if (runtime.bufferedChars >= FLUSH_NOW_CHARS) {
      this.flush(id, runtime);
      return;
    }
    if (runtime.flushTimer) return;
    runtime.flushTimer = setTimeout(
      () => this.flush(id, runtime),
      runtime.visible ? FOREGROUND_FLUSH_MS : BACKGROUND_FLUSH_MS,
    );
  }

  private flush(id: string, runtime: Runtime): void {
    if (runtime.flushTimer) clearTimeout(runtime.flushTimer);
    runtime.flushTimer = null;
    if (runtime.attached !== 'yes' || runtime.buffer.length === 0) return;
    const data = runtime.buffer.join('');
    runtime.buffer = [];
    runtime.bufferedChars = 0;
    runtime.unacked += data.length;
    this.emit('data', id, data);
    this.applyPressure(id, runtime);
  }

  private pressure(runtime: Runtime): number {
    return runtime.unacked + runtime.bufferedChars + runtime.history.pending;
  }

  private applyPressure(id: string, runtime: Runtime): void {
    if (runtime.paused || !runtime.running) return;
    if (this.pressure(runtime) > HIGH_WATER) {
      runtime.paused = true;
      this.options.ptys.pause(id);
    }
  }

  private relieve(id: string, runtime: Runtime): void {
    if (!runtime.paused || this.pressure(runtime) > LOW_WATER) return;
    runtime.paused = false;
    this.options.ptys.resume(id);
  }

  /** The renderer finished drawing `chars` characters. */
  ack(id: string, chars: number): void {
    const runtime = this.entries.get(id)?.runtime;
    if (!runtime) return;
    runtime.unacked = Math.max(0, runtime.unacked - chars);
    this.relieve(id, runtime);
  }

  /**
   * A visual terminal was mounted. Returns the content to repopulate it; from this call on, new
   * output is sent as `data` events, with nothing lost or duplicated in between.
   */
  async attach(id: string, size: TerminalSize): Promise<TerminalSnapshotData> {
    const entry = this.entries.get(id);
    if (!entry) return { data: '', ...size };
    entry.mounted = true;
    const runtime = entry.runtime;
    if (!runtime) return { data: '', ...size };
    this.resize(id, size);
    runtime.buffer = [];
    runtime.bufferedChars = 0;
    runtime.unacked = 0;
    // Output that arrives while the history catches up is queued for the renderer, because it
    // will not be part of the snapshot.
    runtime.attached = 'pending';
    await runtime.history.flush();
    if (this.entries.get(id)?.runtime !== runtime) return { data: '', ...size };
    const snapshot = {
      data: runtime.history.serialize(),
      cols: runtime.history.cols,
      rows: runtime.history.rows,
    };
    runtime.attached = 'yes';
    if (runtime.buffer.length) this.scheduleFlush(id, runtime);
    return snapshot;
  }

  detach(id: string): void {
    const entry = this.entries.get(id);
    if (!entry) return;
    entry.mounted = false;
    entry.visible = false;
    const runtime = entry.runtime;
    if (!runtime) return;
    if (runtime.flushTimer) clearTimeout(runtime.flushTimer);
    runtime.flushTimer = null;
    runtime.attached = 'no';
    runtime.visible = false;
    runtime.buffer = [];
    runtime.bufferedChars = 0;
    runtime.unacked = 0;
    this.relieve(id, runtime);
  }

  /** Terminals mounted but not on screen are fed at a lower rate. */
  setVisible(id: string, visible: boolean): void {
    const entry = this.entries.get(id);
    if (!entry) return;
    entry.visible = visible;
    const runtime = entry.runtime;
    if (!runtime || runtime.visible === visible) return;
    runtime.visible = visible;
    if (visible) this.flush(id, runtime);
  }

  input(id: string, data: string): void {
    const runtime = this.entries.get(id)?.runtime;
    if (!runtime?.running) return;
    runtime.adapter.onUserInput(data);
    this.options.ptys.write(id, data);
  }

  resize(id: string, size: TerminalSize): void {
    const runtime = this.entries.get(id)?.runtime;
    if (!runtime) return;
    runtime.history.resize(size.cols, size.rows);
    if (runtime.running) this.options.ptys.resize(id, size.cols, size.rows);
  }

  async screenText(id: string): Promise<string> {
    const runtime = this.entries.get(id)?.runtime;
    if (!runtime) return '';
    await runtime.history.flush();
    return runtime.history.screenText();
  }

  attachedCount(): number {
    let count = 0;
    for (const entry of this.entries.values()) if (entry.mounted) count++;
    return count;
  }

  pidOf(id: string): number | undefined {
    return this.options.ptys.pid(id);
  }

  /** Ends every session and stops listening. Used when the app closes. */
  async dispose(graceMs = 800): Promise<void> {
    this.flushPersist();
    await this.stopAll(graceMs);
    this.options.ptys.off('data', this.onPtyData);
    this.options.ptys.off('exit', this.onPtyExit);
    for (const entry of this.entries.values()) this.disposeRuntime(entry);
  }
}
