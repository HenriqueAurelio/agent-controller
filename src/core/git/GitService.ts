import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { ChangeKind, FileChange, FileDiff, SideContent } from '@shared/git';
import { UserError } from '@shared/i18n';

/** `git status --porcelain=v2` and `--no-optional-locks` both exist since 2.15. */
export const MIN_GIT_VERSION = '2.15.0';
export const MAX_TEXT_BYTES = 2 * 1024 * 1024;

export interface GitResult {
  code: number;
  stdout: Buffer;
  stderr: string;
  /** The output went past `maxBytes` and git was stopped: `stdout` is not the whole of it. */
  truncated?: boolean;
}

export class GitMissingError extends Error {
  constructor() {
    super('git não encontrado');
  }
}

/**
 * Runs the git binary in a child process. Every git call is read-only for the user's repository:
 * `--no-optional-locks` keeps even `status` from refreshing the index.
 */
export function runGit(
  cwd: string,
  args: string[],
  options: { env?: Record<string, string>; input?: Buffer | string; maxBytes?: number } = {},
): Promise<GitResult> {
  return new Promise((resolve, reject) => {
    const child = spawn(
      'git',
      ['--no-optional-locks', '-c', 'core.quotepath=off', '-c', 'core.fsmonitor=false', ...args],
      {
        cwd,
        windowsHide: true,
        env: { ...process.env, GIT_TERMINAL_PROMPT: '0', LC_ALL: 'C', ...options.env },
      },
    );
    const out: Buffer[] = [];
    let size = 0;
    let truncated = false;
    let stderr = '';
    const limit = options.maxBytes ?? 64 * 1024 * 1024;
    child.stdout.on('data', (chunk: Buffer) => {
      size += chunk.length;
      if (size > limit) {
        truncated = true;
        child.kill();
        return;
      }
      out.push(chunk);
    });
    child.stderr.on('data', (chunk: Buffer) => {
      if (stderr.length < 8192) stderr += chunk.toString('utf8');
    });
    child.on('error', (err: NodeJS.ErrnoException) =>
      // ENOENT is also what a missing working directory produces.
      reject(err.code === 'ENOENT' && fs.existsSync(cwd) ? new GitMissingError() : err),
    );
    child.on('close', (code) =>
      resolve({
        code: code ?? 1,
        stdout: Buffer.concat(out),
        stderr,
        ...(truncated && { truncated }),
      }),
    );
    child.stdin.on('error', () => {});
    child.stdin.end(options.input ?? undefined);
  });
}

async function gitText(cwd: string, args: string[], env?: Record<string, string>): Promise<string> {
  const result = await runGit(cwd, args, { env });
  if (result.code !== 0) throw new Error(`git ${args[0]}: ${result.stderr.trim()}`);
  return result.stdout.toString('utf8');
}

/** Installed git version, or null when git is not on the PATH. */
export async function gitVersion(): Promise<string | null> {
  try {
    const result = await runGit(os.tmpdir(), ['--version']);
    return /(\d+\.\d+\.\d+)/.exec(result.stdout.toString('utf8'))?.[1] ?? null;
  } catch (err) {
    if (err instanceof GitMissingError) return null;
    throw err;
  }
}

/** Root of the repository that contains `dir`, or null when it is not inside one. */
export async function repositoryRoot(dir: string): Promise<string | null> {
  try {
    const result = await runGit(dir, ['rev-parse', '--show-toplevel']);
    if (result.code !== 0) return null;
    const root = result.stdout.toString('utf8').trim();
    return root ? path.resolve(root) : null;
  } catch (err) {
    if (err instanceof GitMissingError) throw err;
    return null; // The folder does not exist.
  }
}

/** What of a change is in the index, from the XY of `git status --porcelain=v2`. */
function stagedFromXY(xy: string): Pick<FileChange, 'staged'> {
  if (xy[0] === '.' || xy[0] === undefined) return {};
  return { staged: xy[1] === '.' ? 'all' : 'partial' };
}

function kindFromXY(xy: string): ChangeKind {
  const [x, y] = [xy[0], xy[1]];
  if (x === 'D' || y === 'D') return 'removed';
  if (x === 'A' || y === 'A') return 'added';
  return 'modified';
}

