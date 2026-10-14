import fs from 'node:fs';
import path from 'node:path';
import type { FileEntry, FileListing } from '@shared/git';
import { UserError } from '@shared/i18n';
import { ignoredPaths } from './GitService';

/** A folder with more entries than this is cut short: the tree is for browsing, not for dumps. */
export const MAX_ENTRIES = 5000;

export interface ListOptions {
  /** Also list dotfiles and what .gitignore covers. */
  showHidden: boolean;
  /** The folder is in a git repository: ask git which entries are ignored. */
  git: boolean;
  /** That repository, when it is not the root: where it is, and its path from the root. */
  repo?: { root: string; prefix: string };
  maxEntries?: number;
}

const inside = (root: string, target: string): boolean => {
  const relative = path.relative(root, target);
  return !relative.startsWith('..') && !path.isAbsolute(relative);
};

/**
 * The entries of one folder under `root`, folders first. `dir` is relative to the root, with
 * forward slashes; the empty string is the root itself. Links are listed but never followed, so
 * the listing cannot leave the root.
 */
export async function listDirectory(
  root: string,
  dir: string,
  options: ListOptions,
): Promise<FileListing> {
  const absolute = path.resolve(root, dir);
  if (!inside(root, absolute)) throw new UserError('error.files.outside');
  // A link in the middle of the path could still lead somewhere else.
  const [realRoot, realDir] = await Promise.all([
    fs.promises.realpath(root),
    fs.promises.realpath(absolute),
  ]);
  if (!inside(realRoot, realDir)) throw new UserError('error.files.outside');

  const prefix = path.relative(root, absolute).split(path.sep).filter(Boolean).join('/');
  const dirents = await fs.promises.readdir(absolute, { withFileTypes: true });
  let entries: FileEntry[] = dirents.map((dirent) => ({
    name: dirent.name,
    path: prefix ? `${prefix}/${dirent.name}` : dirent.name,
    kind: dirent.isDirectory() ? 'dir' : 'file',
    hidden: dirent.name.startsWith('.'),
  }));
  if (!options.showHidden) entries = entries.filter((e) => !e.hidden);

  // Git's own folder is not something git answers about; it is hidden by its name already.
  const insideGit = prefix.split('/').includes('.git');
  if (options.git && !insideGit) {
    const repo = options.repo ?? { root, prefix: '' };
    // Git is asked with paths relative to the repository.
    const skip = repo.prefix ? repo.prefix.length + 1 : 0;
    const candidates = entries
      .filter((e) => e.name !== '.git' && e.path.length > skip)
      .map((e) => e.path.slice(skip));
    const ignored = await ignoredPaths(repo.root, candidates).catch(() => new Set<string>());
    for (const entry of entries) if (ignored.has(entry.path.slice(skip))) entry.hidden = true;
    if (!options.showHidden) entries = entries.filter((e) => !e.hidden);
  }

  entries.sort((a, b) =>
    a.kind === b.kind ? a.name.localeCompare(b.name) : a.kind === 'dir' ? -1 : 1,
  );
  const max = options.maxEntries ?? MAX_ENTRIES;
  return { entries: entries.slice(0, max), truncated: entries.length > max };
}
