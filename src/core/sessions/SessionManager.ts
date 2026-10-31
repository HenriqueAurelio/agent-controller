import { randomUUID } from 'node:crypto';
import { EventEmitter } from 'node:events';
import fs from 'node:fs';
import { sanitizeAgentCommand } from '@shared/agents';
import type { ChecksSummary } from '@shared/checks';
import { errorText, translate, UserError, type MessageKey, type MessageParams } from '@shared/i18n';
import type { Preferences } from '@shared/prefs';
import { sameOverlapSummary, type OverlapSummary } from '@shared/overlaps';
import type { FlowMark, GroupFlow } from '@shared/flows';
import type { ReviewerSummary } from '@shared/reviewer';
import type { QueueSummary, SendOutcome, SendTextOptions } from '@shared/prompts';
import {
  AUX_SCROLLBACK,
  auxTerminalId,
  initialStatus,
  isBusyForText,
  parseTerminalId,
  GROUP_NAME_LIMIT,
  GROUPS_LIMIT,
  type GroupUpdate,
  type HooksMode,
  type NewSessionInput,
  type PermissionAsk,
  type PermissionChoice,
  type PermissionOutcome,
  type Session,
  type SessionGroup,
  type SessionStatus,
  type SessionView,
  type Signal,
  type WorktreeOnClose,
  type TerminalSize,
} from '@shared/session';
import {
  createAdapter,
  getProfile,
  interactiveShell,
  menuChoices,
  permissionKeys,
  type AgentAdapter,
  type LaunchCommand,
} from '../agents';
import { repositoryRoot } from '../git/GitService';
import {
  checkBranchName,
  createWorktree,
  removeWorktree,
  suggestWorktreeFolder,
} from '../git/WorktreeService';
import { ScreenHistory } from '../history/ScreenHistory';
import { UsageTracker } from './UsageTracker';
import type { PtyManager } from '../pty/PtyManager';
import { toLongPath } from '../pty/longPath';
import type { HookMessage } from '../signals/HookServer';
import { SilenceDetector } from '../signals/SilenceDetector';
import { folderKey } from '../store/recentFolders';
import { StreamParser } from '../signals/StreamParser';
import { runInShell, type RunResult } from '../tools/ToolRunner';
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
  /** Raw agent output, even while no terminal is mounted. */
  output: [id: string, data: string];
  /** Keys typed into an agent terminal. The app may retain task context from them. */
  input: [id: string, data: string];
  sentText: [id: string, text: string];
  /** The session restarted: a mounted terminal must be cleared. */
  reset: [id: string];
  /** A parked terminal is back on screen and behind: its whole content, to replace it. */
  resync: [id: string, data: string];
  transition: [SessionTransition];
  started: [session: Session];
  removed: [id: string];
  /** A permission request can now be answered from outside the terminal. */
  permission: [session: SessionView];
}

export interface SessionManagerOptions {
  ptys: PtyManager;
  sessions: Session[];
  /** In the order they are listed. */
  groups?: SessionGroup[];
  selectedId: string | null;
  prefs: Preferences;
  /** How to open the agent of a session. Throws with a message for the user when it cannot. */
  resolveLaunch: (session: Session) => LaunchCommand;
  /** The shell for the terminal beside the agent. Default: the user's own. */
  resolveAuxShell?: (session: Session) => LaunchCommand;
  /** Called (debounced) whenever what is persisted changed. */
  persist: (sessions: Session[], selectedId: string | null, groups: SessionGroup[]) => void;
  /** How the command that prepares a new copy runs. The default is the user's shell. */
  runSetup?: (command: string, cwd: string) => Promise<RunResult>;
  now?: () => number;
}

/** How a session in a copy of its repository is made. */
export interface WorktreeCreation {
  /** The folder the copies of every repository go into. */
  parent: string;
  /** Run once in the new copy, in the user's shell, before the session exists (`npm ci`). */
  setup?: string;
}

export const SETUP_TIMEOUT_MS = 15 * 60 * 1000;
/** Lines of the output of a setup that failed that the error carries. */
const SETUP_ERROR_LINES = 15;

const defaultSetup = (command: string, cwd: string): Promise<RunResult> =>
  // Tools print less color and no prompts when they know nobody is at the keyboard.
  runInShell(command, { cwd, env: { ...process.env, CI: '1' }, timeoutMs: SETUP_TIMEOUT_MS });

/** A process in a PTY as the renderer sees it: its screen, and what is on the way to it. */
interface Stream {
  history: ScreenHistory;
  running: boolean;
  stopRequested: boolean;
  /**
   * `pending`: an attach is waiting for the history to catch up. `parked`: the terminal is
   * mounted but out of sight, and gets nothing until it is shown again.
   */
  attached: 'no' | 'pending' | 'yes' | 'parked';
  visible: boolean;
  /** Output arrived while parked: the terminal's screen is behind the history's. */
  missed: boolean;
  buffer: string[];
  bufferedChars: number;
  flushTimer: ReturnType<typeof setTimeout> | null;
  /** `performance.now()` of the last batch sent to the renderer. */
  lastFlushAt: number;
  /** `performance.now()` of the last key typed into it. */
  lastInputAt: number;
  /** Characters sent to the renderer and not yet acknowledged. */
  unacked: number;
  paused: boolean;
}

interface PendingSend {
  text: string;
  submit: boolean;
}

/** A permission request of the agent, from its hook until it is answered or moves on. */
interface OpenPermission {
  ask: PermissionAsk;
  /** What the menu on the screen offers; null until the menu shows up. */
  shown: PermissionChoice[] | null;
  checkTimer: ReturnType<typeof setTimeout> | null;
}