/** Parses `git status --porcelain=v2 -z`. */
export function parseStatus(output: string): FileChange[] {
  const changes: FileChange[] = [];
  const records = output.split('\0');
  for (let i = 0; i < records.length; i++) {
    const record = records[i]!;
    if (!record) continue;
    const type = record[0];
    if (type === '?') {
      changes.push({ path: record.slice(2), kind: 'untracked' });
    } else if (type === '1') {
      // 1 XY sub mH mI mW hH hI path
      const parts = record.split(' ');
      const file = parts.slice(8).join(' ');
      // A submodule with work in progress is told apart like a repository inside another is
      // when untracked: by a path that ends with a slash.
      const sub = parts[2]!;
      const dirty = sub[0] === 'S' && (sub[2] === 'M' || sub[3] === 'U');
      changes.push({
        path: dirty ? `${file}/` : file,
        kind: kindFromXY(parts[1]!),
        ...stagedFromXY(parts[1]!),
      });
    } else if (type === '2') {
      // 2 XY sub mH mI mW hH hI Xscore path, then the original path as the next record.
      const parts = record.split(' ');
      const origPath = records[++i] ?? '';
      const copied = parts[8]?.startsWith('C');
      changes.push(
        copied
          ? { path: parts.slice(9).join(' '), kind: 'added', ...stagedFromXY(parts[1]!) }
          : {
              path: parts.slice(9).join(' '),
              origPath,
              kind: 'renamed',
              ...stagedFromXY(parts[1]!),
            },
      );
    } else if (type === 'u') {
      // u XY sub m1 m2 m3 mW h1 h2 h3 path
      changes.push({ path: record.split(' ').slice(10).join(' '), kind: 'conflict' });
    }
  }
  return changes.sort((a, b) => a.path.localeCompare(b.path));
}

/** Changes of the working tree against HEAD, including untracked files. */
export async function statusChanges(root: string): Promise<FileChange[]> {
  const out = await gitText(root, ['status', '--porcelain=v2', '-z', '--untracked-files=all']);
  return parseStatus(out);
}

/** Parses `git diff-tree -r -z --name-status`. */
export function parseNameStatus(output: string): FileChange[] {
  const changes: FileChange[] = [];
  const records = output.split('\0');
  for (let i = 0; i < records.length;) {
    const status = records[i++];
    if (!status) continue;
    const letter = status[0];
    if (letter === 'R' || letter === 'C') {
      const origPath = records[i++] ?? '';
      const target = records[i++] ?? '';
      changes.push(
        letter === 'R'
          ? { path: target, origPath, kind: 'renamed' }
          : { path: target, kind: 'added' },
      );
    } else {
      const file = records[i++] ?? '';
      const kind: ChangeKind = letter === 'A' ? 'added' : letter === 'D' ? 'removed' : 'modified';
      changes.push({ path: file, kind });
    }
  }
  return changes.sort((a, b) => a.path.localeCompare(b.path));
}

export function isBinary(buffer: Buffer): boolean {
  // Same heuristic as git: a NUL byte in the first 8000 bytes.
  return buffer.subarray(0, 8000).includes(0);
}

export function toSideContent(buffer: Buffer): SideContent {
  if (isBinary(buffer)) return { kind: 'binary', size: buffer.length };
  if (buffer.length > MAX_TEXT_BYTES) return { kind: 'too-large', size: buffer.length };
  return { kind: 'text', text: buffer.toString('utf8') };
}

/** Content of `<treeish>:<file>`, e.g. `HEAD:src/a.ts`. */
export async function blobContent(
  root: string,
  treeish: string,
  file: string,
): Promise<SideContent> {
  const spec = `${treeish}:${file}`;
  const size = await runGit(root, ['cat-file', '-s', spec]);
  if (size.code !== 0) return { kind: 'missing' };
  const bytes = Number(size.stdout.toString('utf8').trim());
  // Read a little even from a huge blob, to tell binary from merely large.
  if (bytes > MAX_TEXT_BYTES) {
    const head = await runGit(root, ['cat-file', 'blob', spec], { maxBytes: 8000 });
    return isBinary(head.stdout)
      ? { kind: 'binary', size: bytes }
      : { kind: 'too-large', size: bytes };
  }
  const blob = await runGit(root, ['cat-file', 'blob', spec]);
  if (blob.code !== 0) return { kind: 'missing' };
  return toSideContent(blob.stdout);
}

export type SaveResult =
  | { saved: true }
  /** The file is no longer what the editor loaded: someone (the agent) wrote to it meanwhile. */
  | { saved: false; reason: 'conflict' };

/**
 * Writes an edit made in the changes panel to the working tree. This is the only thing the
 * panel changes, and it goes through the file system: git's index, HEAD and refs are untouched.
 *
 * `expected` is the text the editor started from. When the file on disk is different by now,
 * nothing is written, unless `expected` is null (the user chose to overwrite).
 */
