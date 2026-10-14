import fs from 'node:fs';
import path from 'node:path';

/**
 * Absolute path in its long form. On Windows this expands 8.3 short names (`HENRIQ~1`): Codex
 * keys its folder trust on the path text, and the short form made it ask again.
 */
export function toLongPath(input: string): string {
  const absolute = path.resolve(input);
  if (process.platform !== 'win32') return absolute;
  try {
    const long = fs.realpathSync.native(absolute);
    // Keep the drive letter upper case, as the shell reports it.
    return /^[a-z]:/.test(long) ? long.charAt(0).toUpperCase() + long.slice(1) : long;
  } catch {
    return absolute;
  }
}
