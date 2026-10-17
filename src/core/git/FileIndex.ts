import fs from 'node:fs';
import path from 'node:path';
import { runGit } from './GitService';
import { isRepository, MAX_REPOSITORIES } from './Workspace';

/** More files than this are not listed: the box is for finding, and the list crosses the IPC once. */
export const MAX_INDEXED_FILES = 50_000;

export interface IndexOptions {
  /** Also list dotfiles and what .gitignore covers (ignored folders are listed by file only). */
  showHidden: boolean;
  maxFiles?: number;
}

export interface FileIndex {
  /** Paths relative to the root, with forward slashes: the ones the changes panel uses. */
  files: string[];
  /** There were more files than `maxFiles`. */
  truncated: boolean;
}

const join = (prefix: string, name: string) => (prefix ? `${prefix}/${name}` : name);
const isDotPath = (file: string) => file.split('/').some((part) => part.startsWith('.'));
const nul = (buffer: Buffer) => buffer.toString('utf8').split('\0').filter(Boolean);

/**
 * Every file under `root`. A repository gives its list to git (`ls-files`, which is fast and
 * already follows .gitignore); a folder that is not one is walked, and so is whatever git cannot
 * answer. Repositories found inside the folder, or inside a repository, get their own question,
 * and their files carry the path from `root`.
 */
export async function buildFileIndex(root: string, options: IndexOptions): Promise<FileIndex> {
  const max = options.maxFiles ?? MAX_INDEXED_FILES;
  const files: string[] = [];
  let truncated = false;
  const add = (file: string): boolean => {
    if (!options.showHidden && isDotPath(file)) return true;
    if (files.length >= max) {
      truncated = true;
      return false;
    }
    files.push(file);
    return true;
  };

  const repos: string[] = [];
  const walks: string[] = [];
  const seen = new Set<string>();
  const found = (prefix: string, dir: string) => {
    if (!isRepository(dir)) {
      walks.push(prefix);
      return;
    }
    // Nested repositories are many in a monorepo of modules: ask for a bounded number.
    if (seen.has(prefix) || seen.size >= MAX_REPOSITORIES) return;
    seen.add(prefix);
    repos.push(prefix);
  };
  found('', root);

  const fromGit = async (prefix: string): Promise<boolean> => {
    const dir = prefix ? path.join(root, prefix) : root;
    try {
      // A tracked file deleted from the folder is still listed here: finding out is a stat of every
      // file (twice the time of the rest), and the caller knows it from the changes.
      const [listed, ignored] = await Promise.all([
        runGit(dir, ['ls-files', '-co', '--exclude-standard', '-z']),
        options.showHidden
          ? runGit(dir, ['ls-files', '-o', '-i', '--exclude-standard', '--directory', '-z'])
          : null,
      ]);
      if (listed.code !== 0 || listed.truncated) return false;
      const names = [...nul(listed.stdout)];
      // Ignored folders come as one entry ("node_modules/"): their contents are not listed.
      if (ignored && ignored.code === 0) names.push(...nul(ignored.stdout));
      for (const name of names) {
        if (name.endsWith('/')) {
          // A repository inside this one shows up as a folder, which git does not enter.
          const child = join(prefix, name.slice(0, -1));
          if (isRepository(path.join(root, child))) found(child, path.join(root, child));
          continue;
        }
        if (!add(join(prefix, name))) break;
      }
      return true;
    } catch {
      return false;
    }
  };

  const walk = async (start: string): Promise<void> => {
    // Breadth first, so a cut-off leaves out the deepest files, not whole branches.
    const queue = [start];
    while (queue.length > 0 && !truncated) {
      const prefix = queue.shift()!;
      const dir = prefix ? path.join(root, prefix) : root;
      let dirents: fs.Dirent[];
      try {
        dirents = await fs.promises.readdir(dir, { withFileTypes: true });
      } catch {
        continue; // Gone, or not readable.
      }
      dirents.sort((a, b) => a.name.localeCompare(b.name));
      const folders: string[] = [];
      for (const dirent of dirents) {
        if (dirent.name === '.git') continue;
        if (!options.showHidden && dirent.name.startsWith('.')) continue;
        const child = join(prefix, dirent.name);
        if (dirent.isDirectory()) folders.push(child);
        else if (dirent.isFile() && !add(child)) break;
      }
      for (const child of folders) {
        if (isRepository(path.join(root, child))) found(child, path.join(root, child));
        else queue.push(child);
      }
    }
  };

  while ((repos.length > 0 || walks.length > 0) && !truncated) {
    const repo = repos.shift();
    if (repo !== undefined) {
      if (!(await fromGit(repo))) walks.push(repo);
      continue;
    }
    await walk(walks.shift()!);
  }
  return { files, truncated };
}

interface Cached {
  at: number;
  value: Promise<FileIndex>;
  timer: NodeJS.Timeout;
}

/**
 * The index of each session, kept in memory only while the box is in use: an answer is reused for
 * a few seconds (opening twice in a row, two requests together), and the list is dropped a
 * minute after the last request.
 */
export class FileIndexCache {
  private readonly entries = new Map<string, Cached>();

  constructor(
    private readonly reuseMs = 10_000,
    private readonly keepMs = 60_000,
  ) {}

  get(key: string, build: () => Promise<FileIndex>): Promise<FileIndex> {
    const now = Date.now();
    const current = this.entries.get(key);
    if (current && now - current.at < this.reuseMs) {
      this.schedule(key, current);
      return current.value;
    }
    if (current) clearTimeout(current.timer);
    const value = build();
    const entry: Cached = { at: now, value, timer: undefined as unknown as NodeJS.Timeout };
    this.entries.set(key, entry);
    this.schedule(key, entry);
    value.catch(() => this.drop(key));
    return value;
  }

  private schedule(key: string, entry: Cached): void {
    clearTimeout(entry.timer);
    entry.timer = setTimeout(() => this.drop(key), this.keepMs);
    entry.timer.unref();
  }

  drop(key: string): void {
    const entry = this.entries.get(key);
    if (entry) clearTimeout(entry.timer);
    this.entries.delete(key);
  }

  /** Forgets every key that starts with `prefix` (a session, whatever the options were). */
  dropPrefix(prefix: string): void {
    for (const key of [...this.entries.keys()]) if (key.startsWith(prefix)) this.drop(key);
  }

  size(): number {
    return this.entries.size;
  }
}
