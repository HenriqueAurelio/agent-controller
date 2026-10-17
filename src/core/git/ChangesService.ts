import fs from 'node:fs';
import path from 'node:path';
import {
  isCheckpointBase,
  type DiffBase,
  type FileChange,
  type FileDiff,
  type FileIndexResult,
  type FileListing,
  type GitOverview,
  type RepoInfo,
} from '@shared/git';
import { UserError } from '@shared/i18n';
import { compareVersions } from '../agents/detect';
import { listDirectory } from './FileBrowser';
import {
  blobContent,
  currentBranch,
  fileDiff,
  GitMissingError,
  gitVersion,
  hasHead,
  mergeBase,
  MIN_GIT_VERSION,
  repositoryRoot,
  saveWorkingTreeFile,
  type SaveResult,
  snapshotTree,
  statusChanges,
  treeChanges,
} from './GitService';
import {
  commit,
  discard,
  stage,
  undoDiscard,
  unstage,
  type CommitResult,
  type DiscardRecord,
} from './GitWriteService';
import { buildFileIndex, FileIndexCache } from './FileIndex';
import { RepoWatcher } from './RepoWatcher';
import { findRepositories, isRepository, MAX_REPOSITORIES } from './Workspace';

/** One repository of the session. Most sessions have a single one, at the root. */
interface RepoState {
  /** Path from the root of the session to the repository, with forward slashes; '' is the root. */
  prefix: string;
  root: string;
  /** Tree recorded when the session started, for the "since the session started" comparison. */
  baseTree: string | null;
  currentTree: string | null;
}

interface SessionGit {
  cwd: string;
  /**
   * What the paths of the panel are relative to: the repository the session is in or, for a
   * plain folder that holds repositories, that folder. Null when there is no repository at all.
   */
  root: string | null;
  /** Where "all files" is listed from: `root`, or the session folder without any repository. */
  browseRoot: string | null;
  /** The session folder is inside a repository, which does not change while it lives. */
  inRepository: boolean;
  /** Repositories found by looking at the folders, before asking git about nested ones. */
  top: string[];
  /** Every repository the last look found, nested ones included. */
  active: string[];
  discoveredAt: number;
  repos: Map<string, RepoState>;
  /** Private index files used to snapshot the state of each repository. */
  workDir: string;
  watcher: RepoWatcher | null;
  lastChanges: FileChange[];
  /**
   * In a copy of the repository: the commit where its branch left the base, which "compare with
   * the base" compares against. Found again at each look, since the base may move.
   */
  mergeBase: string | null;
}

export interface ChangesServiceOptions {
  /** Where the private index files live: the app's own data directory, never the repository. */
  workDirectory: string;
  onChange: (sessionId: string) => void;
}

/** How long the repositories found in a plain folder are trusted by the counter of the button. */
const DISCOVERY_TTL_MS = 10_000;

const join = (prefix: string, file: string) => (prefix ? `${prefix}/${file}` : file);

/**
 * The trees a checkpoint base stands for, found by the caller in the timeline of the session:
 * `from` against the folder, or against `to` when two checkpoints are compared.
 */
export interface CheckpointTrees {
  from: string;
  to?: string;
}

/** The "see changes" panel, per session: what changed, both sides of a file, and the watcher. */
export class ChangesService {
  private readonly sessions = new Map<string, SessionGit>();
  private versionCheck: Promise<string | null> | null = null;
  private readonly indexes = new FileIndexCache();

  constructor(private readonly options: ChangesServiceOptions) {}

  private entry(sessionId: string, cwd: string): SessionGit {
    let entry = this.sessions.get(sessionId);
    if (!entry || entry.cwd !== cwd) {
      entry?.watcher?.stop();
      entry = {
        cwd,
        root: null,
        browseRoot: null,
        inRepository: false,
        top: [],
        active: [],
        discoveredAt: 0,
        repos: new Map(),
        workDir: path.join(this.options.workDirectory, sessionId),
        watcher: null,
        lastChanges: [],
        mergeBase: null,
      };
      this.sessions.set(sessionId, entry);
    }
    return entry;
  }

  private version(refresh = false): Promise<string | null> {
    if (refresh || !this.versionCheck) this.versionCheck = gitVersion();
    return this.versionCheck;
  }

