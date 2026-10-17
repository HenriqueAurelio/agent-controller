// IPC contract shared by main, preload and renderer.
// This is the meeting point of the core and interface fronts: change it only together.
import type { AgentAvailability } from './agents';
import type { CheckConfig, ChecksInfo } from './checks';
import type { CheckpointList, CheckpointUsage, RestoreResult } from './checkpoints';
import type { DiffBase, FileChange, FileDiff, FileListing, GitOverview } from './git';
import type { OverlapFile } from './overlaps';
import type { CodeThemeData, CodeThemeInfo } from './codeThemes';
import type { Preferences } from './prefs';
import type {
  PromptValues,
  QueueCondition,
  QueueItemUpdate,
  QueueState,
  SendOutcome,
  SendTextOptions,
} from './prompts';
import type {
  GroupUpdate,
  NewSessionInput,
  PermissionChoice,
  PermissionOutcome,
  SessionGroup,
  SessionView,
  TerminalSize,
  WorktreeOnClose,
} from './session';

export interface AppInfo {
  version: string;
  platform: 'win32' | 'linux' | 'darwin';
  /** Sessions run a plain shell instead of an agent (e2e tests and measurements). */
  testMode: boolean;
  /** `safe` after a start that went wrong: no hardware acceleration. */
  gpuMode: 'fast' | 'safe';
}

export interface SessionsSnapshot {
  /** In the order they are listed: the ones with no group, then each group's. */
  sessions: SessionView[];
  groups: SessionGroup[];
  selectedId: string | null;
}

export interface TerminalSnapshot {
  /** Serialized screen and scrollback, to be written into a freshly mounted terminal. */
  data: string;
  cols: number;
  rows: number;
}

/** What a folder offers to a session in a copy of its repository. */
export interface WorktreeOrigin {
  /** The folder is in a git repository: a copy can be made of it. */
  repo: boolean;
  /** The branch checked out there, which a copy starts from unless told otherwise. */
  current: string | null;
  /** The local branches, the checked-out one first. */
  branches: string[];
}

/** A copy of a repository the app made for a session. */
export interface WorktreeCopy {
  folder: string;
  repoRoot: string;
  branch: string | null;
  /** Bytes in the folder; `sizeComplete` false when it was too big to count all of it. */
  size: number;
  sizeComplete: boolean;
  /** Epoch milliseconds of the last change to the folder itself. */
  modifiedAt: number;
  /** The sessions that work in it. */
  sessions: string[];
}

export interface WorktreesInfo {
  /** Where new copies go: the one of the settings, or the default. */
  folder: string;
  defaultFolder: string;
  /** The setting itself: empty for the default. */
  configuredFolder: string;
  setup: string;
  copies: WorktreeCopy[];
}

export interface SessionMetrics {
  /** Percent of one core, summed over the session's process tree. */
  cpu: number;
  /** Resident memory in bytes, summed over the session's process tree. */
  memory: number;
  processes: number;
}

/** Renderer → main, request/response. */
export interface IpcCommands {
  'app:ping': (message: string) => string;
  'app:info': () => AppInfo;
  /** The file with unsaved edits in the changes panel, or null. Closing the app asks first. */
  'app:setUnsaved': (file: string | null) => void;
  'prefs:get': () => Preferences;
  'prefs:set': (patch: Partial<Preferences>) => Preferences;
  /** Writes the preferences to a file the user picks. Resolves to it, or null when given up. */
  'prefs:export': () => string | null;
  /** Replaces the preferences by the ones of a file the user picks. Null when given up. */
  'prefs:import': () => Preferences | null;
  /** The color themes of the code the user imported (the built-in ones are in codeThemes.ts). */
  'themes:list': () => CodeThemeInfo[];
  'themes:get': (id: string) => CodeThemeData | null;
  /** Imports a VS Code theme file the user picks. Null when given up. */
  'themes:import': () => CodeThemeInfo | null;
  'themes:remove': (id: string) => void;
  'agents:detect': (refresh: boolean) => AgentAvailability[];
  'dialog:pickFolder': (defaultPath?: string) => string | null;
  /** Folders of the latest sessions that still exist, most recent first. */
  'folders:recent': () => string[];
  /** The folder a dropped path stands for: itself, or the one that holds the file. */
  'folders:resolve': (path: string) => string | null;
  'clipboard:read': () => string;
  'clipboard:write': (text: string) => void;
  'shell:openExternal': (url: string) => void;

