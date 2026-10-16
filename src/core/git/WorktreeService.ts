import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { FileChange } from '@shared/git';
import { UserError } from '@shared/i18n';
import { currentBranch, repositoryRoot, runGit, statusChanges } from './GitService';

// The first code of the app that changes a repository: it adds and removes worktrees, and the
// branch of each new one. Nothing else: no commit, no push, and a branch is never deleted.

/** Where the copies go when the preferences say nothing: short, against long paths on Windows. */
export function defaultWorktreesFolder(home = os.homedir()): string {
  return path.join(home, '.agent-controller', 'worktrees');
}

export interface WorktreeEntry {
  folder: string;
  /** Null with a detached HEAD. */
  branch: string | null;
  head: string;
  /** The working tree of the repository itself, not a linked one. */
  main: boolean;
}

export interface CreateWorktreeOptions {
  /** Any folder inside the repository. */
  repo: string;
  branch: string;
  /** What the new branch starts from: a branch, a tag or a commit. */
  base: string;
  /** Where the copy goes. Must not exist yet. */
  folder: string;
}

export interface CreatedWorktree {
  repoRoot: string;
  folder: string;
  branch: string;
  base: string;
}

/** The repository a folder is in, or a `UserError` when it is in none. */
async function rootOf(folder: string): Promise<string> {
  const root = await repositoryRoot(folder);
  if (!root) throw new UserError('error.worktree.notRepo', { folder });
  return root;
}

/** The name as git would take it for a new branch, or a `UserError`. */
export async function checkBranchName(repoRoot: string, name: string): Promise<string> {
  const trimmed = name.trim();
  // A name starting with a dash would be read by git as an option.
  if (!trimmed || trimmed.startsWith('-')) {
    throw new UserError('error.worktree.badBranch', { branch: trimmed });
  }
  const result = await runGit(repoRoot, ['check-ref-format', '--branch', trimmed]);
  if (result.code !== 0) throw new UserError('error.worktree.badBranch', { branch: trimmed });
  return result.stdout.toString('utf8').trim() || trimmed;
}

async function branchExists(repoRoot: string, branch: string): Promise<boolean> {
  const result = await runGit(repoRoot, [
    'show-ref',
    '--verify',
    '--quiet',
    `refs/heads/${branch}`,
  ]);
  return result.code === 0;
}

