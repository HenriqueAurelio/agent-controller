import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { parseGitGrep, searchProject } from '@core/search/searchProject';
import { searchText, type SearchQuery } from '@shared/search';
import { removeDir, tempDir } from './helpers';

const git = (cwd: string, ...args: string[]) =>
  execFileSync('git', args, { cwd, stdio: 'pipe' }).toString();

const query = (over: Partial<SearchQuery>): SearchQuery => ({
  text: '',
  caseSensitive: false,
  wholeWord: false,
  regex: false,
  include: [],
  exclude: [],
  changedOnly: false,
  ...over,
});

function project(dir: string): string {
  const repo = path.join(dir, 'repo');
  fs.mkdirSync(path.join(repo, 'src'), { recursive: true });
  git(repo, 'init', '-q');
  git(repo, 'config', 'user.email', 't@t');
  git(repo, 'config', 'user.name', 't');
  fs.writeFileSync(path.join(repo, '.gitignore'), 'dist/\n');
  fs.writeFileSync(path.join(repo, 'src', 'a.ts'), 'console.log(1);\nconst total = 10;\n');
  fs.writeFileSync(path.join(repo, 'src', 'a.test.ts'), 'console.log("teste");\n');
  fs.mkdirSync(path.join(repo, 'dist'));
  fs.writeFileSync(path.join(repo, 'dist', 'a.js'), 'console.log(1);\n');
  git(repo, 'add', '-A');
  git(repo, 'commit', '-q', '-m', 'base');
  // Not committed yet: the search sees it too.
  fs.writeFileSync(path.join(repo, 'src', 'novo.ts'), 'export const Total = 2; // console\n');
  return repo;
}

describe('searching the project', () => {
  let dir = '';
  afterEach(() => dir && removeDir(dir));

  it('finds in tracked and new files, never in what .gitignore covers', async () => {
    dir = tempDir();
    const repo = project(dir);
    const found = await searchProject(repo, query({ text: 'console' }), {
      inGit: true,
      changed: [],
    });
    expect(found.matches.map((m) => `${m.file}:${m.line}:${m.column}`).sort()).toEqual([
      'src/a.test.ts:1:1',
      'src/a.ts:1:1',
      'src/novo.ts:1:28',
    ]);
  });

  it('takes case, whole word, regular expressions and the include and exclude fields', async () => {
    dir = tempDir();
    const repo = project(dir);
    const run = (over: Partial<SearchQuery>) =>
      searchProject(repo, query(over), { inGit: true, changed: [] }).then((r) =>
        r.matches.map((m) => m.file).sort(),
      );
    expect(await run({ text: 'Total', caseSensitive: true })).toEqual(['src/novo.ts']);
    expect(await run({ text: 'total' })).toEqual(['src/a.ts', 'src/novo.ts']);
    expect(await run({ text: 'tota', wholeWord: true })).toEqual([]);
    expect(await run({ text: 'total = \\d+', regex: true, caseSensitive: true })).toEqual([
      'src/a.ts',
    ]);
    expect(await run({ text: 'console', exclude: ['*.test.ts'] })).toEqual([
      'src/a.ts',
      'src/novo.ts',
    ]);
    expect(await run({ text: 'console', include: ['src/a*'] })).toEqual([
      'src/a.test.ts',
      'src/a.ts',
    ]);
    expect(
      (
        await searchProject(repo, query({ text: 'console', changedOnly: true }), {
          inGit: true,
          changed: ['src/novo.ts'],
        })
      ).matches.map((m) => m.file),
    ).toEqual(['src/novo.ts']);
    await expect(run({ text: '(', regex: true })).rejects.toThrow();
  });

  it('walks a folder outside git', async () => {
    dir = tempDir();
    fs.writeFileSync(path.join(dir, 'notas.md'), 'linha um\nTODO: revisar\n');
    const found = await searchProject(dir, query({ text: 'todo' }), { inGit: false, changed: [] });
    expect(found.matches).toEqual([
      { file: 'notas.md', line: 2, column: 1, text: 'TODO: revisar' },
    ]);
  });

  it('reads the output of git grep, stops at the limit, and writes the results for the agent', () => {
    const output = 'a.ts\x001\x005\x00const x = 1;\nb.ts\x0010\x002\x00 y\x00z\n';
    expect(parseGitGrep(output).matches).toEqual([
      { file: 'a.ts', line: 1, column: 5, text: 'const x = 1;' },
      { file: 'b.ts', line: 10, column: 2, text: ' y\x00z' },
    ]);
    expect(parseGitGrep(output, 1)).toMatchObject({ truncated: true });
    expect(searchText(parseGitGrep(output).matches.slice(0, 1))).toBe('a.ts:1: const x = 1;');
  });
});
