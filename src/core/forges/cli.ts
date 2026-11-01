// Where the command-line tools of the services (gh, glab) are, even when the PATH is old.
import { execFile } from 'node:child_process';
import { existsSync } from 'node:fs';
import { join } from 'node:path';

/** The PATH as Windows keeps it now: the machine's, then the user's. */
const REG_KEYS = [
  'HKLM\\SYSTEM\\CurrentControlSet\\Control\\Session Manager\\Environment',
  'HKCU\\Environment',
];
/** How long a tool that was found nowhere stays not found before the registry is read again. */
const MISS_MS = 30_000;

/** The value of `Path` in what `reg query <key> /v Path` printed. */
export function parseRegPath(output: string): string {
  const match = /^\s*Path\s+REG_(?:EXPAND_)?SZ\s+(.*?)\s*$/im.exec(output);
  return match?.[1] ?? '';
}

/** `%USERPROFILE%\bin` with the variables of `env`; an unknown one stays as written. */
export function expandWindowsVars(value: string, env: NodeJS.ProcessEnv): string {
  const byName = new Map(Object.entries(env).map(([k, v]) => [k.toLowerCase(), v]));
  return value.replace(/%([^%]+)%/g, (all, name: string) => byName.get(name.toLowerCase()) ?? all);
}

/** The file of `name` in the folders of a Windows `path` (split by `;`), trying each extension. */
export function findOnPath(
  name: string,
  path: string,
  extensions: readonly string[],
  exists: (file: string) => boolean = existsSync,
): string | null {
  for (const dir of path.split(';')) {
    if (!dir.trim()) continue;
    for (const ext of extensions) {
      const file = join(dir.trim(), name + ext);
      if (exists(file)) return file;
    }
  }
  return null;
}

function readRegPath(key: string): Promise<string> {
  return new Promise((resolve) => {
    execFile(
      'reg',
      ['query', key, '/v', 'Path'],
      { windowsHide: true, timeout: 5000 },
      (error, stdout) => resolve(error ? '' : parseRegPath(stdout)),
    );
  });
}

const found = new Map<string, string>();
const missedAt = new Map<string, number>();

/**
 * The command to spawn for `name`. A process inherits the PATH of whoever started it: on Windows,
 * a tool installed after the app, or after the editor whose terminal started the app, is not on
 * it until everything restarts. So, when the inherited PATH lacks the tool, the one Windows keeps
 * now is read. When it is nowhere, `name` itself: spawning it fails as "not installed".
 */
export async function resolveCli(name: string, env = process.env): Promise<string> {
  if (process.platform !== 'win32') return name;
  const known = found.get(name);
  if (known && existsSync(known)) return known;
  const extensions = (env.PATHEXT ?? '.COM;.EXE;.BAT;.CMD')
    .split(';')
    .filter((ext) => /^\.(exe|cmd|bat|com)$/i.test(ext));
  if (findOnPath(name, env.Path ?? env.PATH ?? '', extensions)) return name;
  if (Date.now() - (missedAt.get(name) ?? -Infinity) < MISS_MS) return name;
  const fresh = (await Promise.all(REG_KEYS.map(readRegPath)))
    .filter(Boolean)
    .map((path) => expandWindowsVars(path, env))
    .join(';');
  const file = findOnPath(name, fresh, extensions);
  if (!file) {
    missedAt.set(name, Date.now());
    return name;
  }
  found.set(name, file);
  return file;
}
