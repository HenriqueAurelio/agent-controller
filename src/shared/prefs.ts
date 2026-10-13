import { DEFAULT_LAYOUT, sanitizeLayout, type Layout } from './layout';
import { DEFAULT_SHORTCUTS, sanitizeShortcuts, type ShortcutMap } from './shortcuts';

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
  /** The files of the folder also list what is hidden: dotfiles and what .gitignore covers. */
  showHiddenFiles: boolean;
  /** Folder a new session starts from. Empty: the folder of the latest session. */
  defaultFolder: string;
  /** Folders kept at hand, offered first when a session is created. */
  favoriteFolders: string[];
  layout: Layout;
  shortcuts: ShortcutMap;
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
  showHiddenFiles: false,
  defaultFolder: '',
  favoriteFolders: [],
  layout: DEFAULT_LAYOUT,
  shortcuts: DEFAULT_SHORTCUTS,
};

export const SCROLLBACK_LIMITS = { min: 200, max: 20000 } as const;
export const FAVORITE_FOLDERS_LIMIT = 50;

/** A trailing separator does not make another folder. */
const folderKey = (folder: string) => folder.trim().replace(/(?<=[^\\/:])[\\/]+$/, '');

export const isFavoriteFolder = (favorites: readonly string[], folder: string): boolean =>
  favorites.some((other) => folderKey(other) === folderKey(folder));

/** Without the folder when it is a favorite; with it, at the end, when it is not. */
export function toggleFavoriteFolder(favorites: readonly string[], folder: string): string[] {
  return isFavoriteFolder(favorites, folder)
    ? favorites.filter((other) => folderKey(other) !== folderKey(folder))
    : sanitizeFavoriteFolders([...favorites, folder]);
}

export function sanitizeFavoriteFolders(value: unknown): string[] {
  const folders: string[] = [];
  for (const item of Array.isArray(value) ? value : []) {
    if (typeof item !== 'string' || item.length > 4096) continue;
    const folder = folderKey(item);
    if (folder && !isFavoriteFolder(folders, folder)) folders.push(folder);
  }
  return folders.slice(0, FAVORITE_FOLDERS_LIMIT);
}

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
    showHiddenFiles: p.showHiddenFiles === true,
    defaultFolder:
      typeof p.defaultFolder === 'string' && p.defaultFolder.length <= 4096
        ? p.defaultFolder.trim()
        : '',
    favoriteFolders: sanitizeFavoriteFolders(p.favoriteFolders),
    layout: sanitizeLayout(p.layout),
    shortcuts: sanitizeShortcuts(p.shortcuts),
  };
}