  private repo(entry: SessionGit, prefix: string, root: string): RepoState {
    let state = entry.repos.get(prefix);
    if (!state || state.root !== root) {
      state = { prefix, root, baseTree: null, currentTree: null };
      entry.repos.set(prefix, state);
    }
    return state;
  }

  /** The repository a path of the panel belongs to: the innermost one that contains it. */
  private repoOf(entry: SessionGit, file: string): RepoState | null {
    let best: RepoState | null = null;
    for (const prefix of entry.active) {
      const state = entry.repos.get(prefix);
      if (!state) continue;
      if (prefix !== '' && file !== prefix && !file.startsWith(`${prefix}/`)) continue;
      if (!best || prefix.length > best.prefix.length) best = state;
    }
    return best;
  }

  private indexFile(entry: SessionGit, prefix: string, name: 'base' | 'current'): string {
    // The repository at the root keeps the place it always had.
    const dir = prefix ? path.join(entry.workDir, 'repos', encodeURIComponent(prefix)) : '';
    return path.join(dir || entry.workDir, `${name}.index`);
  }

  /**
   * Finds where the repositories of the session are. A session inside a repository has that
   * one; a plain folder is looked into, since an agent started there works on whatever
   * repositories it holds.
   */
  private async discover(entry: SessionGit, fresh: boolean): Promise<void> {
    if (!fresh && (entry.inRepository || Date.now() - entry.discoveredAt < DISCOVERY_TTL_MS)) {
      return;
    }
    const inside = await repositoryRoot(entry.cwd);
    entry.discoveredAt = Date.now();
    entry.inRepository = inside !== null;
    if (inside) {
      entry.root = inside;
      entry.top = [''];
    } else {
      entry.top = await findRepositories(entry.cwd);
      entry.root = entry.top.length > 0 ? entry.cwd : null;
    }
    if (!entry.active.length || !entry.root) entry.active = entry.top;
    for (const prefix of entry.top) {
      this.repo(entry, prefix, prefix ? path.join(entry.root!, prefix) : entry.root!);
    }
  }

  /**
   * What changed in every repository of the session, with paths relative to its root. A
   * repository inside another is looked at by itself: for the outer one it is a single
   * untracked folder, which says nothing about what changed in it.
   */
  private async scan(
    entry: SessionGit,
    base: DiffBase,
    checkpoint?: CheckpointTrees,
  ): Promise<{ changes: FileChange[]; repos: RepoInfo[] }> {
    const root = entry.root!;
    const found = new Map<string, FileChange[]>();
    const queue = [...entry.top];
    while (queue.length > 0 && found.size < MAX_REPOSITORIES) {
      const prefix = queue.shift()!;
      if (found.has(prefix)) continue;
      const repoRoot = prefix ? path.join(root, prefix) : root;
      try {
        const state = this.repo(entry, prefix, repoRoot);
        const nested: string[] = [];
        let own: FileChange[] = [];
        for (const change of await statusChanges(repoRoot)) {
          if (!change.path.endsWith('/')) own.push(change);
          else {
            const folder = change.path.slice(0, -1);
            if (isRepository(path.join(repoRoot, folder))) nested.push(folder);
            else own.push({ ...change, path: folder });
          }
        }
        const from =
          base === 'session'
            ? state.baseTree
            : base === 'branchBase' && prefix === ''
              ? entry.mergeBase
              : isCheckpointBase(base) && prefix === ''
                ? (checkpoint?.from ?? null)
                : null;
        if (from && checkpoint?.to && prefix === '') {
          // Two checkpoints: the folder as it is now does not come into it.
          own = (await treeChanges(repoRoot, from, checkpoint.to)).filter(
            (change) => !nested.includes(change.path),
          );
        } else if (from) {
          state.currentTree = await snapshotTree(
            repoRoot,
            this.indexFile(entry, prefix, 'current'),
          );
          own = (await treeChanges(repoRoot, from, state.currentTree)).filter(
            (change) => !nested.includes(change.path),
          );
        }
        found.set(
          prefix,
          own.map((change) =>
            prefix
              ? {
                  ...change,
                  path: join(prefix, change.path),
                  ...(change.origPath ? { origPath: join(prefix, change.origPath) } : {}),
                  repo: prefix,
                }
              : change,
          ),
        );
        for (const folder of nested) queue.push(join(prefix, folder));
      } catch (err) {
        // One repository that cannot be read does not hide the others; the only one does.
        if (entry.top.length === 1 && prefix === entry.top[0]) throw err;
      }
    }
    const prefixes = [...found.keys()].sort((a, b) => a.localeCompare(b));
    entry.active = prefixes;
    return {
      changes: prefixes.flatMap((prefix) => found.get(prefix)!),
      repos: prefixes.map((prefix) => ({
        path: prefix,
        name: prefix || path.basename(root),
        branch: null,
        count: found.get(prefix)!.length,
      })),
    };
  }

