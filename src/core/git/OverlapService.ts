import path from 'node:path';
import {
  overlapIgnoredMatcher,
  sameOverlapSummary,
  type OverlapFile,
  type OverlapSettings,
  type OverlapSummary,
} from '@shared/overlaps';
import { toLongPath } from '../pty/longPath';
import { hasHead, mergeBase, repositoryRoot, runGit } from './GitService';

/** A session as the warning sees it. */
export interface OverlapTarget {
  id: string;
  cwd: string;
  /** For a session in a copy: the branch its own started from ("the base of the branch"). */
  base?: string;
  running: boolean;
}

/** Where a folder is: its copy of the repository, and the repository all copies share. */
export interface RepoLocation {
  /** Root of the copy (the working tree), as git spells it. */
  toplevel: string;
  /** Tells copies apart: two sessions with the same one work in the same folder. */
  copyKey: string;
  /** The same for every copy (`git worktree`) of one repository: its common git folder. */
  repoKey: string;
}

// The same folder written another way (case, 8.3 short names) is the same folder on Windows.
const pathKey = (file: string): string =>
  process.platform === 'win32' ? toLongPath(file).toLowerCase() : path.resolve(file);
const fileKey = (file: string): string =>
  process.platform === 'win32' ? file.toLowerCase() : file;

export async function locateRepository(cwd: string): Promise<RepoLocation | null> {
  try {
    const toplevel = await repositoryRoot(cwd);
    if (!toplevel) return null;
    const result = await runGit(toplevel, ['rev-parse', '--git-common-dir']);
    const common = result.stdout.toString('utf8').trim();
    if (result.code !== 0 || !common) return null;
    return {
      toplevel,
      copyKey: pathKey(toplevel),
      repoKey: pathKey(path.resolve(toplevel, common)),
    };
  } catch {
    return null; // No git, or the folder is gone.
  }
}

/** Lines changed in a file, between line boundaries of the old side: `[start, end]`. */
export type LineRange = readonly [number, number];
/** The whole file: new, removed or binary, where any other change of it collides. */
export type FileRanges = LineRange[] | 'all';

/**
 * A hunk of `git diff -U0` as an interval between line boundaries of the old side: changing lines
 * 3 and 4 is `[2, 4]`, inserting after line 4 is `[4, 4]`. Two intervals that touch cross, which
 * is also when git's merge stops on them: adjacent changes conflict.
 */
export function hunkRange(start: number, count: number): LineRange {
  return count === 0 ? [start, start] : [start - 1, start - 1 + count];
}

export function rangesCross(a: FileRanges, b: FileRanges): boolean {
  if (a === 'all' || b === 'all') return true;
  return a.some(([s1, e1]) => b.some(([s2, e2]) => s1 <= e2 && s2 <= e1));
}

/** Undoes the quoting git uses for a path with unusual characters: `"a/caf\303\251"`. */
function unquote(text: string): string {
  if (!text.startsWith('"')) return text;
  const bytes: number[] = [];
  const escapes: Record<string, number> = { n: 10, t: 9, r: 13, '"': 34, '\\': 92, a: 7, b: 8 };
  for (let i = 1; i < text.length - 1; i++) {
    const c = text[i]!;
    if (c !== '\\') {
      bytes.push(...Buffer.from(c, 'utf8'));
      continue;
    }
    const next = text[++i]!;
    if (/[0-7]/.test(next)) {
      bytes.push(parseInt(text.slice(i, i + 3), 8));
      i += 2;
    } else bytes.push(escapes[next] ?? next.charCodeAt(0));
  }
  return Buffer.from(bytes).toString('utf8');
}