  'sessions:list': () => SessionsSnapshot;
  'sessions:create': (input: NewSessionInput) => SessionView;
  'sessions:rename': (id: string, name: string) => void;
  /** Another folder for a session. A running agent is ended for it: true when that happened. */
  'sessions:setCwd': (id: string, cwd: string) => boolean;
  /** A new session in the same folder, with the same agent, right below the original. */
  'sessions:duplicate': (id: string) => SessionView;
  /** `worktree`, for a session in a copy of its repository: keep the copy (default) or remove it. */
  /** `checkpoints`: remove the checkpoints of the session from its repository (default: keep). */
  'sessions:remove': (
    id: string,
    options?: { worktree?: WorktreeOnClose; checkpoints?: 'keep' | 'remove' },
  ) => void;
  /** The order within each group; a session never leaves its group by being reordered. */
  'sessions:reorder': (orderedIds: string[]) => void;
  /** Moves sessions to the end of a group; `null` takes them out of their group. */
  'sessions:setGroup': (sessionIds: string[], groupId: string | null) => void;
  'sessions:select': (id: string | null) => void;
  'sessions:start': (id: string, size: TerminalSize) => void;
  'sessions:stop': (id: string) => void;
  /**
   * Answers the permission request `askId` of a session with the keys of its agent's menu. Writes
   * nothing unless that request is still the one open, with its menu on the screen.
   */
  'sessions:answerPermission': (
    sessionId: string,
    askId: string,
    choice: PermissionChoice,
  ) => PermissionOutcome;

  /** A group, listed last, with the sessions given moved into it. */
  'groups:create': (name: string, sessionIds: string[]) => SessionGroup;
  'groups:update': (id: string, update: GroupUpdate) => void;
  /** Ends the group; its sessions stay, with no group. */
  'groups:remove': (id: string) => void;
  'groups:reorder': (orderedIds: string[]) => void;

  'terminal:attach': (id: string, size: TerminalSize) => TerminalSnapshot;
  'terminal:detach': (id: string) => void;
  'terminal:setVisible': (id: string, visible: boolean) => void;
  'terminal:input': (id: string, data: string) => void;
  'terminal:resize': (id: string, size: TerminalSize) => void;
  'terminal:ack': (id: string, chars: number) => void;
  'terminal:screenText': (id: string) => string;
  /**
   * Sends a prompt to the agents of some sessions. Its variables are filled in for each session,
   * here in the main process; a session whose agent is busy gets it when its turn ends.
   */
  'terminal:sendText': (
    sessionIds: string[],
    prompt: { text: string; values?: PromptValues },
    options: SendTextOptions,
  ) => Record<string, SendOutcome>;
  /** Drops what was waiting for the end of the turn to be sent. */
  'terminal:cancelSend': (sessionId: string) => void;
  /** A prompt as it would reach the agent of a session, variables filled in. */
  'prompts:preview': (sessionId: string, text: string, values: PromptValues) => string;
  /** The queue of prompts of a session. */
  'queue:get': (sessionId: string) => QueueState;
  /**
   * Puts a prompt at the end of the queue of each session. Items of the queue go with Enter; a
   * free agent gets it at once.
   */
  'queue:add': (
    sessionIds: string[],
    prompt: { text: string; values?: PromptValues; condition: QueueCondition },
  ) => void;
  'queue:update': (sessionId: string, itemId: string, update: QueueItemUpdate) => void;
  'queue:remove': (sessionId: string, itemId: string) => void;
  'queue:reorder': (sessionId: string, itemIds: string[]) => void;
  'queue:pause': (sessionId: string) => void;
  /** `afterTurn`: the first item waits for the end of the next turn, even with the agent free. */
  'queue:resume': (sessionId: string, options?: { afterTurn?: boolean }) => void;
  /** The first item goes now, whatever its condition: the user's own click. */
  'queue:sendNext': (sessionId: string) => void;
  /** Opens a plain shell in the folder of the session, beside its agent. Its id on the terminal
   * channels is `auxTerminalId(sessionId)`. */
  'aux:open': (sessionId: string, size: TerminalSize) => void;
  /** Ends that shell and whatever it started. */
  'aux:close': (sessionId: string) => void;