  /** Call when a session starts: records the snapshot the "session" base compares against. */
  async sessionStarted(sessionId: string, cwd: string): Promise<void> {
    const entry = this.entry(sessionId, cwd);
    entry.repos.clear();
    try {
      await fs.promises.rm(entry.workDir, { recursive: true, force: true });
      await this.discover(entry, true);
      if (!entry.root) return;
      // Repositories inside another are only known after asking git.
      await this.scan(entry, 'head');
      for (const prefix of entry.active) {
        const state = entry.repos.get(prefix);
        if (!state) continue;
        state.baseTree = await snapshotTree(
          state.root,
          this.indexFile(entry, prefix, 'base'),
        ).catch(() => null);
      }
    } catch {
      // No git, or not a repository: the HEAD comparison explains why.
    }
  }

  async sessionClosed(sessionId: string): Promise<void> {
    const entry = this.sessions.get(sessionId);
    if (!entry) return;
    entry.watcher?.stop();
    this.sessions.delete(sessionId);
    this.indexes.dropPrefix(`${sessionId}|`);
    await fs.promises.rm(entry.workDir, { recursive: true, force: true }).catch(() => {});
  }

  async overview(
    sessionId: string,
    cwd: string,
    base: DiffBase,
    options: {
      watch?: boolean;
      /** The base of the branch, for a session in a copy of the repository. */
      branchBase?: string;
      checkpoint?: CheckpointTrees;
    } = {},
  ): Promise<GitOverview> {
    const entry = this.entry(sessionId, cwd);
    // Without git the panel still lists the files of the folder, and follows them.
    const unavailable = (overview: Extract<GitOverview, { ok: false }>): GitOverview => {
      entry.root = null;
      entry.inRepository = false;
      entry.active = [];
      if (options.watch) this.watch(sessionId, entry, cwd);
      return overview;
    };
    const version = await this.version(!entry.root);
    if (!version) {
      return unavailable({ ok: false, reason: 'git-missing', minVersion: MIN_GIT_VERSION });
    }
    if (compareVersions(version, MIN_GIT_VERSION) < 0) {
      return unavailable({
        ok: false,
        reason: 'git-too-old',
        gitVersion: version,
        minVersion: MIN_GIT_VERSION,
      });
    }
    try {
      await this.discover(entry, true);
    } catch (err) {
      if (err instanceof GitMissingError) {
        return unavailable({ ok: false, reason: 'git-missing', minVersion: MIN_GIT_VERSION });
      }
      throw err;
    }
    if (!entry.root) {
      return unavailable({
        ok: false,
        reason: 'not-a-repo',
        gitVersion: version,
        minVersion: MIN_GIT_VERSION,
      });
    }

    const hasSessionBase = () =>
      entry.active.some((prefix) => entry.repos.get(prefix)?.baseTree != null);
    entry.mergeBase =
      options.branchBase && entry.inRepository
        ? await mergeBase(entry.root, options.branchBase).catch(() => null)
        : null;
    const used: DiffBase =
      base === 'session' && hasSessionBase()
        ? 'session'
        : base === 'branchBase' && entry.mergeBase
          ? 'branchBase'
          : isCheckpointBase(base) && options.checkpoint && entry.inRepository
            ? base
            : 'head';
    const { changes, repos } = await this.scan(entry, used, options.checkpoint);
    entry.lastChanges = changes;
    // The branch only matters to tell repositories apart.
    if (repos.length > 1) {
      await Promise.all(
        repos.map(async (repo) => {
          const state = entry.repos.get(repo.path);
          repo.branch = state ? await currentBranch(state.root).catch(() => null) : null;
        }),
      );
    }

    if (options.watch) this.watch(sessionId, entry, entry.root);
    return {
      ok: true,
      root: entry.root,
      changes,
      repos,
      base: used,
      hasSessionBase: hasSessionBase(),
      hasBranchBase: entry.mergeBase !== null,
    };
  }

