// The external editor: which one the user picked, and what the app asks of it.

export const KNOWN_EDITORS = ['vscode', 'cursor', 'zed', 'windsurf'] as const;
export type KnownEditorId = (typeof KNOWN_EDITORS)[number];
export type EditorId = KnownEditorId | 'other';

export const EDITOR_COMMAND_LIMIT = 1000;

export interface ExternalEditorPrefs {
  /** Empty: none picked yet. */
  editor: EditorId | '';
  /** Only for `other`: a command with {pasta}, {arquivo}, {linha} and {coluna}. */
  command: string;
}

export const NO_EXTERNAL_EDITOR: ExternalEditorPrefs = { editor: '', command: '' };

export function sanitizeExternalEditor(value: unknown): ExternalEditorPrefs {
  const input = (value && typeof value === 'object' ? value : {}) as Partial<ExternalEditorPrefs>;
  const editor = (['other', ...KNOWN_EDITORS] as string[]).includes(input.editor as string)
    ? (input.editor as EditorId)
    : '';
  const command =
    typeof input.command === 'string' && input.command.length <= EDITOR_COMMAND_LIMIT
      ? input.command.trim()
      : '';
  return { editor, command };
}

/** What the picker lists: a known editor and whether it was found on the PATH. */
export interface EditorInfo {
  id: KnownEditorId;
  found: boolean;
  path?: string;
}

export interface EditorOpenInput {
  /** Relative to the session folder (or, with `panel`, to the folder the panel lists). */
  file?: string;
  line?: number;
  column?: number;
  panel?: boolean;
}

/** The placeholders of the command of `other`. */
export const EDITOR_PLACEHOLDERS = ['{pasta}', '{arquivo}', '{linha}', '{coluna}'] as const;
