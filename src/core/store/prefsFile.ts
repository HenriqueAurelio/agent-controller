import { UserError } from '@shared/i18n';
import { sanitizePreferences, type Preferences } from '@shared/prefs';

const KIND = 'agent-controller/preferences';
export const PREFS_FILE_VERSION = 1;
export const PREFS_FILE_MAX_BYTES = 1024 * 1024;

/** The preferences as a file to keep or to take to another machine. Sessions are not in it. */
export function serializePreferences(prefs: Preferences): string {
  // The command of "other" is whatever the person wrote, and may run anything: it stays here.
  const exported = {
    ...prefs,
    externalEditor: { ...prefs.externalEditor, command: '' },
  };
  return `${JSON.stringify({ kind: KIND, version: PREFS_FILE_VERSION, prefs: exported }, null, 2)}\n`;
}

/**
 * Reads a file written by `serializePreferences`. Throws a `UserError` when it is not one. What the file does not say, or says wrongly, comes out as the default.
 */
export function parsePreferencesFile(text: string): Preferences {
  let data: unknown;
  try {
    data = JSON.parse(text);
  } catch {
    throw new UserError('error.prefs.notJson');
  }
  const file = data as { kind?: unknown; version?: unknown; prefs?: unknown } | null;
  if (!file || typeof file !== 'object' || file.kind !== KIND) {
    throw new UserError('error.prefs.notExport');
  }
  if (typeof file.version !== 'number' || file.version > PREFS_FILE_VERSION) {
    throw new UserError('error.prefs.newer');
  }
  if (!file.prefs || typeof file.prefs !== 'object' || Array.isArray(file.prefs)) {
    throw new UserError('error.prefs.empty');
  }
  return sanitizePreferences(file.prefs as Partial<Preferences>);
}