  /** Whether a copy of the repository of a folder can be made, and from which branches. */
  'worktrees:inspect': (folder: string) => WorktreeOrigin;
  /** What is not committed in the copy a session works in: what removing it would lose. */
  'worktrees:status': (sessionId: string) => FileChange[];
  /** The copies the app made, with their size and the sessions in each. */
  'worktrees:list': () => WorktreesInfo;
  'worktrees:configure': (settings: { folder: string; setup: string }) => WorktreesInfo;
  /** Removes a copy no session works in, when nothing in it is uncommitted. */
  'worktrees:remove': (folder: string) => WorktreesInfo;

  'git:open': (sessionId: string, base: DiffBase) => GitOverview;
  'git:refresh': (sessionId: string, base: DiffBase) => GitOverview;
  'git:close': (sessionId: string) => void;
  'git:diff': (sessionId: string, path: string, base: DiffBase) => FileDiff;
  /** Writes an edit to the working tree. `expected` null overwrites whatever is on disk. */
  'git:save': (
    sessionId: string,
    path: string,
    content: string,
    expected: string | null,
  ) => { saved: boolean };
  'git:count': (sessionId: string) => number | null;
  /** Puts the changes of these files (paths of the panel) in the index. */
  'git:stage': (sessionId: string, files: string[]) => void;
  'git:unstage': (sessionId: string, files: string[]) => void;
  /** Commits what is staged in one repository of the session (`''`: the one at its root). */
  'git:commit': (sessionId: string, repo: string, message: string) => { commit: string };
  /** Discards the changes of one file, after keeping a copy of it; the id gives it back. */
  'git:discard': (sessionId: string, file: string) => { id: string };
  'git:undoDiscard': (sessionId: string, id: string) => void;
  /**
   * The files of the session that sessions in other copies of the same repository also changed,
   * as of the latest look; the count is in `SessionView.overlaps`.
   */
  'git:overlaps': (sessionId: string) => OverlapFile[];
  /** The timeline of a session: its checkpoints, oldest first (ADR 0021). */
  'checkpoints:list': (sessionId: string) => CheckpointList;
  /**
   * Puts the files of the folder back as they were at a checkpoint of the session, after one more
   * checkpoint of how they are now: the result names it, and restoring it undoes this.
   */
  'checkpoints:restore': (sessionId: string, id: string) => RestoreResult;
  /** Applies how many and for how long checkpoints are kept, now. Resolves to how many went. */
  'checkpoints:prune': (sessionId: string) => number;
  /** What the checkpoints of each session take, for the preferences. */
  'checkpoints:usage': () => CheckpointUsage[];
  /** One folder of the session, relative to its root (the repository, or the session folder). */
  'files:list': (sessionId: string, dir: string, showHidden: boolean) => FileListing;

  /** The checks of the session's folder, the ones its project suggests, and the latest run. */
  'checks:get': (sessionId: string) => ChecksInfo;
  /** Replaces the checks of the session's folder. */
  'checks:configure': (sessionId: string, checks: CheckConfig[]) => ChecksInfo;
  'checks:run': (sessionId: string) => void;
  'checks:cancel': (sessionId: string) => void;
  /** Pastes what failed in the latest run into the agent's prompt, without sending it. */
  'checks:sendFailure': (sessionId: string) => void;
}

