import { createHash, randomUUID } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { UserError } from '@shared/i18n';
import { runTool } from '../tools/ToolRunner';
import { hasHead, runGit } from './GitService';

// The few operations the changes panel does on the repository, and only these (ADR 0018): stage
// and unstage a file, commit what is staged, and discard the changes of one file after keeping a
// copy of it. No push, no branch, no amend, nothing on several files at once but staging.
// The `GitService` next to this file keeps only reading.

/** A commit hook gets this long before the commit is given up and the hook ended. */
export const COMMIT_TIMEOUT_MS = 2 * 60 * 1000;
/** Copies of discarded files older than this go away when the app starts. */
export const DISCARD_KEEP_DAYS = 30;

/**
 * A path the panel names, checked as `git:save` does: inside the repository, never in `.git`.
 * Returns it with forward slashes, as git takes it.
 */
export function repoPath(root: string, file: string): string {
  const absolute = path.resolve(root, file);
  const relative = path.relative(root, absolute);
  if (!relative || relative.startsWith('..') || path.isAbsolute(relative)) {
    throw new UserError('error.save.outside');
  }
  if (relative.split(path.sep).some((part) => part.toLowerCase() === '.git')) {
    throw new UserError('error.save.gitInternal');
  }
  return relative.split(path.sep).join('/');
}

/** A git that changes the repository. The lock of the index is never removed by the app. */
async function write(root: string, args: string[], input?: string): Promise<string> {
  const result = await runGit(root, args, { input });
  if (result.code === 0) return result.stdout.toString('utf8');
  if (/index\.lock/.test(result.stderr)) throw new UserError('error.git.locked');
  throw new UserError('error.git.failed', { error: result.stderr.trim() });
}

export async function stage(root: string, files: string[]): Promise<void> {
  if (files.length === 0) return;
  // `--all` takes a removed file too: staging the change, whatever it is.
  await write(root, ['add', '--all', '--', ...files.map((f) => repoPath(root, f))]);
}

export async function unstage(root: string, files: string[]): Promise<void> {
  if (files.length === 0) return;
  const paths = files.map((f) => repoPath(root, f));
  if (await hasHead(root)) await write(root, ['reset', '-q', 'HEAD', '--', ...paths]);
  // Before the first commit there is no HEAD to go back to: out of the index is all there is.
  else await write(root, ['rm', '--cached', '-q', '-r', '--', ...paths]);
}

/** What is staged, as git will commit it. */
export async function stagedFiles(root: string): Promise<string[]> {
  const out = await write(root, ['diff', '--cached', '--name-only', '-z']);
  return out.split('\0').filter(Boolean);
}

export interface CommitResult {
  /** The new commit. */
  commit: string;
  /** What git and the hooks of the repository printed. */
  output: string;
}

/**
 * Commits what is staged, with the message through stdin. The hooks of the repository run, with
 * no terminal and a deadline; when one fails, its output is the error.
 */
export async function commit(
  root: string,
  message: string,
  timeoutMs = COMMIT_TIMEOUT_MS,
): Promise<CommitResult> {
  if (!message.trim()) throw new UserError('error.git.emptyMessage');
  if ((await stagedFiles(root)).length === 0) throw new UserError('error.git.nothingStaged');
  const result = await runTool({
    file: 'git',
    args: ['-c', 'core.quotepath=off', 'commit', '-q', '--cleanup=strip', '-F', '-'],
    cwd: root,
    env: { ...process.env, GIT_TERMINAL_PROMPT: '0' },
    stdin: message,
    timeoutMs,
  });
  if (result.timedOut) throw new UserError('error.git.commitTimedOut');
  if (result.exitCode !== 0) {
    if (/index\.lock/.test(result.output)) throw new UserError('error.git.locked');
    throw new UserError('error.git.commitFailed', {
      output: (result.error ?? result.output).trim(),
    });
  }
  const head = await write(root, ['rev-parse', 'HEAD']);
  return { commit: head.trim(), output: result.output.trim() };
}

/** What was kept of a discarded file, to give it back. */
export interface DiscardRecord {
  id: string;
  root: string;
  file: string;
  /** Epoch milliseconds. */
  at: number;
  /** The file did not exist when it was discarded (a removal): giving it back removes it again. */
  missing: boolean;
  /** What the file is right after the discard, to tell whether someone wrote to it since. */
  after: string | null;
}