/** The agent's process, plus what reads its signals. */
interface Runtime extends Stream {
  parser: StreamParser;
  adapter: AgentAdapter;
  silence: SilenceDetector;
}

interface Entry {
  session: Session;
  aggregator: SignalAggregator;
  hooks: HooksMode;
  unread: boolean;
  checks?: ChecksSummary;
  /** What the list shows of the queue of prompts of the session, which `PromptQueue` owns. */
  queue?: QueueSummary;
  overlaps?: OverlapSummary;
  /** The reviewer of the session, and the session this one reviews (ADR 0023). */
  reviewer?: ReviewerSummary;
  reviewing?: string;
  /** The rules of the group that start or end at the session (ADR 0024). */
  flow?: FlowMark;
  /** Texts the user sent while the agent worked: they go when the turn ends, in order. */
  pending: PendingSend[];
  /** A visual terminal exists for this session, whether or not the agent is running. */
  mounted: boolean;
  visible: boolean;
  runtime: Runtime | null;
  /** The plain shell beside the agent, while it is open. No signals, no state of its own. */
  aux: Stream | null;
  permission: OpenPermission | null;
  /** Bumped by the agent's output: what changed since a glance at its last lines. */
  outputSeq: number;
}

const DEFAULT_SIZE: TerminalSize = { cols: 100, rows: 30 };
// The terminal in sight is fed once per frame at most. Mounted terminals out of sight are not
// fed at all: they catch up from the history when shown again.
export const FOREGROUND_FLUSH_MS = 8;
const FLUSH_NOW_CHARS = 128 * 1024;
/** Output up to this size, soon after a key, is taken for its echo. */
export const ECHO_MAX_CHARS = 1024;
/** How soon after a key its echo is expected. */
export const ECHO_WINDOW_MS = 100;

/** When output arrives on a stream, and how much is waiting. */
export interface FlushTiming {
  now: number;
  lastFlushAt: number;
  lastInputAt: number;
  pendingChars: number;
}

/**
 * How long new output waits before it is sent to the terminal on screen. A small piece right
 * after a key (its echo, most of the time) goes at once. Anything else waits for the batch: an
 * agent's spinner sent piece by piece would cost a draw each, measured at 4% of a core more with
 * 6 busy sessions.
 */
export function flushDelay(t: FlushTiming): number {
  const echo =
    t.now - t.lastInputAt <= ECHO_WINDOW_MS &&
    t.now - t.lastFlushAt >= FOREGROUND_FLUSH_MS &&
    t.pendingChars <= ECHO_MAX_CHARS;
  return echo ? 0 : FOREGROUND_FLUSH_MS;
}

/** Whether the history, rather than a terminal on screen, answers the program's queries. */
function answersQueries(stream: Stream): boolean {
  return stream.attached === 'no' || stream.attached === 'parked';
}

/**
 * Between a paste and the Enter that sends it. Where ConPTY drops the paste markers, an Enter in
 * the same burst of keys reads as a line break inside the paste.
 */
export const SUBMIT_DELAY_MS = 200;
/** After output, how long to wait before reading the screen for the menu of a permission. */
export const MENU_CHECK_MS = 80;
// Backpressure thresholds, in characters waiting on the renderer plus the history.
export const HIGH_WATER = 256 * 1024;
export const LOW_WATER = 32 * 1024;

/**
 * Owns the sessions: their list, their processes and their state. Knows nothing about Electron;
 * the main process only forwards its events over IPC.
 */
export class SessionManager extends EventEmitter<ManagerEvents> {
  private readonly entries = new Map<string, Entry>();
  /** Tokens and context of each conversation, from the file the agent writes. */
  private readonly usage = new UsageTracker();
  private outputCounter = 0;
  /** Shells beside an agent that were closed and are still ending, by session. */
  private readonly auxClosing = new Map<string, Promise<void>>();
  private order: string[] = [];
  private groups: SessionGroup[] = [];
  private selectedId: string | null;
  private windowFocused = true;
  private prefs: Preferences;
  private persistTimer: ReturnType<typeof setTimeout> | null = null;
  private readonly now: () => number;

