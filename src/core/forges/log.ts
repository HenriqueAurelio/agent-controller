// The end of the log of a failed job, which is where it says why it failed, without the noise
// that would take the place of the lines that matter.

/** ESC sequences of colors and of clearing the line. */
export const ANSI = new RegExp(`${String.fromCharCode(27)}\\[[0-9;]*[A-Za-z]`, 'g');

export const LOG_LINES = 120;

/**
 * The last `lines` of already cleaned lines, without lines of progress dots and lines repeated
 * one after the other.
 */
export function tailLines(all: readonly string[], lines = LOG_LINES): string {
  const kept: string[] = [];
  for (const line of all) {
    if (/^\.{3,}$/.test(line)) continue;
    if (kept.length > 0 && kept[kept.length - 1] === line) continue;
    kept.push(line);
  }
  while (kept.length > 0 && !kept[kept.length - 1]) kept.pop();
  return kept.slice(-lines).join('\n');
}
