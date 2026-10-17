import { EventEmitter } from 'node:events';
import fs from 'node:fs';
import path from 'node:path';
import {
  DEFAULT_CHECKPOINT_SETTINGS,
  type CheckpointInfo,
  type CheckpointKind,
  type CheckpointList,
  type CheckpointSettings,
  type RestoreResult,
} from '@shared/checkpoints';
import { UserError } from '@shared/i18n';
import { ignoredPaths, MAX_TEXT_BYTES, runGit } from './GitService';

// Checkpoints per turn (ADR 0021): a photo of the folder of a session, kept in its repository
// under `refs/agent-controller/checkpoints/<session>/<n>`. The photo goes through an index file
// of the app's own, so the user's index, branch, HEAD and log stay as they were: what the app
// adds to the repository is objects and those refs, and nothing else.

export const CHECKPOINT_NAMESPACE = 'refs/agent-controller/checkpoints';
/** A file bigger than this stays out of the photo, as the panel does not show it either. */
export const CHECKPOINT_MAX_FILE_BYTES = MAX_TEXT_BYTES;
/** How long a photo at the end of a turn waits for the git of the agent to let the index go. */
const LOCK_WAIT_MS = 2000;

const IDENTITY = {
  GIT_AUTHOR_NAME: 'Agent Controller',
  GIT_AUTHOR_EMAIL: 'agent-controller@localhost',
  GIT_COMMITTER_NAME: 'Agent Controller',
  GIT_COMMITTER_EMAIL: 'agent-controller@localhost',
};
const SUBJECT = 'agent-controller checkpoint';
/** Session ids are UUIDs; anything else never becomes part of a ref name. */
const SESSION_ID = /^[A-Za-z0-9-]{1,64}$/;

/** A checkpoint as the repository has it. */
export interface Checkpoint extends CheckpointInfo {
  session: string;
  n: number;
  ref: string;
  commit: string;
  tree: string;
}

interface Meta {
  kind: CheckpointKind;
  turn: number;
  at: number;
  files: number;
  skipped: string[];
  restoredTo?: number;
  checks?: 'passed' | 'failed';
}

async function git(
  root: string,
  args: string[],
  options: { env?: Record<string, string>; input?: string } = {},
): Promise<string> {
  const result = await runGit(root, args, options);
  if (result.code === 0) return result.stdout.toString('utf8');
  if (/index\.lock/.test(result.stderr)) throw new UserError('error.git.locked');
  throw new UserError('error.git.failed', { error: result.stderr.trim() });
}

const refOf = (session: string, n: number) => `${CHECKPOINT_NAMESPACE}/${session}/${n}`;

/** Where the repository keeps its index (a worktree has its own). */
async function realIndex(root: string): Promise<string> {
  return path.resolve(root, (await git(root, ['rev-parse', '--git-path', 'index'])).trim());
}

/** The git of someone else (the agent) is writing the index right now. */
export async function repositoryBusy(root: string): Promise<boolean> {
  return fs.existsSync(`${await realIndex(root)}.lock`);
}

function metaOf(body: string): Meta | null {
  try {
    const meta = JSON.parse(body.trim()) as Partial<Meta>;
    if (meta.kind !== 'start' && meta.kind !== 'turn' && meta.kind !== 'restore') return null;
    return {
      kind: meta.kind,
      turn: typeof meta.turn === 'number' ? meta.turn : 0,
      at: typeof meta.at === 'number' ? meta.at : 0,
      files: typeof meta.files === 'number' ? meta.files : 0,
      skipped: Array.isArray(meta.skipped) ? meta.skipped.filter((s) => typeof s === 'string') : [],
      ...(typeof meta.restoredTo === 'number' && { restoredTo: meta.restoredTo }),
      ...((meta.checks === 'passed' || meta.checks === 'failed') && { checks: meta.checks }),
    };
  } catch {
    return null;
  }
}