  constructor(private readonly options: SessionManagerOptions) {
    super();
    this.usage.on('usage', () => this.changed());
    this.now = options.now ?? Date.now;
    this.prefs = options.prefs;
    this.groups = (options.groups ?? []).map((group) => ({ ...group }));
    for (const session of [...options.sessions].sort((a, b) => a.order - b.order)) {
      const { groupId, ...rest } = session;
      const known = groupId && this.groups.some((group) => group.id === groupId);
      this.entries.set(session.id, this.newEntry(known ? session : rest));
      this.order.push(session.id);
    }
    this.normalize();
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
      pending: [],
      mounted: false,
      visible: false,
      runtime: null,
      aux: null,
      permission: null,
      outputSeq: 0,
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
      ...(entry.checks && { checks: entry.checks }),
      ...(entry.queue && { queue: entry.queue }),
      ...(entry.overlaps && { overlaps: entry.overlaps }),
      ...(entry.reviewer && { reviewer: entry.reviewer }),
      ...(entry.reviewing && { reviewing: entry.reviewing }),
      ...(entry.flow && { flow: entry.flow }),
      ...(entry.pending.length > 0 && { pendingSends: entry.pending.length }),
      ...(entry.aux && { auxOpen: true }),
      ...(entry.permission?.shown && {
        permission: { ...entry.permission.ask, choices: entry.permission.shown },
      }),
      ...(this.usage.usageOf(entry.session.id) && {
        usage: this.usage.usageOf(entry.session.id),
      }),
    };
  }

  /** What the list shows of the checks of a session. Not persisted: it lasts while the app does. */
  setChecks(id: string, checks: ChecksSummary | undefined): void {
    const entry = this.entries.get(id);
    if (!entry) return;
    entry.checks = checks;
    this.changed();
  }

  /** What the list shows of the queue of a session; undefined when it is empty. */
  setQueue(id: string, queue: QueueSummary | undefined): void {
    const entry = this.entries.get(id);
    if (!entry) return;
    entry.queue = queue;
    this.changed();
  }

  /** What the list shows of the files other sessions also changed. Not persisted either. */
  setOverlaps(id: string, overlaps: OverlapSummary | undefined): void {
    const entry = this.entries.get(id);
    if (!entry || sameOverlapSummary(entry.overlaps, overlaps)) return;
    entry.overlaps = overlaps;
    this.changed();
  }

  /** What the list shows of the reviewer of a session, or of whom it reviews. Not persisted. */
  setReviewer(id: string, reviewer: ReviewerSummary | undefined, reviewing?: string): void {
    const entry = this.entries.get(id);
    if (!entry) return;
    if (
      JSON.stringify(entry.reviewer) === JSON.stringify(reviewer) &&
      entry.reviewing === reviewing
    ) {
      return;
    }
    entry.reviewer = reviewer;
    entry.reviewing = reviewing;
    this.changed();
  }

  /** What the list shows of the flow of the group of a session. Not persisted. */
  setFlowMark(id: string, flow: FlowMark | undefined): void {
    const entry = this.entries.get(id);
    if (!entry || JSON.stringify(entry.flow) === JSON.stringify(flow)) return;
    entry.flow = flow;
    this.changed();
  }

  /** The rules of a group are kept with it, so they come back with the app. */
  setGroupFlow(groupId: string, flow: GroupFlow | undefined): void {
    const group = this.group(groupId);
    if (flow && flow.rules.length) group.flow = flow;
    else delete group.flow;
    this.changed(true);
  }

  /** In the order they are listed: the sessions with no group, then each group's, in turn. */
  list(): SessionView[] {
    return this.order.map((id) => this.view(this.entries.get(id)!));
  }

  listGroups(): SessionGroup[] {
    return this.groups.map((group) => ({ ...group }));
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
    this.options.persist(sessions, this.selectedId, this.listGroups());
  }

  create(input: NewSessionInput): SessionView {
    const { name, cwd, command, groupId } = this.checkInput(input);

    const session: Session = {
      id: randomUUID(),
      name,
      cwd,
      profile: input.profile,
      ...(command && { command }),
      ...(input.model?.trim() && { model: input.model.trim().slice(0, 120) }),
      ...(input.reasoning?.trim() && { reasoning: input.reasoning.trim().slice(0, 120) }),
      ...(input.readOnly === true && { readOnly: true }),
      ...(groupId && { groupId }),
      order: this.order.length,
    };
    const entry = this.newEntry(session);
    this.entries.set(session.id, entry);
    this.order.push(session.id);
    this.normalize();
    if (!input.keepSelection || this.selectedId === null) this.selectedId = session.id;
    this.changed(true);
    return this.view(entry);
  }

  /** What a new session would refuse, checked before anything is created for it. */
  private checkInput(input: NewSessionInput) {
    const name = input.name.trim();
    if (!name) throw new UserError('error.session.noName');
    const cwd = this.folder(input.cwd);
    getProfile(input.profile); // Throws on an unknown profile.
    // A group that is gone throws here, before any copy of the repository is made for it.
    const groupId = input.groupId ? this.group(input.groupId).id : undefined;
    return { name, cwd, command: sanitizeAgentCommand(input.command), groupId };
  }

  /**
   * A session in a new copy of the repository of `input.cwd` (`git worktree`), on a new branch.
   * The copy is made, and prepared when there is a command for it, before the session exists:
   * when either fails, there is no session and the error says why.
   */
  async createInWorktree(input: NewSessionInput, creation: WorktreeCreation): Promise<SessionView> {
    const wanted = input.worktree;
    if (!wanted) return this.create(input);
    const { cwd } = this.checkInput(input);
    const repoRoot = await repositoryRoot(cwd);
    if (!repoRoot) throw new UserError('error.worktree.notRepo', { folder: cwd });
    const branch = await checkBranchName(repoRoot, wanted.branch);
    const created = await createWorktree({
      repo: repoRoot,
      branch,
      base: wanted.base,
      folder: suggestWorktreeFolder(creation.parent, repoRoot, branch),
    });
    const setup = creation.setup?.trim();
    if (setup) {
      const result = await (this.options.runSetup ?? defaultSetup)(setup, created.folder);
      if (result.exitCode !== 0 || result.timedOut || result.error !== undefined) {
        const output = (result.error ?? result.output).trimEnd().split('\n');
        // The copy and its branch stay: nothing is deleted without being asked.
        throw new UserError('error.worktree.setupFailed', {
          command: setup,
          folder: created.folder,
          output: output.slice(-SETUP_ERROR_LINES).join('\n'),
        });
      }
    }
    const view = this.create({ ...input, cwd: created.folder, worktree: undefined });
    const entry = this.entries.get(view.id)!;
    entry.session = {
      ...entry.session,
      worktree: { repoRoot: created.repoRoot, branch: created.branch, base: created.base },
    };
    this.changed(true);
    return this.view(entry);
  }

  /** Other sessions working in the same folder: a copy they share is not removed under them. */
  sharing(id: string): Session[] {
    const cwd = this.entries.get(id)?.session.cwd;
    if (!cwd) return [];
    return [...this.entries.values()]
      .filter((e) => e.session.id !== id && folderKey(e.session.cwd) === folderKey(cwd))
      .map((e) => e.session);
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
    // The shell beside the agent is in the old folder too.
    await Promise.all([this.stop(id), this.closeAux(id)]);
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

  /** A session keeps its group: within the list, it only moves among the sessions of that group. */
  reorder(orderedIds: string[]): void {
    const known = orderedIds.filter((id) => this.entries.has(id));
    const rest = this.order.filter((id) => !known.includes(id));
    this.order = [...new Set([...known, ...rest])];
    this.normalize();
    this.changed(true);
  }

  // ---- groups ---------------------------------------------------------------------------------

  /**
   * Keeps the sessions of each group together, groups in their order, and the ones with no group
   * first. Sorting is stable: within a group, the sessions keep the order they had.
   */
  private normalize(): void {
    const position = new Map(this.groups.map((group, index) => [group.id, index]));
    const rank = (id: string) => {
      const groupId = this.entries.get(id)!.session.groupId;
      return groupId === undefined ? -1 : (position.get(groupId) ?? -1);
    };
    this.order = [...this.order].sort((a, b) => rank(a) - rank(b));
  }

  private group(id: string): SessionGroup {
    const found = this.groups.find((group) => group.id === id);
    if (!found) throw new UserError('error.group.notFound');
    return found;
  }

  private groupName(name: string): string {
    const trimmed = name.trim().slice(0, GROUP_NAME_LIMIT);
    if (!trimmed) throw new UserError('error.group.noName');
    return trimmed;
  }

  /** A new group, listed last, holding the sessions given. */
  createGroup(
    name: string,
    sessionIds: string[] = [],
    options: { experimentId?: string } = {},
  ): SessionGroup {
    const clean = this.groupName(name);
    if (this.groups.length >= GROUPS_LIMIT) throw new UserError('error.group.tooMany');
    const group: SessionGroup = {
      id: randomUUID(),
      name: clean,
      collapsed: false,
      ...(options.experimentId && { experimentId: options.experimentId }),
    };
    this.groups.push(group);
    this.assign(sessionIds, group.id);
    this.normalize();
    this.changed(true);
    return { ...group };
  }

  updateGroup(id: string, update: GroupUpdate): void {
    const group = this.group(id);
    const name = update.name === undefined ? group.name : this.groupName(update.name);
    group.name = name;
    if (update.collapsed !== undefined) group.collapsed = update.collapsed;
    if (update.sessionIds) {
      const keep = new Set(update.sessionIds);
      for (const entry of this.entries.values()) {
        if (entry.session.groupId === id && !keep.has(entry.session.id)) this.ungroup(entry);
      }
      this.assign(update.sessionIds, id);
      this.normalize();
    }
    this.changed(true);
  }

  /** Ends the group, not its sessions: they go back to the list on their own. */
  removeGroup(id: string): void {
    this.group(id);
    for (const entry of this.entries.values()) {
      if (entry.session.groupId === id) this.ungroup(entry);
    }
    this.groups = this.groups.filter((group) => group.id !== id);
    this.normalize();
    this.changed(true);
  }

  reorderGroups(orderedIds: string[]): void {
    const byId = new Map(this.groups.map((group) => [group.id, group]));
    const known = [...new Set(orderedIds)].flatMap((id) => byId.get(id) ?? []);
    this.groups = [...known, ...this.groups.filter((group) => !known.includes(group))];
    this.normalize();
    this.changed(true);
  }

  /** Moves sessions into a group, after the ones it has; `null` takes them out of any group. */
  setGroup(sessionIds: string[], groupId: string | null): void {
    if (groupId === null) {
      for (const id of sessionIds) {
        const entry = this.entries.get(id);
        if (entry) this.ungroup(entry);
      }
    } else {
      this.assign(sessionIds, this.group(groupId).id);
    }
    this.normalize();
    this.changed(true);
  }

  /**
   * Sessions that join a group go to its end, whatever their place was, in the order they had in
   * the list.
   */
  private assign(sessionIds: string[], groupId: string): void {
    const asked = new Set(sessionIds);
    const joining = this.order.filter((id) => {
      if (!asked.has(id)) return false;
      const entry = this.entries.get(id);
      if (!entry || entry.session.groupId === groupId) return false;
      entry.session = { ...entry.session, groupId };
      return true;
    });
    this.order = [...this.order.filter((id) => !joining.includes(id)), ...joining];
  }

  private ungroup(entry: Entry): void {
    if (entry.session.groupId === undefined) return;
    const { groupId: _left, ...session } = entry.session;
    entry.session = session;
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

  /**
   * Closes a session. For one in a copy of its repository, `worktree: 'remove'` also removes the
   * copy, but only when nothing in it is uncommitted and no other session works in it; otherwise
   * it throws, and the session stays (stopped). The branch is never deleted.
   */
  async remove(id: string, options: { worktree?: WorktreeOnClose } = {}): Promise<void> {
    const entry = this.entries.get(id);
    if (!entry) return;
    if (options.worktree === 'remove' && entry.session.worktree) {
      const other = this.sharing(id)[0];
      if (other) throw new UserError('error.worktree.inUse', { name: other.name });
    }
    await Promise.all([this.stop(id), this.closeAux(id)]);
    if (options.worktree === 'remove' && entry.session.worktree) {
      await removeWorktree(entry.session.cwd);
    }
    this.disposeRuntime(entry);
    this.usage.stop(id);
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
      entry.aux?.history.setScrollback(Math.min(prefs.scrollback, AUX_SCROLLBACK));
      entry.runtime?.silence.setWindow(prefs.silenceSeconds * 1000);
    }
  }

  // ---- process lifecycle ----------------------------------------------------------------------

  start(id: string, size: TerminalSize = DEFAULT_SIZE): void {
    const entry = this.entries.get(id);
    if (!entry || entry.runtime?.running) return;
    // A new run is a new conversation; the numbers of the old one would mislead.
    this.usage.stop(id);
    const { session } = entry;
    const profile = getProfile(session.profile);

    const runtime: Runtime = {
      history: new ScreenHistory({ ...size, scrollback: this.prefs.scrollback }),
      parser: new StreamParser(),
      adapter: createAdapter(profile, {
        sessionId: id,
        emit: (signal) => this.applySignal(signal),
        setHooks: (mode) => this.setHooks(id, mode),
        ask: (ask) => this.openPermission(id, ask),
        now: this.now,
        transcript: (file) => this.usage.track(id, file, runtime.adapter.usageReader()),
      }),
      silence: new SilenceDetector(
        this.prefs.silenceSeconds * 1000,
        (at) => this.applySignal({ sessionId: id, kind: 'waiting', origin: 'silencio', at }),
        this.now,
      ),
      running: false,
      stopRequested: false,
      // A terminal that is already mounted receives this run from its first byte, or, out of
      // sight, catches up when shown.
      attached: entry.mounted ? (entry.visible ? 'yes' : 'parked') : 'no',
      visible: entry.visible,
      missed: false,
      buffer: [],
      bufferedChars: 0,
      flushTimer: null,
      lastFlushAt: 0,
      lastInputAt: Number.NEGATIVE_INFINITY,
      unacked: 0,
      paused: false,
    };
    // A terminal that is fed answers the program's queries itself; otherwise the history does,
    // so an agent in the background does not stall.
    runtime.history.onReply((reply) => {
      if (answersQueries(runtime) && runtime.running) this.options.ptys.write(id, reply);
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
      this.writeNotice(id, runtime, this.t('notice.pressEnter'));
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
    await Promise.all(this.order.flatMap((id) => [this.stop(id, graceMs), this.closeAux(id)]));
  }

  // ---- the shell beside the agent ---------------------------------------------------------------

  /**
   * Opens a plain shell of the user in the folder of the session, beside its agent. It has no
   * adapter and no signals: what is typed into it never reaches the agent, nor its state.
   */
  openAux(id: string, size: TerminalSize = DEFAULT_SIZE): void | Promise<void> {
    // The shell closed a moment ago is still on its way out, under the same terminal id.
    const closing = this.auxClosing.get(id);
    if (closing) return closing.then(() => this.openAux(id, size));
    const entry = this.entries.get(id);
    if (!entry || entry.aux) return;
    const stream: Stream = {
      history: new ScreenHistory({
        ...size,
        scrollback: Math.min(this.prefs.scrollback, AUX_SCROLLBACK),
      }),
      running: false,
      stopRequested: false,
      attached: 'no',
      visible: false,
      missed: false,
      buffer: [],
      bufferedChars: 0,
      flushTimer: null,
      lastFlushAt: 0,
      lastInputAt: Number.NEGATIVE_INFINITY,
      unacked: 0,
      paused: false,
    };
    const auxId = auxTerminalId(id);
    stream.history.onReply((reply) => {
      if (answersQueries(stream) && stream.running) this.options.ptys.write(auxId, reply);
    });
    try {
      const launch = this.options.resolveAuxShell?.(entry.session) ?? interactiveShell();
      this.options.ptys.create({
        id: auxId,
        file: launch.file,
        args: launch.args,
        env: launch.env,
        cwd: entry.session.cwd,
        cols: size.cols,
        rows: size.rows,
      });
    } catch (err) {
      stream.history.dispose();
      throw new UserError('error.aux.startFailed', {
        error: errorText(this.prefs.language, err),
      });
    }
    stream.running = true;
    entry.aux = stream;
    this.changed();
  }

  /** Ends the shell beside the agent, and whatever it started. */
  async closeAux(id: string): Promise<void> {
    const entry = this.entries.get(id);
    const stream = entry?.aux;
    if (!entry || !stream) return;
    stream.stopRequested = true;
    // The pane goes at once: ending the process tree takes about two seconds on Windows, and a
    // pane that lingers that long reads as a click that did not take.
    this.disposeAux(entry, stream);
    // A shell does not leave on Ctrl+C: the tree goes at once.
    const done: Promise<void> = this.options.ptys
      .kill(auxTerminalId(id), { graceMs: 0 })
      .finally(() => {
        if (this.auxClosing.get(id) === done) this.auxClosing.delete(id);
      });
    this.auxClosing.set(id, done);
    await done;
  }

  private disposeAux(entry: Entry, stream: Stream): void {
    if (entry.aux !== stream) return;
    if (stream.flushTimer) clearTimeout(stream.flushTimer);
    stream.history.dispose();
    entry.aux = null;
    this.changed();
  }

  private disposeRuntime(entry: Entry): void {
    this.clearPermission(entry);
    const runtime = entry.runtime;
    if (!runtime) return;
    if (runtime.flushTimer) clearTimeout(runtime.flushTimer);
    runtime.adapter.dispose();
    runtime.silence.dispose();
    runtime.history.dispose();
    entry.runtime = null;
  }

  private readonly onPtyExit = (id: string, exit: { exitCode: number }): void => {
    const target = parseTerminalId(id);
    if (target.aux) {
      // The user left the shell (`exit`): it closes, as a terminal window would.
      const entry = this.entries.get(target.sessionId);
      if (entry?.aux) this.disposeAux(entry, entry.aux);
      return;
    }
    const entry = this.entries.get(id);
    const runtime = entry?.runtime;
    if (!entry || !runtime) return;
    runtime.running = false;
    runtime.paused = false;
    // Nobody is left to receive them, nor to answer.
    entry.pending = [];
    this.clearPermission(entry);
    runtime.adapter.dispose();
    runtime.silence.dispose();
    this.writeNotice(
      id,
      runtime,
      runtime.stopRequested
        ? this.t('notice.stopped')
        : this.t('notice.exited', { code: exit.exitCode }),
    );
    this.writeNotice(id, runtime, this.t('notice.pressEnter'));
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
    if (!runtime?.running) return;
    runtime.adapter.onHook(message);
    // A hook is a moment the conversation file just grew.
    void this.usage.poke(message.sessionId);
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
    this.usage.setWorking(signal.sessionId, next.state === 'trabalhando');
    // The agent moved on: whatever it asked was answered, in the terminal or otherwise.
    if (next.state !== 'aguardando') this.clearPermission(entry);
    this.releasePending(entry);
    this.changed();
    this.emit('transition', { session: this.view(entry), previous });
    return true;
  }

  // ---- permission requests --------------------------------------------------------------------

  private openPermission(id: string, ask: PermissionAsk): void {
    const entry = this.entries.get(id);
    // Only while the agent is waiting: a request the state did not follow is not shown.
    if (!entry?.runtime?.running || entry.aggregator.status.state !== 'aguardando') return;
    const hadOne = this.clearPermission(entry);
    entry.permission = { ask, shown: null, checkTimer: null };
    if (hadOne) this.changed();
    this.scheduleMenuCheck(entry);
  }

  private clearPermission(entry: Entry): boolean {
    const open = entry.permission;
    if (!open) return false;
    if (open.checkTimer) clearTimeout(open.checkTimer);
    entry.permission = null;
    return open.shown !== null;
  }

  /**
   * Whether the agent's menu is on the screen, and with which options. The hook comes in the same
   * second as the menu, before or after it: the screen is read once the output settles.
   */
  private scheduleMenuCheck(entry: Entry): void {
    const open = entry.permission;
    if (!open || open.checkTimer) return;
    open.checkTimer = setTimeout(() => {
      open.checkTimer = null;
      void this.checkMenu(entry, open);
    }, MENU_CHECK_MS);
  }

  private async checkMenu(entry: Entry, open: OpenPermission): Promise<void> {
    const runtime = entry.runtime;
    if (!runtime) return;
    await runtime.history.flush();
    if (entry.permission !== open || entry.runtime !== runtime) return;
    const choices = menuChoices(getProfile(entry.session.profile), runtime.history.screenText());
    // A menu that is gone keeps its buttons: answering then says the request changed.
    if (!choices || choices.join() === open.shown?.join()) return;
    const first = open.shown === null;
    open.shown = choices;
    this.changed();
    if (first) this.emit('permission', this.view(entry));
  }

  /**
   * Answers the open permission request with the keys of the agent's menu, as if the user pressed
   * them. Nothing is written unless `askId` is still the open request and its menu is still on
   * the screen.
   */
  async answerPermission(
    id: string,
    askId: string,
    choice: PermissionChoice,
  ): Promise<PermissionOutcome> {
    const entry = this.entries.get(id);
    if (!entry) throw new UserError('error.session.notFound');
    const profile = getProfile(entry.session.profile);
    if (!profile.permission) return 'unsupported';
    const open = entry.permission;
    const runtime = entry.runtime;
    if (!open || open.ask.id !== askId || !runtime?.running) return 'stale';
    await runtime.history.flush();
    if (entry.permission !== open || entry.runtime !== runtime || !runtime.running) return 'stale';
    if (entry.aggregator.status.state !== 'aguardando') return 'stale';
    const choices = menuChoices(profile, runtime.history.screenText());
    if (!choices) {
      // Its menu is gone: the agent went on, or asks something else. Its buttons go too.
      this.clearPermission(entry);
      this.changed();
      return 'stale';
    }
    const keys = permissionKeys(profile, choice);
    if (!keys || !choices.includes(choice)) return 'unsupported';
    this.clearPermission(entry);
    runtime.adapter.onUserInput(keys);
    this.options.ptys.write(id, keys);
    this.changed();
    return 'answered';
  }

  /** For restored sessions and tests. */
  statusOf(id: string): SessionStatus {
    return this.entries.get(id)?.aggregator.status ?? initialStatus();
  }

  // ---- terminal stream ----------------------------------------------------------------------------

  /**
   * The stream behind a terminal id: the agent's, or the shell's beside it. `mounted` and
   * `visible` of the entry are the agent's terminal only.
   */
  private streamOf(id: string): { entry: Entry; stream: Stream | null; aux: boolean } | null {
    const target = parseTerminalId(id);
    const entry = this.entries.get(target.sessionId);
    if (!entry) return null;
    return { entry, stream: target.aux ? entry.aux : entry.runtime, aux: target.aux };
  }

  /** Whether a terminal id stands for something that exists: a session, or its open shell. */
  hasTerminal(id: string): boolean {
    const found = this.streamOf(id);
    return found !== null && (!found.aux || found.stream !== null);
  }

  private readonly onPtyData = (id: string, chunk: string): void => {
    const target = parseTerminalId(id);
    if (target.aux) {
      const aux = this.entries.get(target.sessionId)?.aux;
      if (aux) this.deliver(id, aux, chunk);
      return;
    }
    const runtime = this.entries.get(id)?.runtime;
    if (!runtime) return;
    this.emit('output', id, chunk);
    // The signal parser reads everything, with no throttling, whatever the terminal is doing.
    for (const event of runtime.parser.feed(chunk)) {
      if (event.type === 'title') runtime.adapter.onTitle(event.title);
    }
    runtime.silence.activity();
    this.deliver(id, runtime, chunk);
    const entry = this.entries.get(id);
    if (entry?.permission) this.scheduleMenuCheck(entry);
  };

  private deliver(id: string, runtime: Stream, chunk: string): void {
    const entry = this.entries.get(id);
    if (entry && entry.runtime === runtime) entry.outputSeq = ++this.outputCounter;
    runtime.history.write(chunk, () => this.relieve(id, runtime));
    if (runtime.attached === 'parked') {
      runtime.missed = true;
    } else if (runtime.attached !== 'no') {
      runtime.buffer.push(chunk);
      runtime.bufferedChars += chunk.length;
      if (runtime.attached === 'yes') this.scheduleFlush(id, runtime);
    }
    this.applyPressure(id, runtime);
  }

  private scheduleFlush(id: string, runtime: Stream): void {
    if (runtime.bufferedChars >= FLUSH_NOW_CHARS) {
      this.flush(id, runtime);
      return;
    }
    if (runtime.flushTimer) return;
    const wait = flushDelay({
      now: performance.now(),
      lastFlushAt: runtime.lastFlushAt,
      lastInputAt: runtime.lastInputAt,
      pendingChars: runtime.bufferedChars,
    });
    if (wait === 0) {
      this.flush(id, runtime);
      return;
    }
    runtime.flushTimer = setTimeout(() => this.flush(id, runtime), wait);
  }

  private flush(id: string, runtime: Stream): void {
    if (runtime.flushTimer) clearTimeout(runtime.flushTimer);
    runtime.flushTimer = null;
    if (runtime.attached !== 'yes' || runtime.buffer.length === 0) return;
    const data = runtime.buffer.join('');
    runtime.buffer = [];
    runtime.bufferedChars = 0;
    runtime.lastFlushAt = performance.now();
    runtime.unacked += data.length;
    this.emit('data', id, data);
    this.applyPressure(id, runtime);
  }

  private pressure(runtime: Stream): number {
    return runtime.unacked + runtime.bufferedChars + runtime.history.pending;
  }

  private applyPressure(id: string, runtime: Stream): void {
    if (runtime.paused || !runtime.running) return;
    if (this.pressure(runtime) > HIGH_WATER) {
      runtime.paused = true;
      this.options.ptys.pause(id);
    }
  }

  private relieve(id: string, runtime: Stream): void {
    if (!runtime.paused || this.pressure(runtime) > LOW_WATER) return;
    runtime.paused = false;
    this.options.ptys.resume(id);
  }

  /** The renderer finished drawing `chars` characters. */
  ack(id: string, chars: number): void {
    const runtime = this.streamOf(id)?.stream;
    if (!runtime) return;
    runtime.unacked = Math.max(0, runtime.unacked - chars);
    this.relieve(id, runtime);
  }

  /**
   * A visual terminal was mounted. Returns the content to repopulate it; from this call on, new
   * output is sent as `data` events, with nothing lost or duplicated in between.
   */
  async attach(id: string, size: TerminalSize): Promise<TerminalSnapshotData> {
    const found = this.streamOf(id);
    if (!found) return { data: '', ...size };
    if (!found.aux) found.entry.mounted = true;
    const runtime = found.stream;
    if (!runtime) return { data: '', ...size };
    this.resize(id, size);
    runtime.buffer = [];
    runtime.bufferedChars = 0;
    runtime.unacked = 0;
    // Output that arrives while the history catches up is queued for the renderer, because it
    // will not be part of the snapshot.
    runtime.attached = 'pending';
    await runtime.history.flush();
    if (this.streamOf(id)?.stream !== runtime) return { data: '', ...size };
    const snapshot = {
      data: runtime.history.serialize(),
      cols: runtime.history.cols,
      rows: runtime.history.rows,
    };
    runtime.missed = false;
    runtime.attached = 'yes';
    if (!runtime.visible) this.park(id, runtime);
    else if (runtime.buffer.length) this.scheduleFlush(id, runtime);
    return snapshot;
  }

  /** Stops feeding a terminal that left the screen; what it misses is noted, not kept. */
  private park(id: string, runtime: Stream): void {
    if (runtime.flushTimer) clearTimeout(runtime.flushTimer);
    runtime.flushTimer = null;
    if (runtime.buffer.length) runtime.missed = true;
    runtime.buffer = [];
    runtime.bufferedChars = 0;
    // What was sent is still drawn and acknowledged; nothing new will add to it.
    runtime.attached = 'parked';
    this.relieve(id, runtime);
  }

  /**
   * A parked terminal is back on screen. If the program wrote while it was away, its screen is
   * replaced by the history's (`resync`), which has no queries left in it to be answered twice.
   */
  private async unpark(id: string, runtime: Stream): Promise<void> {
    if (!runtime.missed) {
      runtime.attached = 'yes';
      return;
    }
    runtime.attached = 'pending';
    runtime.buffer = [];
    runtime.bufferedChars = 0;
    runtime.unacked = 0;
    await runtime.history.flush();
    // Hidden again, detached or replaced while the history caught up.
    if (this.streamOf(id)?.stream !== runtime || runtime.attached !== 'pending') return;
    if (!runtime.visible) {
      this.park(id, runtime);
      return;
    }
    const data = runtime.history.serialize();
    runtime.missed = false;
    runtime.attached = 'yes';
    this.emit('resync', id, data);
    if (runtime.buffer.length) this.scheduleFlush(id, runtime);
  }

  detach(id: string): void {
    const found = this.streamOf(id);
    if (!found) return;
    if (!found.aux) {
      found.entry.mounted = false;
      found.entry.visible = false;
    }
    const runtime = found.stream;
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

  /**
   * Only the terminal on screen is fed. One that leaves it is parked: the program keeps running
   * and the history keeps up, but the renderer reads nothing until the terminal comes back.
   */
  setVisible(id: string, visible: boolean): Promise<void> {
    const found = this.streamOf(id);
    if (!found) return Promise.resolve();
    if (!found.aux) found.entry.visible = visible;
    const runtime = found.stream;
    if (!runtime || runtime.visible === visible) return Promise.resolve();
    runtime.visible = visible;
    if (!visible) {
      // A pending attach parks itself once the snapshot is out.
      if (runtime.attached === 'yes') this.park(id, runtime);
      return Promise.resolve();
    }
    if (runtime.attached === 'parked') return this.unpark(id, runtime);
    return Promise.resolve();
  }

  input(id: string, data: string): void {
    const found = this.streamOf(id);
    if (found?.stream) found.stream.lastInputAt = performance.now();
    if (found?.aux) {
      // Straight to the shell: the agent and its state never see it.
      if (found.stream?.running) this.options.ptys.write(id, data);
      return;
    }
    const runtime = found?.entry.runtime;
    if (!runtime) return;
    if (!runtime.running) {
      // The way back for an agent that exited: there is no button for it.
      if (data.includes('\r')) {
        this.start(id, { cols: runtime.history.cols, rows: runtime.history.rows });
      }
      return;
    }
    this.emit('input', id, data);
    runtime.adapter.onUserInput(data);
    this.options.ptys.write(id, data);
  }

  /**
   * Text the app hands the agent on the user's behalf. It is not sent: it waits at the agent's
   * prompt for the user to read it and press Enter.
   *
   * It goes as one line, with `⏎` where the breaks were. On Windows, ConPTY drops the markers of a
   * bracketed paste, and with them what tells a line break from Enter: measured with Claude Code
   * 2.1.300, a short text with breaks is sent at once, and a long one ends up where Enter no
   * longer sends it. A text with no break in it cannot be sent by anything but the user's Enter.
   */
  paste(id: string, text: string): void {
    const runtime = this.entries.get(id)?.runtime;
    if (!runtime?.running) throw new UserError('error.session.notRunning');
    // Nor may anything in it end the paste early or act as a key.
    const line = text
      .split(/\r\n?|\n/)
      .map((part) =>
        [...part]
          .filter((ch) => ch.charCodeAt(0) >= 0x20 && ch.charCodeAt(0) !== 0x7f)
          .join('')
          .trim(),
      )
      .filter(Boolean)
      .join(' ⏎ ');
    this.options.ptys.write(id, `\x1b[200~${line}\x1b[201~`);
    runtime.adapter.onUserInput(line);
  }

  /**
   * Text the user asked to send to the agent: right away, or, while the agent is busy, when it
   * finishes its turn. With `submit`, an Enter follows it, a moment later.
   */
  sendText(id: string, text: string, options: SendTextOptions): SendOutcome {
    const entry = this.entries.get(id);
    if (!entry) throw new UserError('error.session.notFound');
    if (!entry.runtime?.running) throw new UserError('error.session.notRunning');
    this.emit('sentText', id, text);
    if (!options.now && (entry.pending.length > 0 || isBusyForText(entry.aggregator.status))) {
      entry.pending.push({ text, submit: options.submit });
      this.changed();
      return 'queued';
    }
    this.deliverText(id, text, options.submit);
    return 'sent';
  }

  /** Drops the texts waiting for the end of the turn. */
  cancelPending(id: string): void {
    const entry = this.entries.get(id);
    if (!entry?.pending.length) return;
    entry.pending = [];
    this.changed();
  }

  private deliverText(id: string, text: string, submit: boolean): void {
    this.paste(id, text);
    if (!submit) return;
    setTimeout(() => {
      const runtime = this.entries.get(id)?.runtime;
      if (!runtime?.running) return;
      runtime.adapter.onUserInput('\r');
      this.options.ptys.write(id, '\r');
    }, SUBMIT_DELAY_MS);
  }

  /**
   * The agent is free again: what was waiting goes, up to the first text that is submitted. The
   * ones after it would land in the middle of the turn that one starts.
   */
  private releasePending(entry: Entry): void {
    if (!entry.pending.length || !entry.runtime?.running) return;
    if (isBusyForText(entry.aggregator.status)) return;
    const id = entry.session.id;
    while (entry.pending.length) {
      const next = entry.pending.shift()!;
      this.deliverText(id, next.text, next.submit);
      if (next.submit) break;
    }
  }

  resize(id: string, size: TerminalSize): void {
    const runtime = this.streamOf(id)?.stream;
    if (!runtime) return;
    runtime.history.resize(size.cols, size.rows);
    if (runtime.running) this.options.ptys.resize(id, size.cols, size.rows);
  }

  async screenText(id: string): Promise<string> {
    const runtime = this.streamOf(id)?.stream;
    if (!runtime) return '';
    await runtime.history.flush();
    return runtime.history.screenText();
  }

  /**
   * A number that grows whenever the agent of the session writes something: the same number
   * means the same last lines. Zero for a session that never ran.
   */
  outputSeq(id: string): number {
    return this.entries.get(id)?.outputSeq ?? 0;
  }

  /** The last lines of the agent's output, as plain text (see `ScreenHistory.tail`). */
  async tail(id: string, lines: number): Promise<string[]> {
    const runtime = this.entries.get(id)?.runtime;
    if (!runtime) return [];
    await runtime.history.flush();
    // The agent may have been restarted, and this history disposed, while it caught up.
    return this.entries.get(id)?.runtime === runtime ? runtime.history.tail(lines) : [];
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
    this.usage.dispose();
  }
}