/** The path of a `diff --git a/<path> b/<path>` line; without renames both sides are the same. */
function headerPath(line: string): string | null {
  const rest = line.slice('diff --git '.length);
  if (rest.startsWith('"')) {
    const end = rest.indexOf('" ', 1);
    return end < 0 ? null : unquote(rest.slice(0, end + 1)).replace(/^a\//, '');
  }
  if (!rest.startsWith('a/')) return null;
  // "a/<p> b/<p>": the two halves have the same length.
  return rest.slice(2, 2 + (rest.length - 5) / 2);
}

/** The changed lines of each file in `git diff -U0 --src-prefix=a/ --dst-prefix=b/`. */
export function parseHunks(patch: string): Map<string, FileRanges> {
  const files = new Map<string, FileRanges>();
  let current: string | null = null;
  for (const line of patch.split('\n')) {
    if (line.startsWith('diff --git ')) {
      current = headerPath(line);
      if (current !== null) files.set(current, []);
      continue;
    }
    if (current === null) continue;
    const ranges = files.get(current)!;
    if (
      line.startsWith('new file mode') ||
      line.startsWith('deleted file mode') ||
      line.startsWith('Binary files ')
    ) {
      files.set(current, 'all');
      continue;
    }
    const hunk = /^@@ -(\d+)(?:,(\d+))? \+\d+(?:,\d+)? @@/.exec(line);
    if (hunk && ranges !== 'all') {
      ranges.push(hunkRange(Number(hunk[1]), hunk[2] === undefined ? 1 : Number(hunk[2])));
    }
  }
  return files;
}

/** What a copy changed: against the base of its branch (commits and all), or against HEAD. */
interface CopyChanges {
  toplevel: string;
  /** What the lines are compared with; null in a repository without any commit. */
  base: string | null;
  /** By file key; the value is the path as git spells it, and whether git does not track it. */
  files: Map<string, { path: string; untracked: boolean }>;
  ranges: Map<string, FileRanges>;
}

const splitZ = (buffer: Buffer) => buffer.toString('utf8').split('\0').filter(Boolean);

async function gitLines(cwd: string, args: string[]): Promise<string[]> {
  const result = await runGit(cwd, args);
  if (result.code !== 0) throw new Error(`git ${args[0]}: ${result.stderr.trim()}`);
  return splitZ(result.stdout);
}

async function copyChanges(toplevel: string, branchBase: string | undefined): Promise<CopyChanges> {
  const base =
    (branchBase ? await mergeBase(toplevel, branchBase).catch(() => null) : null) ??
    ((await hasHead(toplevel)) ? 'HEAD' : null);
  const files = new Map<string, { path: string; untracked: boolean }>();
  const add = (file: string, untracked: boolean) =>
    files.set(fileKey(file), { path: file, untracked });
  if (base) {
    // The working tree against the base: what was committed since, and what was not, together.
    for (const file of await gitLines(toplevel, [
      'diff',
      '--name-only',
      '-z',
      '--no-renames',
      base,
    ])) {
      add(file, false);
    }
    for (const file of await gitLines(toplevel, [
      'ls-files',
      '-z',
      '--others',
      '--exclude-standard',
    ])) {
      add(file, true);
    }
  } else {
    const all = await gitLines(toplevel, [
      'ls-files',
      '-z',
      '--cached',
      '--others',
      '--exclude-standard',
    ]);
    for (const file of all) add(file, true);
  }
  return { toplevel, base, files, ranges: new Map() };
}

/** Pathspecs per call: a command line has a limit, lowest on Windows. */
const PATHS_PER_CALL = 100;

/** Fills in the changed lines of `keys`, the files this copy has in common with another. */
async function loadRanges(copy: CopyChanges, keys: string[]): Promise<void> {
  const tracked: string[] = [];
  for (const key of keys) {
    const file = copy.files.get(key)!;
    if (file.untracked || !copy.base) copy.ranges.set(key, 'all');
    else tracked.push(file.path);
  }
  for (let i = 0; i < tracked.length; i += PATHS_PER_CALL) {
    const result = await runGit(copy.toplevel, [
      '--literal-pathspecs',
      'diff',
      '-U0',
      '--no-color',
      '--no-ext-diff',
      '--no-textconv',
      '--no-renames',
      '--src-prefix=a/',
      '--dst-prefix=b/',
      copy.base!,
      '--',
      ...tracked.slice(i, i + PATHS_PER_CALL),
    ]);
    if (result.code !== 0) throw new Error(`git diff: ${result.stderr.trim()}`);
    for (const [file, ranges] of parseHunks(result.stdout.toString('utf8'))) {
      copy.ranges.set(fileKey(file), ranges);
    }
  }
  // A file git lists but whose diff shows nothing (only its mode changed) has no lines.
  for (const key of keys) if (!copy.ranges.has(key)) copy.ranges.set(key, []);
}

/**
 * Crosses what each session changed with what the others in other copies of the same repository
 * changed. Sessions in the same copy are left out of each other's warning: they share the files
 * themselves, and the app says so elsewhere. Only the files in common are diffed line by line.
 */
export async function computeOverlaps(
  targets: readonly OverlapTarget[],
  settings: OverlapSettings,
  locate: (cwd: string) => Promise<RepoLocation | null> = locateRepository,
): Promise<Map<string, OverlapFile[]>> {
  const result = new Map<string, OverlapFile[]>();
  for (const target of targets) result.set(target.id, []);
  if (!settings.enabled) return result;
  const ignored = overlapIgnoredMatcher(settings.ignored);

  const located = await Promise.all(
    targets.map(async (target) => ({ target, at: await locate(target.cwd) })),
  );
  const byRepo = new Map<string, { target: OverlapTarget; at: RepoLocation }[]>();
  for (const { target, at } of located) {
    if (!at) continue;
    byRepo.set(at.repoKey, [...(byRepo.get(at.repoKey) ?? []), { target, at }]);
  }

  for (const members of byRepo.values()) {
    if (new Set(members.map((m) => m.at.copyKey)).size < 2) continue;
    // One look per copy and base: sessions in the same copy see the same files.
    const copies = new Map<string, Promise<CopyChanges | null>>();
    const changesOf = (member: { target: OverlapTarget; at: RepoLocation }) => {
      const key = `${member.at.copyKey}\0${member.target.base ?? ''}`;
      let found = copies.get(key);
      if (!found) {
        found = copyChanges(member.at.toplevel, member.target.base).catch(() => null);
        copies.set(key, found);
      }
      return found;
    };
    const seen = await Promise.all(
      members.map(async (m) => ({ ...m, changes: await changesOf(m) })),
    );
    const live = seen.filter((m): m is typeof m & { changes: CopyChanges } => m.changes !== null);

    // Which files each copy shares with any other copy: only those get their lines read.
    const shared = new Map<CopyChanges, Set<string>>();
    for (const a of live) {
      for (const b of live) {
        if (a.at.copyKey === b.at.copyKey) continue;
        for (const key of a.changes.files.keys()) {
          if (!b.changes.files.has(key) || ignored(a.changes.files.get(key)!.path)) continue;
          const set = shared.get(a.changes) ?? new Set<string>();
          set.add(key);
          shared.set(a.changes, set);
        }
      }
    }
    await Promise.all(
      [...shared].map(([copy, keys]) => loadRanges(copy, [...keys]).catch(() => {})),
    );

    for (const a of live) {
      const files: OverlapFile[] = [];
      for (const key of shared.get(a.changes) ?? []) {
        const others = live
          .filter((b) => b.at.copyKey !== a.at.copyKey && b.changes.files.has(key))
          .map((b) => ({
            sessionId: b.target.id,
            path: b.changes.files.get(key)!.path,
            likely: rangesCross(
              a.changes.ranges.get(key) ?? 'all',
              b.changes.ranges.get(key) ?? 'all',
            ),
          }));
        if (others.length === 0) continue;
        files.push({
          path: a.changes.files.get(key)!.path,
          likely: others.some((o) => o.likely),
          others,
        });
      }
      files.sort((x, y) => x.path.localeCompare(y.path));
      result.set(a.target.id, files);
    }
  }
  return result;
}

export function summarizeOverlaps(
  files: readonly OverlapFile[],
  order: readonly string[],
): OverlapSummary | undefined {
  if (files.length === 0) return undefined;
  const ids = new Set(files.flatMap((file) => file.others.map((other) => other.sessionId)));
  return {
    files: files.length,
    likely: files.filter((file) => file.likely).length,
    sessionIds: order.filter((id) => ids.has(id)),
  };
}

export interface OverlapServiceOptions {
  /** Every session of the list, in its order. */
  sessions(): OverlapTarget[];
  settings(): OverlapSettings;
  /**
   * What a session has in common with the others changed: its summary (undefined when there is
   * nothing in common any more) or only the detail of its files.
   */
  onChange(sessionId: string, summary: OverlapSummary | undefined): void;
  /** A burst of changes becomes one look. */
  debounceMs?: number;
  /** At most one look per repository in this long: each runs git in every copy of it. */
  minIntervalMs?: number;
  compute?: typeof computeOverlaps;
  locate?: (cwd: string) => Promise<RepoLocation | null>;
  onError?(err: unknown): void;
}

interface Slot {
  timer: ReturnType<typeof setTimeout> | null;
  last: number;
  running: boolean;
  again: boolean;
}

/**
 * Keeps the warning of every session up to date. Asked to look again (a watcher saw a change, a
 * turn ended), it waits a little and never looks at the same repository more than once in
 * `minIntervalMs`; a request that comes while a look runs is served right after it.
 */
export class OverlapService {
  private readonly details = new Map<string, OverlapFile[]>();
  private readonly summaries = new Map<string, OverlapSummary>();
  private readonly slots = new Map<string, Slot>();
  /** Where each folder is, found once: the repository of a folder does not move. */
  private readonly locations = new Map<string, Promise<RepoLocation | null>>();
  /** The repository each session was last seen in, to look at it again when the session goes. */
  private readonly repoOf = new Map<string, string>();
  private readonly debounceMs: number;
  private readonly minIntervalMs: number;
  private readonly compute: typeof computeOverlaps;
  private readonly locateFolder: (cwd: string) => Promise<RepoLocation | null>;
  private disposed = false;

  constructor(private readonly options: OverlapServiceOptions) {
    this.debounceMs = options.debounceMs ?? 800;
    this.minIntervalMs = options.minIntervalMs ?? 5000;
    this.compute = options.compute ?? computeOverlaps;
    this.locateFolder = options.locate ?? locateRepository;
  }

  private locate(cwd: string): Promise<RepoLocation | null> {
    let found = this.locations.get(cwd);
    if (!found) {
      found = this.locateFolder(cwd).then((at) => {
        // Not a repository yet: a `git init` later makes it one.
        if (!at) this.locations.delete(cwd);
        return at;
      });
      this.locations.set(cwd, found);
    }
    return found;
  }

  /** The files of a session that other sessions also changed, as of the latest look. */
  detail(sessionId: string): OverlapFile[] {
    return this.details.get(sessionId) ?? [];
  }

  summary(sessionId: string): OverlapSummary | undefined {
    return this.summaries.get(sessionId);
  }

  /** Something changed in the folder of a session: its repository is looked at again. */
  async touch(sessionId: string): Promise<void> {
    const target = this.options.sessions().find((s) => s.id === sessionId);
    const previous = this.repoOf.get(sessionId);
    const at = target ? await this.locate(target.cwd) : null;
    if (this.disposed) return;
    if (previous && previous !== at?.repoKey) this.schedule(previous);
    if (!at) {
      this.repoOf.delete(sessionId);
      this.set(sessionId, []);
      return;
    }
    this.repoOf.set(sessionId, at.repoKey);
    this.schedule(at.repoKey);
  }

  /** Every session again: the list or the preferences changed. */
  async refreshAll(): Promise<void> {
    const ids = new Set(this.options.sessions().map((s) => s.id));
    for (const id of [...this.details.keys()]) if (!ids.has(id)) this.forget(id);
    await Promise.all([...ids].map((id) => this.touch(id)));
  }

  /** The session is gone: the others of its repository may have nothing in common any more. */
  forget(sessionId: string): void {
    this.details.delete(sessionId);
    this.summaries.delete(sessionId);
    const key = this.repoOf.get(sessionId);
    this.repoOf.delete(sessionId);
    if (key) this.schedule(key);
  }

  private schedule(key: string): void {
    if (this.disposed) return;
    let slot = this.slots.get(key);
    if (!slot) {
      slot = { timer: null, last: -Infinity, running: false, again: false };
      this.slots.set(key, slot);
    }
    if (slot.running) {
      slot.again = true;
      return;
    }
    if (slot.timer) return;
    const wait = Math.max(this.debounceMs, slot.last + this.minIntervalMs - Date.now());
    slot.timer = setTimeout(() => void this.run(key, slot), wait);
  }

  private async run(key: string, slot: Slot): Promise<void> {
    slot.timer = null;
    slot.running = true;
    slot.last = Date.now();
    try {
      const settings = this.options.settings();
      const all = this.options.sessions();
      const members: OverlapTarget[] = [];
      for (const target of all) {
        const at = await this.locate(target.cwd);
        if (at?.repoKey !== key) continue;
        this.repoOf.set(target.id, key);
        members.push(target);
      }
      const counted = members.filter((m) => settings.includeStopped || m.running);
      const found = await this.compute(counted, settings, (cwd) => this.locate(cwd));
      if (this.disposed) return;
      for (const member of members) this.set(member.id, found.get(member.id) ?? [], all);
    } catch (err) {
      this.options.onError?.(err);
    } finally {
      slot.running = false;
      slot.last = Date.now();
      if (slot.again && !this.disposed) {
        slot.again = false;
        this.schedule(key);
      }
    }
  }

  private set(
    sessionId: string,
    files: OverlapFile[],
    all: OverlapTarget[] = this.options.sessions(),
  ): void {
    const summary = summarizeOverlaps(
      files,
      all.map((s) => s.id),
    );
    const before = this.details.get(sessionId) ?? [];
    if (
      sameOverlapSummary(summary, this.summaries.get(sessionId)) &&
      JSON.stringify(before) === JSON.stringify(files)
    ) {
      return;
    }
    if (files.length) this.details.set(sessionId, files);
    else this.details.delete(sessionId);
    if (summary) this.summaries.set(sessionId, summary);
    else this.summaries.delete(sessionId);
    this.options.onChange(sessionId, summary);
  }

  dispose(): void {
    this.disposed = true;
    for (const slot of this.slots.values()) if (slot.timer) clearTimeout(slot.timer);
    this.slots.clear();
  }
}
