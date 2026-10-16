import path from 'node:path';
import { sanitizeAgentCommand } from '@shared/agents';
import { sanitizeChecks, type CheckConfig } from '@shared/checks';
import { translate } from '@shared/i18n';
import { sanitizePreferences, type Preferences } from '@shared/prefs';
import {
  AGENT_PROFILE_IDS,
  type AgentProfileId,
  type Session,
  type SessionGroup,
  type SessionWorktree,
  GROUP_NAME_LIMIT,
  GROUPS_LIMIT,
} from '@shared/session';
import { JsonStore, type Migration } from './JsonStore';
import { folderKey, sanitizeRecentFolders } from './recentFolders';

export interface WindowState {
  x?: number;
  y?: number;
  width: number;
  height: number;
  maximized: boolean;
}

export interface AppData {
  version: number;
  sessions: Session[];
  /** The groups of the list, in the order they are shown. */
  groups: SessionGroup[];
  selectedSessionId: string | null;
  /** Folders of the latest sessions, most recent first: offered when a folder is asked for. */
  recentFolders: string[];
  /**
   * The checks of each folder, by `folderKey`. Kept here and not in the preferences: they are
   * commands to run, and importing a file of preferences must never bring commands in.
   */
  checks: Record<string, CheckConfig[]>;
  /**
   * Where the copies of sessions in a worktree go, and what prepares a new one. Here and not in
   * the preferences, as the checks: the command runs by itself, and an imported file must not
   * bring it in.
   */
  worktrees: WorktreeSettings;
  window: WindowState;
  prefs: Preferences;
}

export interface WorktreeSettings {
  /** Empty: `~/.agent-controller/worktrees`. */
  folder: string;
  /** Empty: nothing runs. */
  setup: string;
}

export const NO_WORKTREE_SETTINGS: WorktreeSettings = { folder: '', setup: '' };

export function sanitizeWorktreeSettings(value: unknown): WorktreeSettings {
  const v = (value && typeof value === 'object' ? value : {}) as Partial<WorktreeSettings>;
  return {
    folder: typeof v.folder === 'string' && v.folder.length <= 4096 ? v.folder.trim() : '',
    setup: sanitizeAgentCommand(v.setup) ?? '',
  };
}

function sanitizeWorktree(value: unknown): SessionWorktree | undefined {
  const v = (value && typeof value === 'object' ? value : {}) as Partial<SessionWorktree>;
  const ok = (s: unknown): s is string => typeof s === 'string' && s.length > 0 && s.length <= 4096;
  return ok(v.repoRoot) && ok(v.branch) && ok(v.base)
    ? { repoRoot: v.repoRoot, branch: v.branch, base: v.base }
    : undefined;
}

export const APP_DATA_VERSION = 1;

export const DEFAULT_WINDOW: WindowState = { width: 1280, height: 800, maximized: false };

export function defaultAppData(): AppData {
  return {
    version: APP_DATA_VERSION,
    sessions: [],
    groups: [],
    selectedSessionId: null,
    recentFolders: [],
    checks: {},
    worktrees: { ...NO_WORKTREE_SETTINGS },
    window: { ...DEFAULT_WINDOW },
    prefs: sanitizePreferences(undefined),
  };
}

const migrations: Record<number, Migration> = {
  // 0: files written before the schema had a version field.
  0: (data) => ({ ...data, sessions: Array.isArray(data.sessions) ? data.sessions : [] }),
};

function isProfile(value: unknown): value is AgentProfileId {
  return AGENT_PROFILE_IDS.includes(value as AgentProfileId);
}

export const CHECKED_FOLDERS_LIMIT = 200;

export function sanitizeFolderChecks(value: unknown): Record<string, CheckConfig[]> {
  const result: Record<string, CheckConfig[]> = {};
  if (!value || typeof value !== 'object' || Array.isArray(value)) return result;
  for (const [folder, checks] of Object.entries(value)) {
    if (!folder || folder.length > 4096) continue;
    const clean = sanitizeChecks(checks);
    if (clean.length) result[folderKey(folder)] = clean;
    if (Object.keys(result).length === CHECKED_FOLDERS_LIMIT) break;
  }
  return result;
}

export function sanitizeGroups(value: unknown): SessionGroup[] {
  const groups: SessionGroup[] = [];
  const seen = new Set<string>();
  for (const g of Array.isArray(value) ? (value as Partial<SessionGroup>[]) : []) {
    if (!g || typeof g.id !== 'string' || !g.id || g.id.length > 64 || seen.has(g.id)) continue;
    const name = typeof g.name === 'string' ? g.name.trim().slice(0, GROUP_NAME_LIMIT) : '';
    if (!name) continue;
    seen.add(g.id);
    groups.push({ id: g.id, name, collapsed: g.collapsed === true });
    if (groups.length === GROUPS_LIMIT) break;
  }
  return groups;
}

function validate(raw: unknown): AppData {
  const data = raw as Partial<AppData>;
  const prefs = sanitizePreferences(data.prefs);
  const groups = sanitizeGroups(data.groups);
  const groupIds = new Set(groups.map((g) => g.id));
  const sessions: Session[] = [];
  const seen = new Set<string>();
  for (const s of Array.isArray(data.sessions) ? data.sessions : []) {
    if (!s || typeof s.id !== 'string' || !s.id || seen.has(s.id)) continue;
    if (typeof s.cwd !== 'string' || !isProfile(s.profile)) continue;
    seen.add(s.id);
    const command = sanitizeAgentCommand(s.command);
    const worktree = sanitizeWorktree(s.worktree);
    // A session of a group that is gone is listed on its own.
    const groupId = typeof s.groupId === 'string' && groupIds.has(s.groupId) ? s.groupId : '';
    // Only the documented fields are kept: anything else (state, env) is dropped on purpose.
    sessions.push({
      id: s.id,
      name:
        typeof s.name === 'string' && s.name
          ? s.name
          : path.basename(s.cwd) || translate(prefs.language, 'session.fallbackName'),
      cwd: s.cwd,
      profile: s.profile,
      ...(command && { command }),
      ...(worktree && { worktree }),
      ...(groupId && { groupId }),
      order: typeof s.order === 'number' ? s.order : sessions.length,
    });
  }
  sessions.sort((a, b) => a.order - b.order).forEach((s, i) => (s.order = i));

  const w = (data.window ?? {}) as Partial<WindowState>;
  const num = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) ? v : undefined);
  return {
    version: APP_DATA_VERSION,
    sessions,
    groups,
    selectedSessionId:
      typeof data.selectedSessionId === 'string' && seen.has(data.selectedSessionId)
        ? data.selectedSessionId
        : null,
    recentFolders: sanitizeRecentFolders(data.recentFolders),
    checks: sanitizeFolderChecks(data.checks),
    worktrees: sanitizeWorktreeSettings(data.worktrees),
    window: {
      x: num(w.x),
      y: num(w.y),
      width: Math.max(640, num(w.width) ?? DEFAULT_WINDOW.width),
      height: Math.max(400, num(w.height) ?? DEFAULT_WINDOW.height),
      maximized: w.maximized === true,
    },
    prefs,
  };
}

export function createAppStore(directory: string): JsonStore<AppData> {
  return new JsonStore<AppData>({
    file: path.join(directory, 'sessions.json'),
    version: APP_DATA_VERSION,
    migrations,
    defaults: defaultAppData,
    validate,
  });
}