export async function saveWorkingTreeFile(
  root: string,
  file: string,
  content: string,
  expected: string | null,
): Promise<SaveResult> {
  const absolute = path.resolve(root, file);
  const relative = path.relative(root, absolute);
  if (!relative || relative.startsWith('..') || path.isAbsolute(relative)) {
    throw new UserError('error.save.outside');
  }
  // The repository may be the root, or a folder anywhere below it.
  if (relative.split(path.sep).some((part) => part.toLowerCase() === '.git')) {
    throw new UserError('error.save.gitInternal');
  }
  let stat: fs.Stats | null = null;
  try {
    stat = await fs.promises.lstat(absolute);
  } catch {
    // The file was removed in the meantime; saving brings it back, if that is what was asked.
  }
  if (stat && !stat.isFile()) throw new UserError('error.save.notFile');
  if (Buffer.byteLength(content, 'utf8') > MAX_TEXT_BYTES) {
    throw new UserError('error.save.tooLarge');
  }
  if (expected !== null) {
    const current = stat ? await fs.promises.readFile(absolute, 'utf8') : null;
    if (current !== expected) return { saved: false, reason: 'conflict' };
  }
  await fs.promises.mkdir(path.dirname(absolute), { recursive: true });
  await fs.promises.writeFile(absolute, content, 'utf8');
  return { saved: true };
}

export async function workingTreeContent(root: string, file: string): Promise<SideContent> {
  const absolute = path.resolve(root, file);
  // A path from git never leaves the repository; refuse anything else.
  const relative = path.relative(root, absolute);
  if (relative.startsWith('..') || path.isAbsolute(relative)) return { kind: 'missing' };
  let stat: fs.Stats;
  try {
    stat = await fs.promises.lstat(absolute);
  } catch {
    return { kind: 'missing' };
  }
  if (stat.isSymbolicLink()) {
    return { kind: 'text', text: await fs.promises.readlink(absolute) };
  }
  if (!stat.isFile()) return { kind: 'missing' };
  if (stat.size > MAX_TEXT_BYTES) {
    const handle = await fs.promises.open(absolute, 'r');
    try {
      const head = Buffer.alloc(8000);
      const { bytesRead } = await handle.read(head, 0, head.length, 0);
      return isBinary(head.subarray(0, bytesRead))
        ? { kind: 'binary', size: stat.size }
        : { kind: 'too-large', size: stat.size };
    } finally {
      await handle.close();
    }
  }
  return toSideContent(await fs.promises.readFile(absolute));
}

/** Both sides of a change, comparing `baseTreeish` (HEAD or a snapshot tree) to the working tree. */
export async function fileDiff(
  root: string,
  change: FileChange,
  baseTreeish: string | null,
): Promise<FileDiff> {
  const original: SideContent =
    baseTreeish === null || change.kind === 'added' || change.kind === 'untracked'
      ? { kind: 'missing' }
      : await blobContent(root, baseTreeish, change.origPath ?? change.path);
  const modified: SideContent =
    change.kind === 'removed' ? { kind: 'missing' } : await workingTreeContent(root, change.path);
  return { path: change.path, original, modified };
}

/** Name of the branch that is checked out; null with a detached HEAD. */
export async function currentBranch(root: string): Promise<string | null> {
  const result = await runGit(root, ['symbolic-ref', '--short', '-q', 'HEAD']);
  return result.code === 0 ? result.stdout.toString('utf8').trim() || null : null;
}

/** Where HEAD and `base` last met: the commit a branch left `base` from. Null when they never met. */
export async function mergeBase(root: string, base: string): Promise<string | null> {
  if (base.startsWith('-')) return null;
  const result = await runGit(root, ['merge-base', base, 'HEAD']);
  return result.code === 0 ? result.stdout.toString('utf8').trim() || null : null;
}

export async function hasHead(root: string): Promise<boolean> {
  const result = await runGit(root, ['rev-parse', '--verify', '--quiet', 'HEAD']);
  return result.code === 0;
}

/**
 * Records the current state of the working tree as a tree object, tracked and untracked files
 * alike, through a private index file. The user's index, working tree, stash and refs are not
 * touched; only loose objects are added to the object database.
 */
export async function snapshotTree(root: string, indexFile: string): Promise<string> {
  const env = { GIT_INDEX_FILE: indexFile };
  if (!fs.existsSync(indexFile)) {
    await fs.promises.mkdir(path.dirname(indexFile), { recursive: true });
    if (await hasHead(root)) await gitText(root, ['read-tree', 'HEAD'], env);
  }
  await gitText(root, ['add', '--all', '--', '.'], env);
  return (await gitText(root, ['write-tree'], env)).trim();
}

/** What changed between two trees, with rename detection. */
export async function treeChanges(root: string, from: string, to: string): Promise<FileChange[]> {
  const out = await gitText(root, ['diff-tree', '-r', '-z', '-M', '--name-status', from, to]);
  return parseNameStatus(out);
}

/** Paths, among `files`, that .gitignore covers. */
export async function ignoredPaths(root: string, files: string[]): Promise<Set<string>> {
  if (files.length === 0) return new Set();
  const result = await runGit(root, ['check-ignore', '-z', '--stdin'], {
    input: files.join('\0') + '\0',
  });
  // Exit code 1 means "none ignored".
  if (result.code > 1) return new Set();
  return new Set(result.stdout.toString('utf8').split('\0').filter(Boolean));
}
