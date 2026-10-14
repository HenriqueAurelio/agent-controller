import { useSyncExternalStore } from 'react';
import type { AgentAvailability } from '@shared/agents';
import type { AppInfo, SessionMetrics } from '@shared/ipc';
import { DEFAULT_PREFERENCES, type Preferences } from '@shared/prefs';
import type { SessionView } from '@shared/session';

export interface AppState {
  info: AppInfo;
  sessions: SessionView[];
  selectedId: string | null;
  metrics: Record<string, SessionMetrics>;
  prefs: Preferences;
  agents: AgentAvailability[];
  /** Folders of the latest sessions that still exist, most recent first. */
  recentFolders: string[];
}

let state: AppState = {
  info: { version: '', platform: 'win32', testMode: false, gpuMode: 'fast' },
  sessions: [],
  selectedId: null,
  metrics: {},
  prefs: DEFAULT_PREFERENCES,
  agents: [],
  recentFolders: [],
};
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
};

export function useAppState<T>(selector: (state: AppState) => T): T {
  return useSyncExternalStore(store.subscribe, () => selector(state));
}
