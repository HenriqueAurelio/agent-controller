export type ThemeName = 'dark' | 'light';

export interface Preferences {
  theme: ThemeName;
  fontFamily: string;
  fontSize: number;
  /** Lines of history kept per session. */
  scrollback: number;
  /** Seconds without output, after activity, before "possivelmente aguardando". 0 disables. */
  silenceSeconds: number;
  notifyWaiting: boolean;
  notifyDone: boolean;
  notifySound: boolean;
}

export const DEFAULT_PREFERENCES: Preferences = {
  theme: 'dark',
  fontFamily: 'Cascadia Mono, Consolas, "DejaVu Sans Mono", monospace',
  fontSize: 13,
  scrollback: 1000,
  silenceSeconds: 20,
  notifyWaiting: true,
  notifyDone: true,
  notifySound: true,
};

export const SCROLLBACK_LIMITS = { min: 200, max: 20000 } as const;

export function sanitizePreferences(input: Partial<Preferences> | undefined): Preferences {
  const p = { ...DEFAULT_PREFERENCES, ...(input ?? {}) };
  const clamp = (n: unknown, min: number, max: number, fallback: number) =>
    typeof n === 'number' && Number.isFinite(n)
      ? Math.min(max, Math.max(min, Math.round(n)))
      : fallback;
  return {
    theme: p.theme === 'light' ? 'light' : 'dark',
    fontFamily:
      typeof p.fontFamily === 'string' && p.fontFamily.trim()
        ? p.fontFamily
        : DEFAULT_PREFERENCES.fontFamily,
    fontSize: clamp(p.fontSize, 8, 32, DEFAULT_PREFERENCES.fontSize),
    scrollback: clamp(
      p.scrollback,
      SCROLLBACK_LIMITS.min,
      SCROLLBACK_LIMITS.max,
      DEFAULT_PREFERENCES.scrollback,
    ),
    silenceSeconds: clamp(p.silenceSeconds, 0, 600, DEFAULT_PREFERENCES.silenceSeconds),
    notifyWaiting: p.notifyWaiting !== false,
    notifyDone: p.notifyDone !== false,
    notifySound: p.notifySound !== false,
  };
}
