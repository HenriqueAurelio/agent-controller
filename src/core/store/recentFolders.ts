import path from 'node:path';

export const RECENT_FOLDERS_LIMIT = 8;

/** Two spellings of the same folder (trailing separator, letter case on Windows) are one entry. */
function key(folder: string): string {
  const normalized = path.normalize(folder).replace(/[\\/]+$/, '');
  return process.platform === 'win32' ? normalized.toLowerCase() : normalized;
}

/** `folder` goes to the front of the list, which keeps one entry per folder. */
export function rememberFolder(recent: readonly string[], folder: string): string[] {
  const added = key(folder);
  return [folder, ...recent.filter((other) => key(other) !== added)].slice(0, RECENT_FOLDERS_LIMIT);
}

export function sanitizeRecentFolders(value: unknown): string[] {
  const folders = Array.isArray(value) ? value : [];
  return folders
    .filter((f): f is string => typeof f === 'string' && f.length > 0 && f.length <= 4096)
    .reduceRight<string[]>((list, folder) => rememberFolder(list, folder), []);
}
