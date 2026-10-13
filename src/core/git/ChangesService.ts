import fs from 'node:fs';
import path from 'node:path';
import type { DiffBase, FileChange, FileDiff, GitOverview } from '@shared/git';
import { compareVersions } from '../agents/detect';
import {
  fileDiff,
  GitMissingError,
  gitVersion,
  hasHead,
  MIN_GIT_VERSION,
  repositoryRoot,
  snapshotTree,
  statusChanges,
  treeChanges,
} from './GitService';
import { RepoWatcher } from './RepoWatcher';

interface SessionGit {
  cwd: string;
  root: string | null;
  /** Tree recorded when the session started, for the "since the session started" comparison. */
  baseTree: string | null;
  /** Private index used to snapshot the current state when comparing against `baseTree`. */
  workDir: string;
  watcher: RepoWatcher | null;
  lastChanges: FileChange[];
  currentTree: string | null;
}

export interface ChangesServiceOptions {
  /** Where the private index files live: the app's own data directory, never the repository. */
  workDirectory: string;
  onChange: (sessionId: string) => void;
}

/** The "see changes" panel, per session: what changed, both sides of a file, and the watcher. */
export class ChangesService {
  private readonly sessions = new Map<string, SessionGit>();
  private versionCheck: Promise<string | null> | null = null;

  constructor(private readonly options: ChangesServiceOptions) {}

  private entry(sessionId: string, cwd: string): SessionGit {
    let entry = this.sessions.get(sessionId);
    if (!entry || entry.cwd !== cwd) {
      entry?.watcher?.stop();
      entry = {
        cwd,
        root: null,
        baseTree: null,
        workDir: path.join(this.options.workDirectory, sessionId),
        watcher: null,
        lastChanges: [],
        currentTree: null,
      };
      this.sessions.set(sessionId, entry);
    }
    return entry;
  }

  private version(refresh = false): Promise<string | null> {
    if (refresh || !this.versionCheck) this.versionCheck = gitVersion();
    return this.versionCheck;
  }

  /** Call when a session starts: records the snapshot the "session" base compares against. */
  async sessionStarted(sessionId: string, cwd: string): Promise<void> {
    const entry = this.entry(sessionId, cwd);
    entry.baseTree = null;
    entry.currentTree = null;
    try {
      await fs.promises.rm(entry.workDir, { recursive: true, force: true });
      entry.root = await repositoryRoot(cwd);
      if (!entry.root) return;
      entry.baseTree = await snapshotTree(entry.root, path.join(entry.workDir, 'base.index'));
    } catch {
      entry.baseTree = null; // No git, or not a repository: the HEAD comparison explains why.
    }
  }

  async sessionClosed(sessionId: string): Promise<void> {
    const entry = this.sessions.get(sessionId);
    if (!entry) return;
    entry.watcher?.stop();
    this.sessions.delete(sessionId);
    await fs.promises.rm(entry.workDir, { recursive: true, force: true }).catch(() => {});
  }

  async overview(
    sessionId: string,
    cwd: string,
    base: DiffBase,
    options: { watch?: boolean } = {},
  ): Promise<GitOverview> {
    const entry = this.entry(sessionId, cwd);
    const version = await this.version(!entry.root);
    if (!version) return { ok: false, reason: 'git-missing', minVersion: MIN_GIT_VERSION };
    if (compareVersions(version, MIN_GIT_VERSION) < 0) {
      return { ok: false, reason: 'git-too-old', gitVersion: version, minVersion: MIN_GIT_VERSION };
    }
    try {
      entry.root = await repositoryRoot(cwd);
    } catch (err) {
      if (err instanceof GitMissingError) {
        return { ok: false, reason: 'git-missing', minVersion: MIN_GIT_VERSION };
      }
      throw err;
    }
    if (!entry.root) {
      return { ok: false, reason: 'not-a-repo', gitVersion: version, minVersion: MIN_GIT_VERSION };
    }

    const useSession = base === 'session' && entry.baseTree !== null;
    if (useSession) {
      entry.currentTree = await snapshotTree(entry.root, path.join(entry.workDir, 'current.index'));
      entry.lastChanges = await treeChanges(entry.root, entry.baseTree!, entry.currentTree);
    } else {
      entry.lastChanges = await statusChanges(entry.root);
    }

    if (options.watch && !entry.watcher) {
      entry.watcher = new RepoWatcher({
        root: entry.root,
        onChange: () => this.options.onChange(sessionId),
      });
      entry.watcher.start();
    }
    return {
      ok: true,
      root: entry.root,
      changes: entry.lastChanges,
      base: useSession ? 'session' : 'head',
      hasSessionBase: entry.baseTree !== null,
    };
  }

  /** Number of changed files against HEAD, for the counter on the button. Null without git. */
  async count(sessionId: string, cwd: string): Promise<number | null> {
    try {
      const entry = this.entry(sessionId, cwd);
      entry.root ??= await repositoryRoot(cwd);
      if (!entry.root) return null;
      return (await statusChanges(entry.root)).length;
    } catch {
      return null;
    }
  }

  async diff(sessionId: string, file: string, base: DiffBase): Promise<FileDiff> {
    const entry = this.sessions.get(sessionId);
    if (!entry?.root) throw new Error('Painel de mudanças não está aberto para esta sessão');
    const change = entry.lastChanges.find((c) => c.path === file) ?? {
      path: file,
      kind: 'modified' as const,
    };
    if (base === 'session' && entry.baseTree) return fileDiff(entry.root, change, entry.baseTree);
    return fileDiff(entry.root, change, (await hasHead(entry.root)) ? 'HEAD' : null);
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
  }
}