  private watch(sessionId: string, entry: SessionGit, root: string): void {
    if (entry.watcher) return;
    entry.watcher = new RepoWatcher({ root, onChange: () => this.options.onChange(sessionId) });
    entry.watcher.start();
  }

  /**
   * One folder of the session, for the "all files" tree. It lists from the root of the
   * repository, so the paths are the same ones the changes use; without git, from the folder
   * of the session.
   */
  async list(
    sessionId: string,
    cwd: string,
    dir: string,
    showHidden: boolean,
  ): Promise<FileListing> {
    const entry = this.entry(sessionId, cwd);
    await this.discover(entry, false).catch(() => {});
    entry.browseRoot = entry.root ?? cwd;
    const folder = path.posix.normalize(dir.replaceAll('\\', '/')).replace(/^\.$|\/$/g, '');
    const repo = this.repoOf(entry, folder);
    return listDirectory(entry.browseRoot, folder, {
      showHidden,
      git: repo !== null,
      repo: repo ? { root: repo.root, prefix: repo.prefix } : undefined,
    });
  }

  /**
   * Every file of the folder the "all files" tree shows, by path, and what changed against HEAD.
   * The list is kept for a few seconds and dropped a minute after the last request.
   */
  async index(sessionId: string, cwd: string, showHidden: boolean): Promise<FileIndexResult> {
    const entry = this.entry(sessionId, cwd);
    await this.discover(entry, false).catch(() => {});
    entry.browseRoot = entry.root ?? cwd;
    const root = entry.browseRoot;
    const [listing, changed] = await Promise.all([
      this.indexes.get(`${sessionId}|${showHidden}`, () => buildFileIndex(root, { showHidden })),
      entry.root
        ? this.scan(entry, 'head').then(
            (result) => result.changes,
            () => [] as FileChange[],
          )
        : [],
    ]);
    // What git lists of a file taken out of the folder is not there to open.
    const removed = new Set(changed.filter((c) => c.kind === 'removed').map((c) => c.path));
    return {
      files: removed.size > 0 ? listing.files.filter((file) => !removed.has(file)) : listing.files,
      truncated: listing.truncated,
      changed: changed.slice(0, 200),
    };
  }

  /** Number of changed files against HEAD, for the counter on the button. Null without git. */
  async count(sessionId: string, cwd: string): Promise<number | null> {
    try {
      const entry = this.entry(sessionId, cwd);
      await this.discover(entry, false);
      if (!entry.root) return null;
      return (await this.scan(entry, 'head')).changes.length;
    } catch {
      return null;
    }
  }

  async diff(
    sessionId: string,
    file: string,
    base: DiffBase,
    checkpoint?: CheckpointTrees,
  ): Promise<FileDiff> {
    const entry = this.sessions.get(sessionId);
    const root = entry?.root ?? entry?.browseRoot;
    if (!entry || !root) throw new UserError('error.panel.notOpen');
    const repo = this.repoOf(entry, file);
    // Outside every repository there is no "before", only the file as it is.
    if (!repo) return fileDiff(root, { path: file, kind: 'untracked' }, null);

    const inside = (p: string) => (repo.prefix ? p.slice(repo.prefix.length + 1) : p);
    const known = entry.lastChanges.find((c) => c.path === file);
    const change: FileChange = known
      ? {
          kind: known.kind,
          path: inside(known.path),
          ...(known.origPath ? { origPath: inside(known.origPath) } : {}),
        }
      : { path: inside(file), kind: 'modified' };
    const byCheckpoint = isCheckpointBase(base) && repo.prefix === '' ? checkpoint : undefined;
    if (byCheckpoint?.to) {
      const original =
        change.kind === 'added' || change.kind === 'untracked'
          ? { kind: 'missing' as const }
          : await blobContent(repo.root, byCheckpoint.from, change.origPath ?? change.path);
      const modified =
        change.kind === 'removed'
          ? { kind: 'missing' as const }
          : await blobContent(repo.root, byCheckpoint.to, change.path);
      return { path: file, original, modified, readOnly: true };
    }
    const treeish = byCheckpoint
      ? byCheckpoint.from
      : base === 'session' && repo.baseTree
        ? repo.baseTree
        : base === 'branchBase' && repo.prefix === '' && entry.mergeBase
          ? entry.mergeBase
          : (await hasHead(repo.root))
            ? 'HEAD'
            : null;
    return { ...(await fileDiff(repo.root, change, treeish)), path: file };
  }