/** The checkpoints in a repository: of one session, or of all of them. Oldest first. */
export async function listCheckpoints(root: string, session?: string): Promise<Checkpoint[]> {
  if (session !== undefined && !SESSION_ID.test(session)) return [];
  const prefix =
    session === undefined ? CHECKPOINT_NAMESPACE : `${CHECKPOINT_NAMESPACE}/${session}`;
  const out = await git(root, [
    'for-each-ref',
    '--format=%(refname)%00%(objectname)%00%(tree)%00%(contents:body)%01',
    `${prefix}/`,
  ]);
  const found: Checkpoint[] = [];
  for (const record of out.split('\x01')) {
    const [ref, commit, tree, body] = record.replace(/^\n/, '').split('\0');
    if (!ref || !commit || !tree) continue;
    const match = /^refs\/agent-controller\/checkpoints\/([^/]+)\/(\d+)$/.exec(ref);
    const meta = metaOf(body ?? '');
    if (!match || !meta) continue;
    const n = Number(match[2]);
    found.push({ ...meta, id: String(n), session: match[1]!, n, ref, commit, tree });
  }
  return found.sort((a, b) => a.session.localeCompare(b.session) || a.n - b.n);
}

/** Paths git sees as changed or new, from `git status --porcelain=v1 -z`. */
async function changedPaths(root: string): Promise<string[]> {
  const out = await git(root, ['status', '--porcelain=v1', '-z', '--untracked-files=all']);
  const records = out.split('\0');
  const paths: string[] = [];
  for (let i = 0; i < records.length; i++) {
    const record = records[i]!;
    if (record.length < 4) continue;
    paths.push(record.slice(3));
    // A rename carries its old path as the next record.
    if (record[0] === 'R' || record[0] === 'C') i++;
  }
  return paths;
}

/** Changed files bigger than the limit: they stay out of the photo. */
async function bigFiles(root: string, limit: number): Promise<string[]> {
  const big: string[] = [];
  for (const file of await changedPaths(root)) {
    const stat = await fs.promises.lstat(path.join(root, file)).catch(() => null);
    if (stat?.isFile() && stat.size > limit) big.push(file);
  }
  return big.sort();
}

async function countDifferences(root: string, from: string | null, to: string): Promise<number> {
  if (from === null) {
    const head = await runGit(root, ['rev-parse', '--verify', '-q', 'HEAD^{tree}']);
    if (head.code !== 0) {
      return (await git(root, ['ls-tree', '-r', '-z', '--name-only', to]))
        .split('\0')
        .filter(Boolean).length;
    }
    from = head.stdout.toString('utf8').trim();
  }
  const out = await git(root, ['diff-tree', '-r', '-z', '--no-renames', '--name-only', from, to]);
  return out.split('\0').filter(Boolean).length;
}

async function commitTree(root: string, tree: string, meta: Meta): Promise<string> {
  const message = `${SUBJECT}\n\n${JSON.stringify(meta)}\n`;
  // No parent: a checkpoint that goes takes its objects with it at the next `git gc`.
  const out = await git(root, ['-c', 'commit.gpgsign=false', 'commit-tree', tree], {
    env: IDENTITY,
    input: message,
  });
  return out.trim();
}

/** The tree of the folder as it is, through the index file of the app. */
export async function photo(
  root: string,
  indexFile: string,
  maxFileBytes: number,
): Promise<{ tree: string; skipped: string[] }> {
  await fs.promises.mkdir(path.dirname(indexFile), { recursive: true });
  // From a copy of the user's index: git trusts what it already knows of each file and only reads
  // what changed, which keeps a photo of a big repository quick. The copy is all that is touched.
  const source = await realIndex(root);
  await fs.promises.rm(indexFile, { force: true });
  if (fs.existsSync(source)) {
    await fs.promises.copyFile(source, indexFile);
    // With the time of the original: git tells a file written in the same second as the index
    // ("racy") by comparing with it, and a newer copy would hide such a change.
    const { atime, mtime } = await fs.promises.stat(source);
    await fs.promises.utimes(indexFile, atime, mtime);
  }
  const env = { GIT_INDEX_FILE: indexFile };
  const skipped = await bigFiles(root, maxFileBytes);
  // `add --all` follows the .gitignore: what it ignores never goes into a checkpoint.
  await git(root, ['add', '--all', '--', '.', ...skipped.map((f) => `:(exclude,literal)${f}`)], {
    env,
  });
  return { tree: (await git(root, ['write-tree'], { env })).trim(), skipped };
}

