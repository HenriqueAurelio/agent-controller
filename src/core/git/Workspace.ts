import fs from 'node:fs';
import path from 'node:path';

/** More repositories than this in one session are not looked at. */
export const MAX_REPOSITORIES = 30;
/** Folders read per level while looking for repositories. */
const MAX_FOLDERS = 300;

// Folders that hold other people's repositories, not the ones being worked on.
const SKIPPED = new Set(['node_modules', 'vendor']);

/** True for the root of a repository: `.git` is a folder there, or a file in a worktree. */
export function isRepository(dir: string): boolean {
  return fs.existsSync(path.join(dir, '.git'));
}

/**
 * Repositories below a folder that is not one itself, as paths relative to it with forward
 * slashes. It looks two levels down (`api`, `apps/web`) and does not enter a repository it
 * finds: what is nested in it is asked to git.
 */
export async function findRepositories(
  dir: string,
  depth = 2,
  limit = MAX_REPOSITORIES,
): Promise<string[]> {
  const found: string[] = [];
  const walk = async (relative: string, level: number): Promise<void> => {
    let names: string[];
    try {
      const dirents = await fs.promises.readdir(path.join(dir, relative), { withFileTypes: true });
      names = dirents
        .filter((d) => d.isDirectory() && !d.name.startsWith('.') && !SKIPPED.has(d.name))
        .map((d) => d.name)
        .sort((a, b) => a.localeCompare(b))
        .slice(0, MAX_FOLDERS);
    } catch {
      return; // Gone, or not readable.
    }
    for (const name of names) {
      if (found.length >= limit) return;
      const child = relative ? `${relative}/${name}` : name;
      if (isRepository(path.join(dir, child))) found.push(child);
      else if (level < depth) await walk(child, level + 1);
    }
  };
  await walk('', 1);
  return found;
}