  /** The folder the paths of the panel are relative to, once the panel has been opened. */
  rootFor(sessionId: string): string | null {
    const entry = this.sessions.get(sessionId);
    return entry?.root ?? entry?.browseRoot ?? null;
  }

  /** Saves an edit made in the panel to the file in the working tree. */
  async save(
    sessionId: string,
    file: string,
    content: string,
    expected: string | null,
  ): Promise<SaveResult> {
    const entry = this.sessions.get(sessionId);
    const root = entry?.root ?? entry?.browseRoot;
    if (!root) throw new UserError('error.panel.notOpen');
    return saveWorkingTreeFile(root, file, content, expected);
  }

  /**
   * The repository a path of the panel is in, and the path inside it. Only paths the panel lists
   * (or could list) are taken: the panel must be open for the session.
   */
  private target(sessionId: string, file: string): { repo: RepoState; inside: string } {
    const entry = this.sessions.get(sessionId);
    if (!entry?.root) throw new UserError('error.panel.notOpen');
    const repo = this.repoOf(entry, file);
    if (!repo) throw new UserError('error.git.notInRepo', { file });
    return { repo, inside: repo.prefix ? file.slice(repo.prefix.length + 1) : file };
  }

  private byRepo(sessionId: string, files: string[]): Map<RepoState, string[]> {
    const groups = new Map<RepoState, string[]>();
    for (const file of files) {
      const { repo, inside } = this.target(sessionId, file);
      groups.set(repo, [...(groups.get(repo) ?? []), inside]);
    }
    return groups;
  }

  /** Puts the changes of these files in the index of their repositories. */
  async stage(sessionId: string, files: string[]): Promise<void> {
    for (const [repo, inside] of this.byRepo(sessionId, files)) await stage(repo.root, inside);
    this.options.onChange(sessionId);
  }

  async unstage(sessionId: string, files: string[]): Promise<void> {
    for (const [repo, inside] of this.byRepo(sessionId, files)) await unstage(repo.root, inside);
    this.options.onChange(sessionId);
  }

  /** Commits what is staged in one repository of the session: `''` is the one at its root. */
  async commit(sessionId: string, repoPath: string, message: string): Promise<CommitResult> {
    const entry = this.sessions.get(sessionId);
    if (!entry?.root) throw new UserError('error.panel.notOpen');
    const repo = entry.active.includes(repoPath) ? entry.repos.get(repoPath) : undefined;
    if (!repo) throw new UserError('error.git.notInRepo', { file: repoPath });
    const result = await commit(repo.root, message);
    this.options.onChange(sessionId);
    return result;
  }

  /** Discards the changes of one file, keeping a copy of it in `trashDir` first. */
  async discard(sessionId: string, file: string, trashDir: string): Promise<DiscardRecord> {
    const { repo, inside } = this.target(sessionId, file);
    const known = this.sessions.get(sessionId)!.lastChanges.find((c) => c.path === file);
    const origPath =
      known?.kind === 'renamed' && known.origPath
        ? repo.prefix
          ? known.origPath.slice(repo.prefix.length + 1)
          : known.origPath
        : undefined;
    const record = await discard(repo.root, inside, trashDir, origPath);
    this.options.onChange(sessionId);
    return record;
  }

  async undoDiscard(sessionId: string, id: string, trashDir: string): Promise<void> {
    await undoDiscard(trashDir, id);
    this.options.onChange(sessionId);
  }

  /** Stops watching; the snapshot of the session start is kept. */
  close(sessionId: string): void {
    const entry = this.sessions.get(sessionId);
    entry?.watcher?.stop();
    if (entry) entry.watcher = null;
  }

  dispose(): void {
    for (const entry of this.sessions.values()) entry.watcher?.stop();
    this.sessions.clear();
    this.indexes.dropPrefix('');
  }
}
