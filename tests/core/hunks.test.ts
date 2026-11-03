import fs from 'node:fs';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { ChangesService } from '@core/git/ChangesService';
import { buildHunks, diffLines, revertHunk, splitLines } from '@core/git/hunks';
import { removeDir, tempDir } from './helpers';
import { execFileSync } from 'node:child_process';

const numbered = (count: number, prefix = 'linha') =>
  Array.from({ length: count }, (_, i) => `${prefix} ${i + 1}`);

/** Applies the operations to `a` and checks they give `b`. */
function replay(a: string[], b: string[]): string[] {
  const ops = diffLines(a, b);
  const out: string[] = [];
  let i = 0;
  let j = 0;
  for (const op of ops) {
    if (op === 'ctx') {
      expect(a[i]).toBe(b[j]);
      out.push(a[i++]!);
      j++;
    } else if (op === 'del') i++;
    else out.push(b[j++]!);
  }
  return out;
}

describe('diffLines', () => {
  it('turns one side into the other, keeping the common lines', () => {
    const cases: [string[], string[]][] = [
      [[], ['a']],
      [['a'], []],
      [
        ['a', 'b', 'c'],
        ['a', 'x', 'c'],
      ],
      [numbered(50), [...numbered(20), 'novo', ...numbered(50).slice(25)]],
      [
        ['x', 'a', 'b', 'c', 'y'],
        ['a', 'b', 'q', 'c'],
      ],
    ];
    for (const [a, b] of cases) expect(replay(a, b)).toEqual(b);
  });

  it('finds the shortest script: one changed line is one removal and one addition', () => {
    const ops = diffLines(
      numbered(100),
      numbered(100).map((l, i) => (i === 49 ? 'mudou' : l)),
    );
    expect(ops.filter((o) => o === 'del')).toHaveLength(1);
    expect(ops.filter((o) => o === 'add')).toHaveLength(1);
  });
});

describe('buildHunks', () => {
  it('gives each change its context and merges close ones', () => {
    const before = numbered(40);
    const after = [...before];
    after[4] = 'cinco';
    after[6] = 'sete';
    after[30] = 'trinta e um';
    const hunks = buildHunks('a.ts', before, after);
    expect(hunks).toHaveLength(2);
    // Lines 5 and 7 are close: one block, lines 2 to 10.
    expect(hunks[0]).toMatchObject({ oldStart: 2, newStart: 2, oldLines: 9, newLines: 9 });
    expect(hunks[1]).toMatchObject({ newStart: 28, newLines: 7 });
    const changed = hunks[0]!.lines.filter((l) => l.kind !== 'ctx');
    expect(changed.map((l) => `${l.kind}:${l.text}`)).toEqual([
      'del:linha 5',
      'add:cinco',
      'del:linha 7',
      'add:sete',
    ]);
    expect(hunks[0]!.lines.find((l) => l.kind === 'add')).toMatchObject({ newNo: 5 });
    expect(hunks[0]!.lines.find((l) => l.kind === 'del')).toMatchObject({ oldNo: 5 });
  });

  it('keeps the id while the block reads the same, and changes it when it does not', () => {
    const before = numbered(10);
    const after = [...before];
    after[2] = 'x';
    const id = buildHunks('a.ts', before, after)[0]!.id;
    expect(buildHunks('a.ts', ['topo', ...before], ['topo', ...after])[0]!.lines).toHaveLength(8);
    expect(buildHunks('a.ts', before, after)[0]!.id).toBe(id);
    after[2] = 'y';
    expect(buildHunks('a.ts', before, after)[0]!.id).not.toBe(id);
    expect(
      buildHunks('b.ts', before, [...before.slice(0, 2), 'x', ...before.slice(3)])[0]!.id,
    ).not.toBe(id);
  });

  it('shows a new file as one block of additions and drops the \\r of CRLF', () => {
    const [hunk] = buildHunks('novo.ts', [], ['a\r', 'b\r']);
    expect(hunk!.lines).toEqual([
      { kind: 'add', text: 'a', newNo: 1 },
      { kind: 'add', text: 'b', newNo: 2 },
    ]);
  });
});