export interface SnapshotOptions {
  /** The index file of the app for this session: never the repository's. */
  indexFile: string;
  kind: CheckpointKind;
  restoredTo?: number;
  maxFileBytes?: number;
  now?: number;
  /** A photo taken before, to keep as the checkpoint instead of one of the folder now. */
  taken?: { tree: string; skipped: string[] };
}

/**
 * Takes a checkpoint of the folder. Nothing is written when it is the same as the latest one; a
 * `restore` checkpoint is not written either when any checkpoint has the same files, and that one
 * is returned instead.
 */
export async function snapshot(
  root: string,
  session: string,
  options: SnapshotOptions,
): Promise<{ checkpoint: Checkpoint; created: boolean } | null> {
  if (!SESSION_ID.test(session)) return null;
  const { tree, skipped } =
    options.taken ??
    (await photo(root, options.indexFile, options.maxFileBytes ?? CHECKPOINT_MAX_FILE_BYTES));
  const existing = await listCheckpoints(root, session);
  const latest = existing.at(-1) ?? null;
  const same =
    options.kind === 'restore'
      ? existing.findLast((c) => c.tree === tree)
      : latest?.tree === tree
        ? latest
        : undefined;
  if (same) return { checkpoint: same, created: false };

  const meta: Meta = {
    kind: options.kind,
    turn: options.kind === 'turn' ? (latest?.turn ?? 0) + 1 : (latest?.turn ?? 0),
    at: options.now ?? Date.now(),
    files: await countDifferences(root, latest?.tree ?? null, tree),
    skipped,
    ...(options.restoredTo !== undefined && { restoredTo: options.restoredTo }),
  };
  const commit = await commitTree(root, tree, meta);
  const n = (latest?.n ?? 0) + (latest ? 1 : 0);
  const ref = refOf(session, n);
  // The empty old value makes git refuse a ref that is already there.
  await git(root, ['update-ref', '-m', SUBJECT, ref, commit, '']);
  return {
    checkpoint: { ...meta, id: String(n), session, n, ref, commit, tree },
    created: true,
  };
}

/** Writes down how the checks of the turn of a checkpoint ended, in the checkpoint itself. */
export async function recordChecks(
  root: string,
  checkpoint: Checkpoint,
  checks: 'passed' | 'failed',
): Promise<void> {
  const { kind, turn, at, files, skipped, restoredTo } = checkpoint;
  const commit = await commitTree(root, checkpoint.tree, {
    kind,
    turn,
    at,
    files,
    skipped,
    ...(restoredTo !== undefined && { restoredTo }),
    checks,
  });
  await git(root, ['update-ref', '-m', SUBJECT, checkpoint.ref, commit, checkpoint.commit]);
}

/** Removes the folders left empty by removing a file, up to the root. */
async function removeEmptyParents(root: string, file: string): Promise<void> {
  let dir = path.dirname(path.join(root, file));
  while (path.relative(root, dir) && !path.relative(root, dir).startsWith('..')) {
    try {
      await fs.promises.rmdir(dir);
    } catch {
      return;
    }
    dir = path.dirname(dir);
  }
}

/**
 * Puts the files of the folder back as they were at `target`. What changed is written from the
 * checkpoint; what did not exist then is removed, unless .gitignore covers it. Files too big for
 * either photo are left alone. The user's index is not touched.
 */