/** Main → renderer, one way. */
export interface IpcEvents {
  'sessions:changed': (snapshot: SessionsSnapshot) => void;
  'terminal:data': (id: string, data: string) => void;
  'terminal:reset': (id: string) => void;
  'git:changed': (sessionId: string) => void;
  /** What the session has in common with the others changed: `git:overlaps` has the new detail. */
  'git:overlapsChanged': (sessionId: string) => void;
  'metrics:update': (metrics: Record<string, SessionMetrics>) => void;
  'prefs:changed': (prefs: Preferences) => void;
  'app:focusSession': (id: string) => void;
  /** The run of the checks of a session changed. */
  'checks:changed': (sessionId: string) => void;
  'queue:changed': (sessionId: string, state: QueueState) => void;
  /** The timeline of a session changed: a checkpoint came, went or was restored. */
  'checkpoints:changed': (sessionId: string) => void;
}

export type CommandChannel = keyof IpcCommands;
export type EventChannel = keyof IpcEvents;

export const COMMAND_CHANNELS = [
  'app:ping',
  'app:info',
  'app:setUnsaved',
  'prefs:get',
  'prefs:set',
  'prefs:export',
  'prefs:import',
  'themes:list',
  'themes:get',
  'themes:import',
  'themes:remove',
  'agents:detect',
  'dialog:pickFolder',
  'folders:recent',
  'folders:resolve',
  'clipboard:read',
  'clipboard:write',
  'shell:openExternal',
  'sessions:list',
  'sessions:create',
  'sessions:rename',
  'sessions:setCwd',
  'sessions:duplicate',
  'sessions:remove',
  'sessions:reorder',
  'sessions:setGroup',
  'sessions:select',
  'sessions:start',
  'sessions:stop',
  'sessions:answerPermission',
  'groups:create',
  'groups:update',
  'groups:remove',
  'groups:reorder',
  'terminal:attach',
  'terminal:detach',
  'terminal:setVisible',
  'terminal:input',
  'terminal:resize',
  'terminal:ack',
  'terminal:screenText',
  'terminal:sendText',
  'terminal:cancelSend',
  'prompts:preview',
  'queue:get',
  'queue:add',
  'queue:update',
  'queue:remove',
  'queue:reorder',
  'queue:pause',
  'queue:resume',
  'queue:sendNext',
  'aux:open',
  'aux:close',
  'worktrees:inspect',
  'worktrees:status',
  'worktrees:list',
  'worktrees:configure',
  'worktrees:remove',
  'git:open',
  'git:refresh',
  'git:close',
  'git:diff',
  'git:save',
  'git:count',
  'git:stage',
  'git:unstage',
  'git:commit',
  'git:discard',
  'git:undoDiscard',
  'git:overlaps',
  'checkpoints:list',
  'checkpoints:restore',
  'checkpoints:prune',
  'checkpoints:usage',
  'files:list',
  'checks:get',
  'checks:configure',
  'checks:run',
  'checks:cancel',
  'checks:sendFailure',
] as const satisfies readonly CommandChannel[];

export const EVENT_CHANNELS = [
  'sessions:changed',
  'terminal:data',
  'terminal:reset',
  'git:changed',
  'git:overlapsChanged',
  'metrics:update',
  'prefs:changed',
  'app:focusSession',
  'checks:changed',
  'queue:changed',
  'checkpoints:changed',
] as const satisfies readonly EventChannel[];

// Compile-time check that the runtime lists cover every channel of the contract.
type Missing<All, Listed> = Exclude<All, Listed>;
const _allCommands: Missing<CommandChannel, (typeof COMMAND_CHANNELS)[number]> extends never
  ? true
  : never = true;
const _allEvents: Missing<EventChannel, (typeof EVENT_CHANNELS)[number]> extends never
  ? true
  : never = true;
void _allCommands;
void _allEvents;

/** The single object the preload exposes as `window.api`. */
export interface RendererApi {
  invoke<K extends CommandChannel>(
    channel: K,
    ...args: Parameters<IpcCommands[K]>
  ): Promise<ReturnType<IpcCommands[K]>>;
  on<K extends EventChannel>(channel: K, listener: IpcEvents[K]): () => void;
  /** Where a file dropped on the window is on disk. Empty when it is not a file of the disk. */
  pathForFile(file: File): string;
}
