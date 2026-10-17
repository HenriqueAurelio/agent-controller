// Checkpoints of a session: a photo of its folder at the end of each turn that changed files,
// kept in the repository itself under refs of the app's own (ADR 0021).

/**
 * `start`: the folder as the session found it. `turn`: the end of a turn of the agent.
 * `restore`: the folder right before the user went back to another checkpoint, so going back can
 * be undone.
 */
export type CheckpointKind = 'start' | 'turn' | 'restore';

export interface CheckpointInfo {
  /** The number of the checkpoint in the session, as text: what the channels take. */
  id: string;
  kind: CheckpointKind;
  /** The turn the folder was at: 0 at the start, then one more at each turn. */
  turn: number;
  /** Epoch milliseconds. */
  at: number;
  /** Files that differ from the checkpoint before (for the first one, from the last commit). */
  files: number;
  /** Files left out of the photo because they are too big: going back leaves them as they are. */
  skipped: string[];
  /** For `restore`: the turn the user went back to. */
  restoredTo?: number;
  /** How the checks of that turn ended, when they ran. */
  checks?: 'passed' | 'failed';
}

export interface CheckpointList {
  /** False outside a repository, or with checkpoints turned off: the timeline does not show. */
  available: boolean;
  /** Oldest first. */
  items: CheckpointInfo[];
}

export interface CheckpointSettings {
  enabled: boolean;
  /** Checkpoints kept per session; older ones go. */
  keep: number;
  /** Days a checkpoint is kept. */
  days: number;
}

export const DEFAULT_CHECKPOINT_SETTINGS: CheckpointSettings = { enabled: true, keep: 50, days: 7 };
export const CHECKPOINT_LIMITS = { keep: { min: 2, max: 500 }, days: { min: 1, max: 365 } };

export function sanitizeCheckpointSettings(value: unknown): CheckpointSettings {
  const v = (value && typeof value === 'object' ? value : {}) as Partial<CheckpointSettings>;
  const clamp = (n: unknown, { min, max }: { min: number; max: number }, fallback: number) =>
    typeof n === 'number' && Number.isFinite(n)
      ? Math.min(max, Math.max(min, Math.round(n)))
      : fallback;
  return {
    enabled: v.enabled !== false,
    keep: clamp(v.keep, CHECKPOINT_LIMITS.keep, DEFAULT_CHECKPOINT_SETTINGS.keep),
    days: clamp(v.days, CHECKPOINT_LIMITS.days, DEFAULT_CHECKPOINT_SETTINGS.days),
  };
}

export interface RestoreResult {
  /** The checkpoint taken right before going back: restoring it undoes the restore. */
  undoId: string;
  /** Files written or removed. */
  changed: number;
}

/** What the checkpoints of a session take in its repository. */
export interface CheckpointUsage {
  sessionId: string;
  name: string;
  folder: string;
  count: number;
  /** Bytes, on disk, of what only the checkpoints keep. */
  bytes: number;
}

/** The base of the panel that compares one checkpoint with another, or with the folder. */
export const checkpointBase = (from: string, to?: string) =>
  `checkpoint:${from}${to ? `..${to}` : ''}` as const;

export function parseCheckpointBase(base: string): { from: string; to?: string } | null {
  const match = /^checkpoint:(\d{1,9})(?:\.\.(\d{1,9}))?$/.exec(base);
  if (!match) return null;
  return { from: match[1]!, ...(match[2] ? { to: match[2] } : {}) };
}
