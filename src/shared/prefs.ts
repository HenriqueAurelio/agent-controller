import {
  DEFAULT_CHECKPOINT_SETTINGS,
  sanitizeCheckpointSettings,
  type CheckpointSettings,
} from './checkpoints';
import { sanitizeAssociations } from './codeLanguages';
import {
  DEFAULT_OVERLAP_SETTINGS,
  sanitizeOverlapSettings,
  type OverlapSettings,
} from './overlaps';
import { sanitizeCodeThemeId } from './codeThemes';
import { NO_AGENT_COMMANDS, sanitizeAgentCommands, type AgentCommands } from './agents';
import { NO_EXTERNAL_EDITOR, sanitizeExternalEditor, type ExternalEditorPrefs } from './editor';
import { DEFAULT_LANGUAGE, sanitizeLanguage, type Language } from './i18n';
import { DEFAULT_LAYOUT, sanitizeLayout, type Layout } from './layout';
import { factoryPrompts, sanitizePrompts, type PromptTemplate } from './prompts';
import { DEFAULT_SHORTCUTS, sanitizeShortcuts, type ShortcutMap } from './shortcuts';

export type ThemeName = 'dark' | 'light';

export interface Preferences {
  /** The language of every text the app shows. */
  language: Language;
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
  /** Permission requests can be answered from the list and the notification (ADR 0020). */
  permissionButtons: boolean;
  /** The files of the folder also list what is hidden: dotfiles and what .gitignore covers. */
  showHiddenFiles: boolean;
  /** The quick-open shortcut also works while the focus is in a terminal (taking Ctrl+P from it). */
  quickOpenInTerminal: boolean;
  /** Folder a new session starts from. Empty: the folder of the latest session. */
  defaultFolder: string;
  /** Folders kept at hand, offered first when a session is created. */
  favoriteFolders: string[];
  /** Per agent, the command sessions run in place of the agent's own. Empty: the agent's. */
  agentCommands: AgentCommands;
  /** The editor "Open in editor" starts. The command of "other" does not go in the export. */
  externalEditor: ExternalEditorPrefs;
  layout: Layout;
  shortcuts: ShortcutMap;
  /** Saved prompts. They are text only, and go with the exported preferences. */
  prompts: PromptTemplate[];
  /** A prompt sent to an agent is also submitted (Enter), instead of waiting at its prompt. */
  promptSubmit: boolean;
  /** Color theme of the code in the changes panel while the app is dark. */
  codeThemeDark: string;
  /** Color theme of the code in the changes panel while the app is light. */
  codeThemeLight: string;
  /** File name pattern → language of the code, ahead of what the extension says. */
  fileAssociations: Record<string, string>;
  /** Checkpoints per turn: whether they are taken, how many and how long they are kept. */
  checkpoints: CheckpointSettings;
  /** The warning of sessions in other copies of the repository that change the same files. */
  overlaps: OverlapSettings;
}

export const DEFAULT_PREFERENCES: Preferences = {
  language: DEFAULT_LANGUAGE,
  theme: 'dark',
  fontFamily: 'Cascadia Mono, Consolas, "DejaVu Sans Mono", monospace',
  fontSize: 13,
  scrollback: 1000,
  silenceSeconds: 20,
  notifyWaiting: true,
  notifyDone: true,
  notifySound: true,
  permissionButtons: true,
  showHiddenFiles: false,
  quickOpenInTerminal: false,
  defaultFolder: '',
  favoriteFolders: [],
  agentCommands: NO_AGENT_COMMANDS,
  externalEditor: NO_EXTERNAL_EDITOR,
  layout: DEFAULT_LAYOUT,
  shortcuts: DEFAULT_SHORTCUTS,
  prompts: factoryPrompts(DEFAULT_LANGUAGE),
  promptSubmit: false,
  codeThemeDark: 'app-dark',
  codeThemeLight: 'app-light',
  fileAssociations: {},
  checkpoints: DEFAULT_CHECKPOINT_SETTINGS,
  overlaps: DEFAULT_OVERLAP_SETTINGS,
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
  const language = sanitizeLanguage(p.language);
  const shortcuts = sanitizeShortcuts(p.shortcuts);
  const clamp = (n: unknown, min: number, max: number, fallback: number) =>
    typeof n === 'number' && Number.isFinite(n)
      ? Math.min(max, Math.max(min, Math.round(n)))
      : fallback;
  return {
    language,
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
    permissionButtons: p.permissionButtons !== false,
    showHiddenFiles: p.showHiddenFiles === true,
    quickOpenInTerminal: p.quickOpenInTerminal === true,
    defaultFolder:
      typeof p.defaultFolder === 'string' && p.defaultFolder.length <= 4096
        ? p.defaultFolder.trim()
        : '',
    favoriteFolders: sanitizeFavoriteFolders(p.favoriteFolders),
    agentCommands: sanitizeAgentCommands(p.agentCommands),
    externalEditor: sanitizeExternalEditor(p.externalEditor),
    layout: sanitizeLayout(p.layout),
    shortcuts,
    // Missing from what was saved (before prompts existed): the factory ones, in its language.
    prompts: sanitizePrompts(
      input && 'prompts' in input ? input.prompts : undefined,
      language,
      new Set(Object.values(shortcuts).flat()),
    ),
    promptSubmit: p.promptSubmit === true,
    codeThemeDark: sanitizeCodeThemeId(p.codeThemeDark, 'dark'),
    codeThemeLight: sanitizeCodeThemeId(p.codeThemeLight, 'light'),
    fileAssociations: sanitizeAssociations(p.fileAssociations),
    checkpoints: sanitizeCheckpointSettings(p.checkpoints),
    overlaps: sanitizeOverlapSettings(p.overlaps),
  };
}
