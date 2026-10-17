import { useSyncExternalStore } from 'react';
import type { AgentAvailability } from '@shared/agents';
import type { AppInfo, SessionMetrics } from '@shared/ipc';
import { DEFAULT_PREFERENCES, type Preferences } from '@shared/prefs';
import type { PermissionChoice, SessionGroup, SessionView } from '@shared/session';

export interface AppState {
  info: AppInfo;
  /** In the order they are listed: the ones with no group, then each group's. */
  sessions: SessionView[];
  groups: SessionGroup[];
  selectedId: string | null;
  metrics: Record<string, SessionMetrics>;
  prefs: Preferences;
  agents: AgentAvailability[];
  /** Folders of the latest sessions that still exist, most recent first. */
  recentFolders: string[];
  /** The session whose permission request changed before the answer reached it. */
  permissionStale: string | null;
}

let state: AppState = {
  info: { version: '', platform: 'win32', testMode: false, gpuMode: 'fast' },
  sessions: [],
  groups: [],
  selectedId: null,
  metrics: {},
  prefs: DEFAULT_PREFERENCES,
  agents: [],
  recentFolders: [],
  permissionStale: null,
};
let staleTimer: ReturnType<typeof setTimeout> | null = null;
/** How long "the request changed" stays in the list. */
const STALE_NOTICE_MS = 6000;
const listeners = new Set<() => void>();
/** Asked before the selected session changes; returning false keeps the current one. */
let leaveGuard: (() => boolean) | null = null;

/** The folders of the sessions as last seen: the recent ones only change when these do. */
let knownFolders: string | null = null;

function set(patch: Partial<AppState>): void {
  state = { ...state, ...patch };
  for (const listener of listeners) listener();
}

/** Mirror of the main process' state. The main process is the only one that changes it. */
export const store = {
  get: () => state,
  subscribe(listener: () => void) {
    listeners.add(listener);
    return () => listeners.delete(listener);
  },

  async init(): Promise<void> {
    const { api } = window;
    api.on('sessions:changed', (snapshot) => {
      set(snapshot);
      void store.refreshRecentFolders();
    });
    api.on('metrics:update', (metrics) => set({ metrics }));
    api.on('prefs:changed', (prefs) => set({ prefs }));
    const [info, snapshot, prefs] = await Promise.all([
      api.invoke('app:info'),
      api.invoke('sessions:list'),
      api.invoke('prefs:get'),
    ]);
    set({ info, ...snapshot, prefs });
    void store.refreshRecentFolders();
    void store.detectAgents(false);
  },

  async detectAgents(refresh: boolean): Promise<AgentAvailability[]> {
    const agents = await window.api.invoke('agents:detect', refresh);
    set({ agents });
    return agents;
  },

  /** Asks again for the recent folders, when the folders of the sessions are not the same. */
  async refreshRecentFolders(force = false): Promise<void> {
    const folders = state.sessions.map((s) => s.cwd).join('\n');
    if (!force && folders === knownFolders) return;
    knownFolders = folders;
    set({ recentFolders: await window.api.invoke('folders:recent') });
  },

  setLeaveGuard(guard: (() => boolean) | null): void {
    leaveGuard = guard;
  },

  select(id: string | null): void {
    if (id === state.selectedId) return;
    if (leaveGuard && !leaveGuard()) return;
    set({ selectedId: id }); // Optimistic: switching must feel instant.
    void window.api.invoke('sessions:select', id);
  },

  /** Order shown while a drag is in progress, before the main process confirms it. */
  reorder(ids: string[]): void {
    const byId = new Map(state.sessions.map((s) => [s.id, s]));
    set({ sessions: ids.flatMap((id) => byId.get(id) ?? []) });
    void window.api.invoke('sessions:reorder', ids);
  },

  /**
   * Puts a session in a group (`null`: in none) and, with `ids`, in that place of the list. Shown
   * at once, as a reorder is.
   */
  async moveToGroup(id: string, groupId: string | null, ids?: string[]): Promise<void> {
    const moved = state.sessions.map((s) => {
      if (s.id !== id) return s;
      const { groupId: _left, ...rest } = s;
      return groupId === null ? rest : { ...rest, groupId };
    });
    const byId = new Map(moved.map((s) => [s.id, s]));
    set({ sessions: ids ? ids.flatMap((other) => byId.get(other) ?? []) : moved });
    await window.api.invoke('sessions:setGroup', [id], groupId);
    if (ids) await window.api.invoke('sessions:reorder', ids);
  },

  /**
   * Answers the permission request the session shows. When it is no longer the one open on the
   * agent's screen, nothing is written and the list says so.
   */
  async answerPermission(sessionId: string, choice: PermissionChoice): Promise<void> {
    const ask = state.sessions.find((s) => s.id === sessionId)?.permission;
    if (!ask) return;
    const outcome = await window.api
      .invoke('sessions:answerPermission', sessionId, ask.id, choice)
      .catch(() => 'stale' as const);
    if (outcome === 'answered') {
      if (state.permissionStale === sessionId) set({ permissionStale: null });
      return;
    }
    if (staleTimer) clearTimeout(staleTimer);
    set({ permissionStale: sessionId });
    staleTimer = setTimeout(() => {
      staleTimer = null;
      set({ permissionStale: null });
    }, STALE_NOTICE_MS);
  },

  reorderGroups(ids: string[]): void {
    const byId = new Map(state.groups.map((g) => [g.id, g]));
    set({ groups: ids.flatMap((id) => byId.get(id) ?? []) });
    void window.api.invoke('groups:reorder', ids);
  },

  setCollapsed(id: string, collapsed: boolean): void {
    set({ groups: state.groups.map((g) => (g.id === id ? { ...g, collapsed } : g)) });
    void window.api.invoke('groups:update', id, { collapsed });
  },
};

export function useAppState<T>(selector: (state: AppState) => T): T {
  return useSyncExternalStore(store.subscribe, () => selector(state));
}
