// IPC contract shared by main, preload and renderer.
// This is the meeting point of the core and interface fronts: change it only together.
import type { AgentAvailability } from './agents';
import type { CheckConfig, ChecksInfo } from './checks';
import type { DiffBase, FileDiff, FileListing, GitOverview } from './git';
import type { Preferences } from './prefs';
import type { NewSessionInput, SessionView, TerminalSize } from './session';

export interface AppInfo {
  version: string;
  platform: 'win32' | 'linux' | 'darwin';
  /** Sessions run a plain shell instead of an agent (e2e tests and measurements). */
  testMode: boolean;
  /** `safe` after a start that went wrong: no hardware acceleration. */
  gpuMode: 'fast' | 'safe';
}

export interface SessionsSnapshot {
  sessions: SessionView[];
  selectedId: string | null;
}

export interface TerminalSnapshot {
  /** Serialized screen and scrollback, to be written into a freshly mounted terminal. */
  data: string;
  cols: number;
  rows: number;
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
  'sessions:remove': (id: string) => void;
  'sessions:reorder': (orderedIds: string[]) => void;
  'sessions:select': (id: string | null) => void;
  'sessions:start': (id: string, size: TerminalSize) => void;
  'sessions:stop': (id: string) => void;

  'terminal:attach': (id: string, size: TerminalSize) => TerminalSnapshot;
  'terminal:detach': (id: string) => void;
  'terminal:setVisible': (id: string, visible: boolean) => void;
  'terminal:input': (id: string, data: string) => void;
  'terminal:resize': (id: string, size: TerminalSize) => void;
  'terminal:ack': (id: string, chars: number) => void;
  'terminal:screenText': (id: string) => string;

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
  'metrics:update': (metrics: Record<string, SessionMetrics>) => void;
  'prefs:changed': (prefs: Preferences) => void;
  'app:focusSession': (id: string) => void;
  /** The run of the checks of a session changed. */
  'checks:changed': (sessionId: string) => void;
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
  'sessions:select',
  'sessions:start',
  'sessions:stop',
  'terminal:attach',
  'terminal:detach',
  'terminal:setVisible',
  'terminal:input',
  'terminal:resize',
  'terminal:ack',
  'terminal:screenText',
  'git:open',
  'git:refresh',
  'git:close',
  'git:diff',
  'git:save',
  'git:count',
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
  'metrics:update',
  'prefs:changed',
  'app:focusSession',
  'checks:changed',
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
