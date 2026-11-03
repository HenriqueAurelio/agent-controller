// Files a new copy of the repository needs and git does not bring (`.env`, local settings): copied
// from the repository into the copy, once, when it is made. Only what is missing in the copy is
// copied: a file git tracks is already there, and nothing in the copy is overwritten.
import fs from 'node:fs';
import path from 'node:path';

/** The default list: the environment files most projects keep out of git. */
export const DEFAULT_COPY_PATTERNS = ['.env', '.env.*'];

/** A pattern as a test of a name: `*` is any run of characters, inside one folder. */
function matcher(name: string): (candidate: string) => boolean {
  if (!name.includes('*')) return (candidate) => candidate === name;
  const source = name.replace(/[.+?^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*');
  const regex = new RegExp(`^${source}$`);
  return (candidate) => regex.test(candidate);
}

/** Patterns from the settings: one per line or comma; relative, never climbing out. */
export function parseCopyPatterns(text: string): string[] {
  return text
    .split(/[\r\n,]+/)
    .map((p) => p.trim().replace(/\\/g, '/').replace(/^\.\//, ''))
    .filter((p) => p && !p.startsWith('/') && !/^[a-zA-Z]:/.test(p) && !p.split('/').includes('..'))
    .slice(0, 50);
}

/** Copies what the patterns name from `repo` into `copy`; returns the paths copied. */
export async function copyIntoWorktree(
  repo: string,
  copy: string,
  patterns: readonly string[],
): Promise<string[]> {
  const copied: string[] = [];
  for (const pattern of patterns) {
    const dir = path.posix.dirname(pattern);
    const name = path.posix.basename(pattern);
    const test = matcher(name);
    let names: string[];
    try {
      names = await fs.promises.readdir(path.join(repo, dir === '.' ? '' : dir));
    } catch {
      continue;
    }
    for (const found of names.filter(test)) {
      const relative = dir === '.' ? found : `${dir}/${found}`;
      const source = path.join(repo, relative);
      const target = path.join(copy, relative);
      const stat = await fs.promises.lstat(source).catch(() => null);
      if (!stat?.isFile()) continue;
      if (
        await fs.promises.lstat(target).then(
          () => true,
          () => false,
        )
      )
        continue;
      await fs.promises.mkdir(path.dirname(target), { recursive: true });
      await fs.promises.copyFile(source, target, fs.constants.COPYFILE_EXCL);
      copied.push(relative);
    }
  }
  return copied;
}