const hashOf = async (file: string): Promise<string | null> => {
  try {
    return createHash('sha256')
      .update(await fs.promises.readFile(file))
      .digest('hex');
  } catch {
    return null;
  }
};

const day = (at: number) => new Date(at).toISOString().slice(0, 10);

/**
 * Discards the changes of one file: a copy of it as it is goes to `trashDir/<date>/<id>/`, then
 * the file goes back to what the last commit has (or away, when the commit does not have it).
 */
export async function discard(
  root: string,
  file: string,
  trashDir: string,
  origPath?: string,
): Promise<DiscardRecord> {
  const relative = repoPath(root, file);
  const absolute = path.join(root, relative);
  const record: DiscardRecord = {
    id: randomUUID(),
    root,
    file: relative,
    at: Date.now(),
    missing: false,
    after: null,
  };
  const folder = path.join(trashDir, day(record.at), record.id);
  await fs.promises.mkdir(folder, { recursive: true });
  try {
    const stat = await fs.promises.lstat(absolute);
    if (!stat.isFile()) throw new UserError('error.save.notFile');
    await fs.promises.copyFile(absolute, path.join(folder, 'content'));
  } catch (err) {
    if (err instanceof UserError) throw err;
    record.missing = true;
  }
  await fs.promises.writeFile(path.join(folder, 'record.json'), JSON.stringify(record));

  // Index and working tree back to the last commit, path by path; a path it does not have goes
  // away. `reset` and `checkout`, not `restore`, which needs git 2.23 (the app takes 2.15).
  const head = await hasHead(root);
  const paths = [relative, ...(origPath ? [repoPath(root, origPath)] : [])];
  for (const p of paths) {
    const inHead = head && (await runGit(root, ['cat-file', '-e', `HEAD:${p}`])).code === 0;
    if (inHead) {
      await write(root, ['reset', '-q', 'HEAD', '--', p]);
      await write(root, ['checkout', '-q', '--', p]);
    } else {
      await write(root, ['rm', '--cached', '-q', '--ignore-unmatch', '--', p]);
      await fs.promises.rm(path.join(root, p), { force: true });
    }
  }
  record.after = await hashOf(absolute);
  await fs.promises.writeFile(path.join(folder, 'record.json'), JSON.stringify(record));
  return record;
}

async function findRecord(
  trashDir: string,
  id: string,
): Promise<{ folder: string; record: DiscardRecord }> {
  if (!/^[0-9a-f-]{36}$/.test(id)) throw new UserError('error.git.discardGone');
  for (const date of await fs.promises.readdir(trashDir).catch(() => [])) {
    const folder = path.join(trashDir, date, id);
    try {
      const record = JSON.parse(
        await fs.promises.readFile(path.join(folder, 'record.json'), 'utf8'),
      ) as DiscardRecord;
      return { folder, record };
    } catch {
      // Not in this day.
    }
  }
  throw new UserError('error.git.discardGone');
}

/**
 * Gives a discarded file back, as it was. Refused when the file changed since the discard: what
 * was written meanwhile (by the agent) would be lost.
 */
export async function undoDiscard(trashDir: string, id: string): Promise<DiscardRecord> {
  const { folder, record } = await findRecord(trashDir, id);
  const absolute = path.join(record.root, repoPath(record.root, record.file));
  if ((await hashOf(absolute)) !== record.after) throw new UserError('error.git.undoChanged');
  if (record.missing) await fs.promises.rm(absolute, { force: true });
  else {
    await fs.promises.mkdir(path.dirname(absolute), { recursive: true });
    await fs.promises.copyFile(path.join(folder, 'content'), absolute);
  }
  await fs.promises.rm(folder, { recursive: true, force: true });
  return record;
}

/** Removes the copies of discarded files older than `days`. */
export async function cleanDiscarded(
  trashDir: string,
  days = DISCARD_KEEP_DAYS,
  now = Date.now(),
): Promise<void> {
  const oldest = day(now - days * 24 * 60 * 60 * 1000);
  for (const date of await fs.promises.readdir(trashDir).catch(() => [])) {
    if (/^\d{4}-\d{2}-\d{2}$/.test(date) && date < oldest) {
      await fs.promises.rm(path.join(trashDir, date), { recursive: true, force: true });
    }
  }
}
