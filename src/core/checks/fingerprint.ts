import fs from 'node:fs';
import path from 'node:path';
import { runGit } from '../git/GitService';

/**
 * A summary of the state of the files of a folder: the commit it is on, what git sees as changed,
 * and the size and time of each changed file. Two equal fingerprints mean nothing worth checking
 * again has changed. Null when the folder is not in a repository (or git is missing): then there
 * is no telling, and the checks run.
 */
export async function folderFingerprint(folder: string): Promise<string | null> {
  try {
    const [head, status] = await Promise.all([
      runGit(folder, ['rev-parse', '--verify', '-q', 'HEAD']),
      runGit(folder, ['status', '--porcelain=v1', '-z', '--untracked-files=all']),
    ]);
    if (status.code !== 0) return null;
    const top = await runGit(folder, ['rev-parse', '--show-toplevel']);
    const root = top.code === 0 ? top.stdout.toString('utf8').trim() : folder;
    const entries = status.stdout
      .toString('utf8')
      .split('\0')
      .filter((entry) => entry.length > 3);
    const files = await Promise.all(
      entries.map(async (entry) => {
        const file = entry.slice(3);
        const stat = await fs.promises.stat(path.join(root, file)).catch(() => null);
        return `${entry}:${stat ? `${stat.size}:${stat.mtimeMs}` : '-'}`;
      }),
    );
    return [head.stdout.toString('utf8').trim(), ...files.sort()].join('\n');
  } catch {
    return null;
  }
}