/** The folder a copy of `repoRoot` on `branch` gets by default, inside `parent`. */
export function suggestWorktreeFolder(parent: string, repoRoot: string, branch: string): string {
  const slug = (text: string) =>
    text
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .replace(/[^\w.-]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 60) || 'copia';
  return path.join(parent, slug(path.basename(repoRoot)), slug(branch.replace(/^ac\//, '')));
}

/** `git worktree add -b <branch> <folder> <base>`, after checking what can be checked first. */
export async function createWorktree(options: CreateWorktreeOptions): Promise<CreatedWorktree> {
  const repoRoot = await rootOf(options.repo);
  const branch = await checkBranchName(repoRoot, options.branch);
  if (await branchExists(repoRoot, branch)) {
    throw new UserError('error.worktree.branchExists', { branch });
  }
  const base = options.base.trim();
  const commit = base.startsWith('-')
    ? null
    : await runGit(repoRoot, ['rev-parse', '--verify', '--quiet', `${base}^{commit}`]);
  if (!base || !commit || commit.code !== 0) {
    throw new UserError('error.worktree.badBase', { base });
  }
  const folder = path.resolve(options.folder);
  if (fs.existsSync(folder)) throw new UserError('error.worktree.folderExists', { folder });
  await fs.promises.mkdir(path.dirname(folder), { recursive: true });
  const result = await runGit(repoRoot, ['worktree', 'add', '-b', branch, '--', folder, base]);
  if (result.code !== 0) {
    throw new UserError('error.worktree.createFailed', { error: result.stderr.trim() });
  }
  return { repoRoot, folder, branch, base };
}

/** Parses `git worktree list --porcelain`. */
export function parseWorktreeList(output: string): WorktreeEntry[] {
  const entries: WorktreeEntry[] = [];
  for (const block of output.split(/\n\n+/)) {
    const lines = block.split('\n').filter(Boolean);
    const folder = lines.find((l) => l.startsWith('worktree '))?.slice('worktree '.length);
    if (!folder) continue;
    const head = lines.find((l) => l.startsWith('HEAD '))?.slice('HEAD '.length) ?? '';
    const ref = lines.find((l) => l.startsWith('branch '))?.slice('branch '.length);
    entries.push({
      folder: path.resolve(folder),
      branch: ref ? ref.replace(/^refs\/heads\//, '') : null,
      head,
      main: entries.length === 0 && !lines.includes('bare'),
    });
  }
  return entries;
}

export async function listWorktrees(repo: string): Promise<WorktreeEntry[]> {
  const repoRoot = await rootOf(repo);
  const result = await runGit(repoRoot, ['worktree', 'list', '--porcelain']);
  if (result.code !== 0) throw new Error(`git worktree list: ${result.stderr.trim()}`);
  return parseWorktreeList(result.stdout.toString('utf8'));
}

/** What is not committed in a copy: what removing it would lose. */
export function worktreeStatus(folder: string): Promise<FileChange[]> {
  return statusChanges(folder);
}

/**
 * The repository a linked worktree belongs to, from its own folder; null when the folder is not
 * one (a plain folder, or the main working tree of a repository).
 */
export async function worktreeOwner(folder: string): Promise<string | null> {
  let marker: string;
  try {
    // A linked worktree has a `.git` file, where a repository has a folder.
    marker = await fs.promises.readFile(path.join(folder, '.git'), 'utf8');
  } catch {
    return null;
  }
  if (!marker.startsWith('gitdir:')) return null;
  const result = await runGit(folder, ['rev-parse', '--git-common-dir']);
  if (result.code !== 0) return null;
  // Relative to the folder asked about, on the versions of git that print it so.
  const common = path.resolve(folder, result.stdout.toString('utf8').trim());
  return path.basename(common) === '.git' ? path.dirname(common) : null;
}

/**
 * `git worktree remove`, never with `--force`: a copy with anything not committed is kept, and
 * the error says what is in it. The branch stays.
 */
export async function removeWorktree(folder: string): Promise<void> {
  const owner = await worktreeOwner(folder);
  if (!owner) throw new UserError('error.worktree.notWorktree', { folder });
  const pending = await worktreeStatus(folder);
  if (pending.length > 0) {
    throw new UserError('error.worktree.dirty', {
      count: pending.length,
      files: pending
        .slice(0, 5)
        .map((change) => change.path)
        .join(', '),
    });
  }
  const result = await runGit(owner, ['worktree', 'remove', '--', folder]);
  if (result.code !== 0) {
    throw new UserError('error.worktree.removeFailed', { error: result.stderr.trim() });
  }
}

/** The local branches, the checked-out one first: what a copy may start from. */
export async function localBranches(
  repo: string,
): Promise<{ current: string | null; all: string[] }> {
  const repoRoot = await rootOf(repo);
  const result = await runGit(repoRoot, [
    'for-each-ref',
    '--format=%(refname:short)',
    '--sort=-committerdate',
    'refs/heads/',
  ]);
  const all = result.code === 0 ? result.stdout.toString('utf8').split('\n').filter(Boolean) : [];
  const current = await currentBranch(repoRoot);
  return { current, all: current ? [current, ...all.filter((b) => b !== current)] : all };
}

/** Bytes under a folder, stopping at `limit` entries: a copy with `node_modules` is huge. */
export async function folderSize(
  folder: string,
  limit = 200_000,
): Promise<{ bytes: number; complete: boolean }> {
  let bytes = 0;
  let seen = 0;
  const queue = [folder];
  while (queue.length > 0) {
    const dir = queue.pop()!;
    let entries: fs.Dirent[];
    try {
      entries = await fs.promises.readdir(dir, { withFileTypes: true });
    } catch {
      continue;
    }
    for (const entry of entries) {
      if (++seen > limit) return { bytes, complete: false };
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) queue.push(full);
      else if (entry.isFile()) {
        try {
          bytes += (await fs.promises.lstat(full)).size;
        } catch {
          // Gone in the meantime.
        }
      }
    }
  }
  return { bytes, complete: true };
}
