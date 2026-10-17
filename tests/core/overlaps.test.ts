import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  computeOverlaps,
  hunkRange,
  locateRepository,
  OverlapService,
  parseHunks,
  rangesCross,
  type OverlapTarget,
} from '@core/git/OverlapService';
import {
  DEFAULT_OVERLAP_SETTINGS,
  overlapIgnoredMatcher,
  sanitizeOverlapSettings,
  type OverlapSettings,
} from '@shared/overlaps';
import { removeDir, tempDir } from './helpers';

const git = (cwd: string, ...args: string[]) =>
  execFileSync('git', args, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
const write = (root: string, file: string, content: string) => {
  const absolute = path.join(root, file);
  fs.mkdirSync(path.dirname(absolute), { recursive: true });
  fs.writeFileSync(absolute, content);
};
const lines = (n: number, change: Record<number, string> = {}) =>
  Array.from({ length: n }, (_, i) => change[i + 1] ?? `linha ${i + 1}`).join('\n') + '\n';

let repo: string;
let copies: string;
let one: string;
let two: string;

beforeEach(() => {
  // Spaces and accents: the folders of real users have them.
  repo = tempDir('ac repo conflito-');
  copies = tempDir('ac cópias conflito-');
  git(repo, 'init', '-q', '-b', 'main');
  git(repo, 'config', 'user.email', 'teste@example.com');
  git(repo, 'config', 'user.name', 'Teste');
  git(repo, 'config', 'commit.gpgsign', 'false');
  git(repo, 'config', 'core.autocrlf', 'false');
  write(repo, 'src/SessionManager.ts', lines(40));
  write(repo, 'src/outro.ts', lines(10));
  write(repo, 'package-lock.json', '{}\n');
  git(repo, 'add', '-A');
  git(repo, 'commit', '-q', '-m', 'base');
  one = path.join(copies, 'um');
  two = path.join(copies, 'dois');
  git(repo, 'worktree', 'add', '-q', '-b', 'ac/um', one, 'main');
  git(repo, 'worktree', 'add', '-q', '-b', 'ac/dois', two, 'main');
});
afterEach(() => {
  removeDir(copies);
  removeDir(repo);
});

const settings = (patch: Partial<OverlapSettings> = {}): OverlapSettings => ({
  ...DEFAULT_OVERLAP_SETTINGS,
  ...patch,
});
const targets = (): OverlapTarget[] => [
  { id: 'um', cwd: one, base: 'main', running: true },
  { id: 'dois', cwd: two, base: 'main', running: true },
];

describe('overlaps between sessions', () => {
  it('finds both copies in the same repository, apart from their folders', async () => {
    const a = await locateRepository(one);
    const b = await locateRepository(path.join(two, 'src'));
    const main = await locateRepository(repo);
    expect(a?.repoKey).toBe(b?.repoKey);
    expect(main?.repoKey).toBe(a?.repoKey);
    expect(a?.copyKey).not.toBe(b?.copyKey);
    expect(await locateRepository(copies)).toBeNull();
  });

  it('warns of the same file, without "likely" when the lines are apart', async () => {
    write(one, 'src/SessionManager.ts', lines(40, { 3: 'mudou no um' }));
    write(two, 'src/SessionManager.ts', lines(40, { 30: 'mudou no dois' }));
    write(two, 'src/outro.ts', lines(10, { 1: 'só no dois' }));
    const found = await computeOverlaps(targets(), settings());
    expect(found.get('um')).toEqual([
      {
        path: 'src/SessionManager.ts',
        likely: false,
        others: [{ sessionId: 'dois', path: 'src/SessionManager.ts', likely: false }],
      },
    ]);
    expect(found.get('dois')).toHaveLength(1);
    expect(found.get('dois')![0]).toMatchObject({ path: 'src/SessionManager.ts', likely: false });
  });

  it('says "likely conflict" when the changed lines cross, committed ones included', async () => {
    write(one, 'src/SessionManager.ts', lines(40, { 10: 'um' }));
    git(one, 'commit', '-qam', 'no um');
    write(two, 'src/SessionManager.ts', lines(40, { 11: 'dois' }));
    const found = await computeOverlaps(targets(), settings());
    expect(found.get('um')).toMatchObject([{ path: 'src/SessionManager.ts', likely: true }]);
    expect(found.get('dois')).toMatchObject([{ path: 'src/SessionManager.ts', likely: true }]);
  });

  it('takes two new files of the same name as a likely conflict', async () => {
    write(one, 'src/novo.ts', 'um\n');
    write(two, 'src/novo.ts', 'dois\n');
    const found = await computeOverlaps(targets(), settings());
    expect(found.get('um')).toMatchObject([{ path: 'src/novo.ts', likely: true }]);
  });

  it('leaves the lockfile out, and whatever else the list names', async () => {
    write(one, 'package-lock.json', '{"um":1}\n');
    write(two, 'package-lock.json', '{"dois":2}\n');
    write(one, 'src/outro.ts', lines(10, { 1: 'um' }));
    write(two, 'src/outro.ts', lines(10, { 9: 'dois' }));
    expect((await computeOverlaps(targets(), settings())).get('um')).toMatchObject([
      { path: 'src/outro.ts' },
    ]);
    const custom = settings({ ignored: [...DEFAULT_OVERLAP_SETTINGS.ignored, 'src/*.ts'] });
    expect((await computeOverlaps(targets(), custom)).get('um')).toEqual([]);
  });

  it('does not warn sessions that share one copy, nor with the warning off', async () => {
    write(one, 'src/outro.ts', lines(10, { 1: 'um' }));
    const same: OverlapTarget[] = [
      { id: 'a', cwd: one, base: 'main', running: true },
      { id: 'b', cwd: path.join(one, 'src'), running: true },
    ];
    expect((await computeOverlaps(same, settings())).get('a')).toEqual([]);
    write(two, 'src/outro.ts', lines(10, { 1: 'dois' }));
    expect((await computeOverlaps(targets(), settings({ enabled: false }))).get('um')).toEqual([]);
  });

  it('compares the original folder of the repository with a copy of it', async () => {
    write(repo, 'src/outro.ts', lines(10, { 5: 'no original' }));
    write(two, 'src/outro.ts', lines(10, { 5: 'na cópia' }));
    const found = await computeOverlaps(
      [
        { id: 'original', cwd: repo, running: false },
        { id: 'dois', cwd: two, base: 'main', running: true },
      ],
      settings(),
    );
    expect(found.get('original')).toMatchObject([{ path: 'src/outro.ts', likely: true }]);
  });

  it.runIf(process.platform === 'win32')(
    'takes a folder written with other case as the same repository on Windows',
    async () => {
      write(one, 'src/outro.ts', lines(10, { 2: 'um' }));
      write(two, 'src/outro.ts', lines(10, { 2: 'dois' }));
      const swapped = (folder: string) =>
        folder.replace(/[a-zA-Z]/g, (c) =>
          c === c.toLowerCase() ? c.toUpperCase() : c.toLowerCase(),
        );
      const found = await computeOverlaps(
        [
          { id: 'um', cwd: swapped(one), base: 'main', running: true },
          { id: 'dois', cwd: two, base: 'main', running: true },
          // The same copy as "um", spelled otherwise: no warning between the two.
          { id: 'tres', cwd: one.toLowerCase(), base: 'main', running: true },
        ],
        settings(),
      );
      expect(found.get('um')).toMatchObject([{ path: 'src/outro.ts', likely: true }]);
      expect(found.get('um')![0]!.others.map((o) => o.sessionId)).toEqual(['dois']);
    },
  );
});

describe('hunks', () => {
  it('reads the changed lines of the old side, file by file', () => {
    const patch = [
      'diff --git a/src/a.ts b/src/a.ts',
      'index 1..2 100644',
      '--- a/src/a.ts',
      '+++ b/src/a.ts',
      '@@ -3,2 +3,2 @@ x',
      '-a',
      '+b',
      '@@ -10,0 +11 @@',
      '+c',
      'diff --git a/novo.ts b/novo.ts',
      'new file mode 100644',
      'diff --git "a/caf\\303\\251 x.ts" "b/caf\\303\\251 x.ts"',
      '@@ -1 +1 @@',
      'diff --git a/img.png b/img.png',
      'Binary files a/img.png and b/img.png differ',
    ].join('\n');
    const files = parseHunks(patch);
    expect(files.get('src/a.ts')).toEqual([
      [2, 4],
      [10, 10],
    ]);
    expect(files.get('novo.ts')).toBe('all');
    expect(files.get('café x.ts')).toEqual([[0, 1]]);
    expect(files.get('img.png')).toBe('all');
  });

  it('crosses touching changes, as the merge of git does, and not those apart', () => {
    expect(rangesCross([hunkRange(5, 1)], [hunkRange(6, 1)])).toBe(true);
    expect(rangesCross([hunkRange(5, 1)], [hunkRange(5, 0)])).toBe(true);
    expect(rangesCross([hunkRange(5, 1)], [hunkRange(7, 1)])).toBe(false);
    expect(rangesCross('all', [])).toBe(true);
    expect(rangesCross([], [hunkRange(1, 3)])).toBe(false);
  });

  it('matches the ignore list by name anywhere, or by path', () => {
    const ignored = overlapIgnoredMatcher(['package-lock.json', 'gen/**', '*.snap']);
    expect(ignored('package-lock.json')).toBe(true);
    expect(ignored('apps/web/package-lock.json')).toBe(true);
    expect(ignored('gen/a/b.ts')).toBe(true);
    expect(ignored('src/gen/b.ts')).toBe(false);
    expect(ignored('tests/x.snap')).toBe(true);
    expect(ignored('src/a.ts')).toBe(false);
    expect(sanitizeOverlapSettings({ ignored: [' a ', 'a', 3, 'x\\y'] }).ignored).toEqual([
      'a',
      'x/y',
    ]);
    expect(sanitizeOverlapSettings(undefined)).toEqual(DEFAULT_OVERLAP_SETTINGS);
  });
});

describe('OverlapService', () => {
  afterEach(() => vi.useRealTimers());

  it('looks at a repository once per burst, and not again before the interval', async () => {
    vi.useFakeTimers();
    const sessions: OverlapTarget[] = [
      { id: 'a', cwd: '/r/a', running: true },
      { id: 'b', cwd: '/r/b', running: false },
    ];
    const compute = vi.fn(async (list: readonly OverlapTarget[]) => {
      return new Map(
        list.map((t) => [
          t.id,
          [
            {
              path: 'x.ts',
              likely: false,
              others: list
                .filter((o) => o.id !== t.id)
                .map((o) => ({ sessionId: o.id, path: 'x.ts', likely: false })),
            },
          ],
        ]),
      );
    });
    const changes: [string, unknown][] = [];
    let current = settings();
    const service = new OverlapService({
      sessions: () => sessions,
      settings: () => current,
      onChange: (id, summary) => changes.push([id, summary]),
      compute,
      locate: async (cwd) => ({ toplevel: cwd, copyKey: cwd, repoKey: 'r' }),
      debounceMs: 500,
      minIntervalMs: 5000,
    });

    for (let i = 0; i < 5; i++) await service.touch(i % 2 ? 'a' : 'b');
    await vi.advanceTimersByTimeAsync(499);
    expect(compute).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1);
    expect(compute).toHaveBeenCalledTimes(1);
    expect(service.summary('a')).toEqual({ files: 1, likely: 0, sessionIds: ['b'] });
    expect(changes.map(([id]) => id).sort()).toEqual(['a', 'b']);

    // Asked again right away: it waits for the interval, however many times it is asked.
    await service.touch('a');
    await vi.advanceTimersByTimeAsync(1000);
    await service.touch('b');
    await vi.advanceTimersByTimeAsync(3000);
    expect(compute).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(1000);
    expect(compute).toHaveBeenCalledTimes(2);

    // Stopped sessions out: "b" is not compared, and "a" has nobody left.
    current = settings({ includeStopped: false });
    await service.refreshAll();
    await vi.advanceTimersByTimeAsync(5000);
    expect(compute).toHaveBeenCalledTimes(3);
    expect(compute.mock.calls[2]![0].map((t) => t.id)).toEqual(['a']);
    service.dispose();
  });
});