export async function restoreTree(
  root: string,
  from: Checkpoint,
  target: Checkpoint,
  indexFile: string,
): Promise<number> {
  if (from.tree === target.tree) return 0;
  const out = await git(root, ['diff-tree', '-r', '-z', '--no-renames', from.tree, target.tree]);
  const keep = new Set([...from.skipped, ...target.skipped]);
  const write: string[] = [];
  const remove: string[] = [];
  const records = out.split('\0');
  for (let i = 0; i + 1 < records.length; i += 2) {
    // :<old mode> <new mode> <old sha> <new sha> <status>, then the path.
    const [oldMode, newMode] = records[i]!.slice(1).split(' ');
    const status = records[i]!.at(-1);
    const file = records[i + 1]!;
    if (!file || keep.has(file)) continue;
    // A repository inside this one is its own business.
    if (oldMode === '160000' || newMode === '160000') continue;
    if (status === 'D') remove.push(file);
    else write.push(file);
  }
  const ignored = await ignoredPaths(root, remove);
  const removed = remove.filter((file) => !ignored.has(file));
  for (const file of removed) {
    await fs.promises.rm(path.join(root, file), { force: true });
    await removeEmptyParents(root, file);
  }
  if (write.length > 0) {
    await fs.promises.mkdir(path.dirname(indexFile), { recursive: true });
    await fs.promises.rm(indexFile, { force: true });
    const env = { GIT_INDEX_FILE: indexFile };
    await git(root, ['read-tree', target.tree], { env });
    await git(root, ['checkout-index', '-f', '-z', '--stdin'], {
      env,
      input: write.join('\0') + '\0',
    });
    await fs.promises.rm(indexFile, { force: true });
  }
  return removed.length + write.length;
}

/** Removes refs of checkpoints. */
export async function deleteCheckpoints(root: string, checkpoints: Checkpoint[]): Promise<void> {
  if (checkpoints.length === 0) return;
  await git(root, ['update-ref', '--stdin'], {
    input: checkpoints.map((c) => `delete ${c.ref} ${c.commit}\n`).join(''),
  });
}

/**
 * The checkpoints that go: of `session`, beyond the newest `keep` and older than `days` (the
 * newest one always stays, since it is what the next turn is compared with); of sessions that no
 * longer exist, the ones older than `days`.
 */
export function toPrune(
  all: Checkpoint[],
  session: string,
  known: ReadonlySet<string>,
  settings: Pick<CheckpointSettings, 'keep' | 'days'>,
  now: number,
): Checkpoint[] {
  const oldest = now - settings.days * 24 * 60 * 60 * 1000;
  const own = all.filter((c) => c.session === session).sort((a, b) => b.n - a.n);
  return [
    ...own.filter((c, index) => index > 0 && (index >= settings.keep || c.at < oldest)),
    ...all.filter((c) => c.session !== session && !known.has(c.session) && c.at < oldest),
  ];
}

/** Bytes on disk of the objects only the checkpoints keep. */
export async function checkpointBytes(root: string, checkpoints: Checkpoint[]): Promise<number> {
  if (checkpoints.length === 0) return 0;
  const objects = await git(root, [
    'rev-list',
    '--objects',
    ...checkpoints.map((c) => c.commit),
    '--not',
    `--exclude=${CHECKPOINT_NAMESPACE}/*`,
    '--all',
  ]);
  const ids = objects
    .split('\n')
    .map((line) => line.split(' ')[0])
    .filter(Boolean);
  if (ids.length === 0) return 0;
  const sizes = await git(root, ['cat-file', '--batch-check=%(objectsize:disk)'], {
    input: ids.join('\n') + '\n',
  });
  return sizes
    .split('\n')
    .map(Number)
    .filter((n) => Number.isFinite(n))
    .reduce((sum, n) => sum + n, 0);
}

export interface CheckpointServiceOptions {
  /** Where the index files of the app live: its own data directory, never the repository. */
  directory: string;
  /** The root of the repository a session works in; null when it is not in one. */
  rootOf(sessionId: string): Promise<string | null>;
  settings?(): CheckpointSettings;
  /** Sessions that exist: checkpoints of others are pruned by age only. */
  knownSessions?(): ReadonlySet<string>;
  maxFileBytes?: number;
  now?: () => number;
  /** A photo at the end of a turn that could not be taken: logged, never in the user's way. */
  onError?(sessionId: string, error: unknown): void;
}

interface CheckpointEvents {
  changed: [sessionId: string];
}

/** The checkpoints of each session: taking them at the end of turns, listing, going back. */
export class CheckpointService extends EventEmitter<CheckpointEvents> {
  /** The latest operation of each session: they run one after the other. */
  private readonly chains = new Map<string, Promise<unknown>>();
  /**
   * The folder as each session found it, kept as a tree only: it becomes a checkpoint with the
   * first turn that changes files, so a session that changes nothing leaves no ref behind.
   */
  private readonly starts = new Map<string, { tree: string; skipped: string[]; at: number }>();
  private readonly now: () => number;

