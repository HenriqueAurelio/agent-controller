/** Quotes one argument the way the Microsoft C runtime parses a command line. */
export function quoteWindowsArg(arg: string): string {
  if (arg !== '' && !/[\s"]/.test(arg)) return arg;
  let out = '"';
  let backslashes = 0;
  for (const ch of arg) {
    if (ch === '\\') {
      backslashes++;
    } else if (ch === '"') {
      out += '\\'.repeat(backslashes * 2 + 1) + '"';
      backslashes = 0;
    } else {
      out += '\\'.repeat(backslashes) + ch;
      backslashes = 0;
    }
  }
  return out + '\\'.repeat(backslashes * 2) + '"';
}

export function isBatchFile(file: string): boolean {
  return /\.(cmd|bat)$/i.test(file);
}

export interface SpawnTarget {
  file: string;
  /** An array, or a ready command line that node-pty passes through untouched. */
  args: string[] | string;
}

/**
 * CreateProcess cannot start a .cmd/.bat shim (the npm installs of the agents) under ConPTY, so
 * those go through `cmd.exe /d /s /c "<line>"`. With /s, cmd strips only the outer quotes.
 */
export function resolveWindowsSpawn(
  file: string,
  args: string[],
  comspec = process.env.ComSpec || 'cmd.exe',
): SpawnTarget {
  if (!isBatchFile(file)) return { file, args };
  const line = [file, ...args].map((a) => quoteWindowsArg(a)).join(' ');
  return { file: comspec, args: `/d /s /c "${line}"` };
}
