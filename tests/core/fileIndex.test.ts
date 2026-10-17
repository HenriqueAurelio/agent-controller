import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ChangesService } from '@core/git/ChangesService';
import { buildFileIndex, FileIndexCache } from '@core/git/FileIndex';
import { removeDir, tempDir } from './helpers';

let root: string;
let work: string;

const write = (file: string, content = 'x\n') => {
  fs.mkdirSync(path.dirname(path.join(root, file)), { recursive: true });
  fs.writeFileSync(path.join(root, file), content);
};
const git = (cwd: string, ...args: string[]) =>
  execFileSync('git', ['-c', 'user.name=t', '-c', 'user.email=t@t', ...args], {
    cwd,
    stdio: ['ignore', 'pipe', 'pipe'],
  });
const sorted = (files: string[]) => [...files].sort();

beforeEach(() => {
  root = tempDir();
  work = tempDir();
});
afterEach(() => {
  removeDir(root);
  removeDir(work);
});

describe('buildFileIndex in a repository', () => {
  beforeEach(() => {
    write('README.md');
    write('.env');
    write('.gitignore', 'build/\n*.log\n');
    write('src/app.ts');
    write('src/.oculto');
    write('build/saida.js');
    write('erro.log');
    git(root, 'init', '-q');
    git(root, 'add', '.');
    git(root, 'commit', '-qm', 'um', '--no-gpg-sign');
    write('src/novo.ts');
  });

  it('lists tracked and untracked files, without hidden ones or what .gitignore covers', async () => {
    const index = await buildFileIndex(root, { showHidden: false });
    expect(sorted(index.files)).toEqual(['README.md', 'src/app.ts', 'src/novo.ts']);
    expect(index.truncated).toBe(false);
  });

  it('with hidden files, adds dotfiles and ignored files, but not ignored folders or .git', async () => {
    const index = await buildFileIndex(root, { showHidden: true });
    expect(sorted(index.files)).toEqual([
      '.env',
      '.gitignore',
      'README.md',
      'erro.log',
      'src/.oculto',
      'src/app.ts',
      'src/novo.ts',
    ]);
  });

  it('cuts the list at the limit and says so', async () => {
    const index = await buildFileIndex(root, { showHidden: false, maxFiles: 2 });
    expect(index.files).toHaveLength(2);
    expect(index.truncated).toBe(true);
  });

  it('lists a repository nested in it with the path from the root', async () => {
    write('libs/inner/a.ts');
    git(path.join(root, 'libs/inner'), 'init', '-q');
    const index = await buildFileIndex(root, { showHidden: false });
    expect(index.files).toContain('libs/inner/a.ts');
  });
});

describe('buildFileIndex outside git', () => {
  beforeEach(() => {
    write('b.txt');
    write('.segredo');
    write('docs/guia.md');
    write('docs/.rascunho');
    write('.git/config'); // not a repository, but never listed
  });

  it('walks the folder and leaves dotfiles out unless asked', async () => {
    const visible = await buildFileIndex(root, { showHidden: false });
    expect(sorted(visible.files)).toEqual(['b.txt', 'docs/guia.md']);
    const all = await buildFileIndex(root, { showHidden: true });
    expect(sorted(all.files)).toEqual(['.segredo', 'b.txt', 'docs/.rascunho', 'docs/guia.md']);
  });

  it('goes breadth first, so the limit keeps the shallow files', async () => {
    write('a/b/c/d/profundo.txt');
    const index = await buildFileIndex(root, { showHidden: false, maxFiles: 2 });
    expect(index.files).toEqual(['b.txt', 'docs/guia.md']);
    expect(index.truncated).toBe(true);
  });

  it('gives each repository of the folder its own list, with its prefix', async () => {
    write('api/main.go');
    write('web/apps/site/index.ts');
    git(path.join(root, 'api'), 'init', '-q');
    git(path.join(root, 'web/apps/site'), 'init', '-q');
    const index = await buildFileIndex(root, { showHidden: false });
    expect(sorted(index.files)).toEqual([
      'api/main.go',
      'b.txt',
      'docs/guia.md',
      'web/apps/site/index.ts',
    ]);
  });
});

describe('ChangesService.index', () => {
  it('answers the files and what changed, with the same paths as the panel', async () => {
    write('a.ts');
    write('c.ts');
    git(root, 'init', '-q');
    git(root, 'add', '.');
    git(root, 'commit', '-qm', 'um', '--no-gpg-sign');
    write('a.ts', 'mudou\n');
    write('b.ts');
    fs.rmSync(path.join(root, 'c.ts'));
    const service = new ChangesService({ workDirectory: work, onChange: () => {} });
    try {
      const result = await service.index('s1', root, false);
      // c.ts is still in git's list, but it is not in the folder.
      expect(sorted(result.files)).toEqual(['a.ts', 'b.ts']);
      expect(result.changed.map((c) => [c.path, c.kind]).sort()).toEqual([
        ['a.ts', 'modified'],
        ['b.ts', 'untracked'],
        ['c.ts', 'removed'],
      ]);
    } finally {
      service.dispose();
    }
  });
});

describe('FileIndexCache', () => {
  it('reuses an answer for a while, then builds again', async () => {
    vi.useFakeTimers();
    try {
      const cache = new FileIndexCache(1000, 60_000);
      const build = vi.fn(async () => ({ files: ['a'], truncated: false }));
      await cache.get('s', build);
      await cache.get('s', build);
      expect(build).toHaveBeenCalledTimes(1);
      vi.advanceTimersByTime(1500);
      await cache.get('s', build);
      expect(build).toHaveBeenCalledTimes(2);
    } finally {
      vi.useRealTimers();
    }
  });

  it('drops the list a minute after the last request, and when a session closes', async () => {
    vi.useFakeTimers();
    try {
      const cache = new FileIndexCache(1000, 60_000);
      const build = async () => ({ files: ['a'], truncated: false });
      await cache.get('s1|false', build);
      await cache.get('s2|false', build);
      expect(cache.size()).toBe(2);
      cache.dropPrefix('s1|');
      expect(cache.size()).toBe(1);
      vi.advanceTimersByTime(60_001);
      expect(cache.size()).toBe(0);
    } finally {
      vi.useRealTimers();
    }
  });
});