  constructor(private readonly options: CheckpointServiceOptions) {
    super();
    this.now = options.now ?? Date.now;
  }

  private settings(): CheckpointSettings {
    return this.options.settings?.() ?? DEFAULT_CHECKPOINT_SETTINGS;
  }

  private indexFile(sessionId: string, name: 'photo' | 'restore'): string {
    return path.join(this.options.directory, `${sessionId}.${name}.index`);
  }

  private serial<T>(sessionId: string, work: () => Promise<T>): Promise<T> {
    const previous = this.chains.get(sessionId) ?? Promise.resolve();
    const next = previous.catch(() => {}).then(work);
    this.chains.set(sessionId, next);
    void next
      .catch(() => {})
      .finally(() => {
        if (this.chains.get(sessionId) === next) this.chains.delete(sessionId);
      });
    return next;
  }

  /** Resolves once whatever is under way for the session is over: checks wait for the photo. */
  async idle(sessionId: string): Promise<void> {
    await this.chains.get(sessionId)?.catch(() => {});
  }

  private async root(sessionId: string): Promise<string | null> {
    if (!SESSION_ID.test(sessionId)) return null;
    return this.options.rootOf(sessionId).catch(() => null);
  }

  private async take(
    sessionId: string,
    kind: CheckpointKind,
    restoredTo?: number,
  ): Promise<Checkpoint | null> {
    const root = await this.root(sessionId);
    if (!root) return null;
    const indexFile = this.indexFile(sessionId, 'photo');
    const start = kind === 'turn' ? this.starts.get(sessionId) : undefined;
    let now: { tree: string; skipped: string[] } | undefined;
    if (start) {
      now = await photo(root, indexFile, this.options.maxFileBytes ?? CHECKPOINT_MAX_FILE_BYTES);
      // A turn that changed nothing since the start: still nothing to keep.
      if (now.tree === start.tree) return null;
      this.starts.delete(sessionId);
      await snapshot(root, sessionId, { indexFile, kind: 'start', taken: start, now: start.at });
    }
    const taken = await snapshot(root, sessionId, {
      indexFile,
      taken: now,
      kind,
      restoredTo,
      maxFileBytes: this.options.maxFileBytes,
      now: this.now(),
    });
    if (!taken) return null;
    if (taken.created) {
      await this.pruneIn(root, sessionId);
      this.emit('changed', sessionId);
    }
    return taken.checkpoint;
  }

  private automatic(sessionId: string, kind: 'turn'): Promise<void> {
    if (!this.settings().enabled) return Promise.resolve();
    return this.serial(sessionId, async () => {
      try {
        const root = await this.root(sessionId);
        if (!root) return;
        // The agent's own git may be halfway through something: a moment to let it finish.
        const until = Date.now() + LOCK_WAIT_MS;
        while ((await repositoryBusy(root)) && Date.now() < until) {
          await new Promise((resolve) => setTimeout(resolve, 100));
        }
        await this.take(sessionId, kind);
      } catch (err) {
        this.options.onError?.(sessionId, err);
      }
    });
  }

  /**
   * The session started: the folder as it found it, kept until a turn changes something. Nothing
   * is written to the repository yet.
   */
  sessionStarted(sessionId: string): Promise<void> {
    if (!this.settings().enabled) return Promise.resolve();
    return this.serial(sessionId, async () => {
      try {
        const root = await this.root(sessionId);
        if (!root) return;
        const at = this.now();
        const taken = await photo(
          root,
          this.indexFile(sessionId, 'photo'),
          this.options.maxFileBytes ?? CHECKPOINT_MAX_FILE_BYTES,
        );
        this.starts.set(sessionId, { ...taken, at });
      } catch (err) {
        this.options.onError?.(sessionId, err);
      }
    });
  }

  /** The agent ended a turn: a checkpoint, when the turn changed files. */
  turnEnded(sessionId: string): Promise<void> {
    return this.automatic(sessionId, 'turn');
  }

