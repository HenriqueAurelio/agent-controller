import path from 'node:path';
import { sanitizePreferences, type Preferences } from '@shared/prefs';
import { AGENT_PROFILE_IDS, type AgentProfileId, type Session } from '@shared/session';
import { JsonStore, type Migration } from './JsonStore';

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
  selectedSessionId: string | null;
  window: WindowState;
  prefs: Preferences;
}

export const APP_DATA_VERSION = 1;

export const DEFAULT_WINDOW: WindowState = { width: 1280, height: 800, maximized: false };

export function defaultAppData(): AppData {
  return {
    version: APP_DATA_VERSION,
    sessions: [],
    selectedSessionId: null,
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

function validate(raw: unknown): AppData {
  const data = raw as Partial<AppData>;
  const sessions: Session[] = [];
  const seen = new Set<string>();
  for (const s of Array.isArray(data.sessions) ? data.sessions : []) {
    if (!s || typeof s.id !== 'string' || !s.id || seen.has(s.id)) continue;
    if (typeof s.cwd !== 'string' || !isProfile(s.profile)) continue;
    seen.add(s.id);
    // Only the documented fields are kept: anything else (state, env) is dropped on purpose.
    sessions.push({
      id: s.id,
      name: typeof s.name === 'string' && s.name ? s.name : path.basename(s.cwd) || 'Sessão',
      cwd: s.cwd,
      profile: s.profile,
      order: typeof s.order === 'number' ? s.order : sessions.length,
    });
  }
  sessions.sort((a, b) => a.order - b.order).forEach((s, i) => (s.order = i));

  const w = (data.window ?? {}) as Partial<WindowState>;
  const num = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) ? v : undefined);
  return {
    version: APP_DATA_VERSION,
    sessions,
    selectedSessionId:
      typeof data.selectedSessionId === 'string' && seen.has(data.selectedSessionId)
        ? data.selectedSessionId
        : null,
    window: {
      x: num(w.x),
      y: num(w.y),
      width: Math.max(640, num(w.width) ?? DEFAULT_WINDOW.width),
      height: Math.max(400, num(w.height) ?? DEFAULT_WINDOW.height),
      maximized: w.maximized === true,
    },
    prefs: sanitizePreferences(data.prefs),
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