describe('revertHunk', () => {
  it('puts a block back, and refuses when the lines moved', () => {
    const before = numbered(20);
    const after = [...before];
    after.splice(9, 1, 'dez', 'dez e meio');
    const [hunk] = buildHunks('a.ts', before, after);
    const revert = {
      newStart: hunk!.newStart,
      before: hunk!.lines.filter((l) => l.kind !== 'add').map((l) => l.text),
      after: hunk!.lines.filter((l) => l.kind !== 'del').map((l) => l.text),
    };
    expect(revertHunk(after, revert)).toEqual(before);
    expect(revertHunk(['nova primeira', ...after], revert)).toBeNull();
  });

  it('keeps CRLF in the lines it brings back', () => {
    const before = ['a\r', 'b\r', 'c\r'];
    const after = ['a\r', 'B\r', 'c\r'];
    const [hunk] = buildHunks('a.ts', before, after);
    const revert = {
      newStart: hunk!.newStart,
      before: hunk!.lines.filter((l) => l.kind !== 'add').map((l) => l.text),
      after: hunk!.lines.filter((l) => l.kind !== 'del').map((l) => l.text),
    };
    expect(revertHunk(after, revert)).toEqual(before);
  });

  it('splits text into lines without a phantom last one', () => {
    expect(splitLines('')).toEqual([]);
    expect(splitLines('a\nb\n')).toEqual(['a', 'b']);
    expect(splitLines('a\nb')).toEqual(['a', 'b']);
  });
});

describe('ChangesService.hunks and revertHunk', () => {
  let dir = '';
  afterEach(() => dir && removeDir(dir));

  const git = (cwd: string, ...args: string[]) =>
    execFileSync('git', args, { cwd, stdio: 'pipe' }).toString();

  it('reads the blocks of every changed file and undoes one in the file on disk', async () => {
    dir = tempDir();
    const repo = path.join(dir, 'repo');
    fs.mkdirSync(repo);
    git(repo, 'init', '-q');
    git(repo, 'config', 'user.email', 't@t');
    git(repo, 'config', 'user.name', 't');
    fs.writeFileSync(path.join(repo, 'a.ts'), `${numbered(30).join('\n')}\n`);
    fs.writeFileSync(path.join(repo, 'b.bin'), Buffer.from([0, 1, 2, 3]));
    git(repo, 'add', '-A');
    git(repo, 'commit', '-q', '-m', 'base');
    const changed = numbered(30);
    changed[2] = 'três';
    changed[25] = 'vinte e seis';
    fs.writeFileSync(path.join(repo, 'a.ts'), `${changed.join('\n')}\n`);
    fs.writeFileSync(path.join(repo, 'b.bin'), Buffer.from([0, 9, 9, 9]));
    fs.writeFileSync(path.join(repo, 'novo.ts'), 'export {};\n');

    const service = new ChangesService({
      workDirectory: path.join(dir, 'work'),
      onChange: () => {},
    });
    try {
      await service.overview('s', repo, 'head');
      const all = await service.hunks('s', 'head');
      const byPath = new Map(all.files.map((f) => [f.path, f]));
      expect(byPath.get('a.ts')!.hunks).toHaveLength(2);
      expect(byPath.get('a.ts')!.revertible).toBe(true);
      expect(byPath.get('b.bin')!.skipped).toBe('binary');
      expect(byPath.get('novo.ts')!.revertible).toBe(false);

      const first = byPath.get('a.ts')!.hunks[0]!;
      const revert = {
        file: 'a.ts',
        newStart: first.newStart,
        before: first.lines.filter((l) => l.kind !== 'add').map((l) => l.text),
        after: first.lines.filter((l) => l.kind !== 'del').map((l) => l.text),
      };
      await service.revertHunk('s', 'head', revert);
      const now = fs.readFileSync(path.join(repo, 'a.ts'), 'utf8');
      expect(now).toContain('linha 3\n');
      expect(now).toContain('vinte e seis\n');
      expect(now.endsWith('\n')).toBe(true);
      // The same block again: its lines are no longer there.
      await expect(service.revertHunk('s', 'head', revert)).rejects.toThrow();
    } finally {
      service.dispose();
    }
  });
});