  private async all(sessionId: string): Promise<{ root: string | null; items: Checkpoint[] }> {
    const root = await this.root(sessionId);
    return { root, items: root ? await listCheckpoints(root, sessionId) : [] };
  }

  async list(sessionId: string): Promise<CheckpointList> {
    const { root, items } = await this.all(sessionId);
    return {
      available: root !== null && (this.settings().enabled || items.length > 0),
      items: items.map(({ session: _s, n: _n, ref: _r, commit: _c, tree: _t, ...info }) => info),
    };
  }

  /** One checkpoint of the session; an id it does not have is refused. */
  async get(sessionId: string, id: string): Promise<{ root: string; checkpoint: Checkpoint }> {
    const { root, items } = await this.all(sessionId);
    const checkpoint = items.find((c) => c.id === id);
    if (!root || !checkpoint) throw new UserError('error.checkpoint.notFound');
    return { root, checkpoint };
  }

  /** The checkpoint "the previous turn" compares with: the one before the latest. */
  async previous(sessionId: string): Promise<{ root: string; checkpoint: Checkpoint } | null> {
    const { root, items } = await this.all(sessionId);
    const checkpoint = items.at(-2) ?? items.at(-1);
    return root && checkpoint ? { root, checkpoint } : null;
  }

  /**
   * Puts the folder back as it was at checkpoint `id`, after a checkpoint of how it is now, which
   * the result names: restoring that one undoes this.
   */
  restore(sessionId: string, id: string): Promise<RestoreResult> {
    return this.serial(sessionId, async () => {
      const { root, checkpoint: target } = await this.get(sessionId, id);
      if (await repositoryBusy(root)) throw new UserError('error.git.locked');
      const before = await this.take(sessionId, 'restore', target.turn);
      if (!before) throw new UserError('error.checkpoint.notFound');
      const changed = await restoreTree(root, before, target, this.indexFile(sessionId, 'restore'));
      this.emit('changed', sessionId);
      return { undoId: before.id, changed };
    });
  }

  /** The checks of the turn that just ended finished: their outcome goes on its checkpoint. */
  recordChecks(sessionId: string, outcome: 'passed' | 'failed'): Promise<void> {
    return this.serial(sessionId, async () => {
      const { root, items } = await this.all(sessionId);
      const latest = items.at(-1);
      if (!root || latest?.kind !== 'turn' || latest.checks) return;
      await recordChecks(root, latest, outcome).catch(() => {});
      this.emit('changed', sessionId);
    });
  }

  private async pruneIn(root: string, sessionId: string): Promise<number> {
    const known = this.options.knownSessions?.() ?? new Set([sessionId]);
    const gone = toPrune(
      await listCheckpoints(root),
      sessionId,
      known,
      this.settings(),
      this.now(),
    );
    await deleteCheckpoints(root, gone);
    return gone.length;
  }

  /** Applies how many and for how long checkpoints are kept, now. */
  prune(sessionId: string): Promise<number> {
    return this.serial(sessionId, async () => {
      const root = await this.root(sessionId);
      if (!root) return 0;
      const removed = await this.pruneIn(root, sessionId);
      if (removed > 0) this.emit('changed', sessionId);
      return removed;
    });
  }

  /** Removes every checkpoint of the session from its repository. */
  removeAll(sessionId: string): Promise<number> {
    return this.serial(sessionId, async () => {
      const { root, items } = await this.all(sessionId);
      if (!root) return 0;
      await deleteCheckpoints(root, items);
      this.emit('changed', sessionId);
      return items.length;
    });
  }

  /** How many checkpoints the session has, and the bytes only they keep. */
  async usage(sessionId: string): Promise<{ count: number; bytes: number }> {
    const { root, items } = await this.all(sessionId);
    if (!root) return { count: 0, bytes: 0 };
    return { count: items.length, bytes: await checkpointBytes(root, items).catch(() => 0) };
  }

  /** The session is gone: the index files of the app for it go too. Its refs stay as decided. */
  async forget(sessionId: string): Promise<void> {
    await this.idle(sessionId);
    this.starts.delete(sessionId);
    for (const name of ['photo', 'restore'] as const) {
      await fs.promises.rm(this.indexFile(sessionId, name), { force: true }).catch(() => {});
    }
  }
}
