// A session whose folder holds more than one repository: side by side in a plain folder, or
// one inside another.
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { ChangesService } from '@core/git/ChangesService';
import { saveWorkingTreeFile } from '@core/git/GitService';
import { findRepositories } from '@core/git/Workspace';
import type { GitOverview } from '@shared/git';
import { removeDir, tempDir } from './helpers';

let folder: string;
let work: string;
let service: ChangesService;

const write = (file: string, content: string) => {
  fs.mkdirSync(path.dirname(path.join(folder, file)), { recursive: true });
  fs.writeFileSync(path.join(folder, file), content);
};
const git = (dir: string, ...args: string[]) =>
  execFileSync('git', args, { cwd: path.join(folder, dir), stdio: ['ignore', 'pipe', 'pipe'] })
    .toString()
    .trim();

/** A repository at `dir`, with one committed file. */
function repository(dir: string, branch = 'main'): void {
  fs.mkdirSync(path.join(folder, dir), { recursive: true });
  git(dir, 'init', '-q', '-b', branch);
  git(dir, 'config', 'user.email', 'teste@example.com');
  git(dir, 'config', 'user.name', 'Teste');
  git(dir, 'config', 'commit.gpgsign', 'false');
  git(dir, 'config', 'core.autocrlf', 'false');
  write(`${dir}/index.ts`, 'export const versao = 1;\n');
  git(dir, 'add', '-A');
  git(dir, 'commit', '-q', '-m', 'base');
}

const ok = (overview: GitOverview) => {
  if (!overview.ok) throw new Error(`sem git: ${overview.reason}`);
  return overview;
};
const summary = (overview: GitOverview) =>
  ok(overview).changes.map((c) => `${c.kind} ${c.path}${c.repo ? ` [${c.repo}]` : ''}`);
const repos = (overview: GitOverview) =>
  ok(overview).repos.map((r) => `${r.path || '.'} ${r.branch} ${r.count}`);

beforeEach(() => {
  folder = tempDir();
  work = tempDir();
  service = new ChangesService({ workDirectory: work, onChange: () => {} });
});
afterEach(() => {
  service.dispose();
  removeDir(folder);
  removeDir(work);
});

describe('findRepositories', () => {
  it('finds repositories up to two levels down, and does not look inside them', async () => {
    repository('api');
    repository('apps/web');
    repository('apps/web/vendor-interno');
    repository('fundo/demais/para/achar');
    repository('node_modules/pacote');
    repository('.oculto');
    write('solto.txt', 'x\n');
    expect(await findRepositories(folder)).toEqual(['api', 'apps/web']);
    expect(await findRepositories(path.join(folder, 'vazio'))).toEqual([]);
  });
});

describe('a plain folder with repositories side by side', () => {
  beforeEach(() => {
    repository('api');
    repository('web', 'develop');
    repository('docs');
  });

  it('lists the changes of every repository, each file under its own', async () => {
    write('api/index.ts', 'export const versao = 2;\n');
    write('api/src/novo.ts', 'export {};\n');
    write('web/index.ts', 'export const versao = 3;\n');
    write('solto.txt', 'fora de qualquer repositório\n');

    const overview = await service.overview('s', folder, 'head');
    expect(ok(overview).root).toBe(folder);
    expect(summary(overview)).toEqual([
      'modified api/index.ts [api]',
      'untracked api/src/novo.ts [api]',
      'modified web/index.ts [web]',
    ]);
    expect(repos(overview)).toEqual(['api main 2', 'docs main 0', 'web develop 1']);
    expect(await service.count('s', folder)).toBe(3);
  });

  it('shows both sides of a file from the repository it is in', async () => {
    write('web/index.ts', 'export const versao = 3;\n');
    await service.overview('s', folder, 'head');

    const diff = await service.diff('s', 'web/index.ts', 'head');
    expect(diff.path).toBe('web/index.ts');
    expect(diff.original).toEqual({ kind: 'text', text: 'export const versao = 1;\n' });
    expect(diff.modified).toEqual({ kind: 'text', text: 'export const versao = 3;\n' });

    // An unchanged file of another repository, and a file of no repository.
    const same = await service.diff('s', 'docs/index.ts', 'head');
    expect(same.original).toEqual(same.modified);
    write('solto.txt', 'sem git\n');
    const loose = await service.diff('s', 'solto.txt', 'head');
    expect(loose.original).toEqual({ kind: 'missing' });
    expect(loose.modified).toEqual({ kind: 'text', text: 'sem git\n' });
  });

  it('saves into the right repository, and never into the internals of any', async () => {
    await service.overview('s', folder, 'head');
    expect(await service.save('s', 'api/index.ts', 'export const versao = 5;\n', null)).toEqual({
      saved: true,
    });
    expect(git('api', 'status', '--porcelain')).toBe('M index.ts');
    expect(git('web', 'status', '--porcelain')).toBe('');
    await expect(service.save('s', 'api/.git/config', 'x', null)).rejects.toThrow(/internos/);
    await expect(saveWorkingTreeFile(folder, 'web/.GIT/HEAD', 'x', null)).rejects.toThrow(
      /internos/,
    );
  });

  it('compares each repository with its own state at the start of the session', async () => {
    write('api/index.ts', 'sujo antes da sessão\n');
    await service.sessionStarted('s', folder);
    write('api/depois.ts', 'do agente\n');
    write('web/index.ts', 'do agente\n');

    const session = await service.overview('s', folder, 'session');
    expect(ok(session)).toMatchObject({ base: 'session', hasSessionBase: true });
    expect(summary(session)).toEqual(['added api/depois.ts [api]', 'modified web/index.ts [web]']);
    const head = await service.overview('s', folder, 'head');
    expect(summary(head)).toContain('modified api/index.ts [api]');

    // The "before" of the session base is what the file was when the session started.
    await service.overview('s', folder, 'session');
    write('api/index.ts', 'mexido pelo agente\n');
    const diff = await service.diff('s', 'api/index.ts', 'session');
    expect(diff.original).toEqual({ kind: 'text', text: 'sujo antes da sessão\n' });
  });

  it('does not change any of the repositories', async () => {
    write('api/index.ts', 'x\n');
    const state = () =>
      ['api', 'web', 'docs'].map((dir) => [
        git(dir, 'status', '--porcelain'),
        git(dir, 'stash', 'list'),
        git(dir, 'for-each-ref'),
        fs.readFileSync(path.join(folder, dir, '.git', 'index')).toString('base64'),
      ]);
    const before = state();
    await service.sessionStarted('s', folder);
    await service.overview('s', folder, 'session');
    await service.overview('s', folder, 'head');
    expect(state()).toEqual(before);
  });

  it('marks ignored files of each repository as hidden in the tree of all files', async () => {
    write('api/.gitignore', 'build/\n');
    write('api/build/saida.js', 'x\n');
    expect((await service.list('s', folder, '', false)).entries.map((e) => e.name)).toEqual([
      'api',
      'docs',
      'web',
    ]);
    expect((await service.list('s', folder, 'api', false)).entries.map((e) => e.path)).toEqual([
      'api/index.ts',
    ]);
    const all = await service.list('s', folder, 'api', true);
    expect(all.entries.filter((e) => e.hidden).map((e) => e.path)).toEqual([
      'api/.git',
      'api/build',
      'api/.gitignore',
    ]);
  });

  it('a folder without any repository is still not one', async () => {
    const empty = path.join(folder, 'docs', 'sub');
    fs.mkdirSync(empty);
    // Inside a repository: that repository, as always.
    expect(repos(await service.overview('a', empty, 'head'))).toEqual(['. null 0']);
    const plain = tempDir();
    try {
      expect(await service.overview('b', plain, 'head')).toMatchObject({
        ok: false,
        reason: 'not-a-repo',
      });
    } finally {
      removeDir(plain);
    }
  });
});

describe('a repository with another one inside', () => {
  beforeEach(() => {
    repository('.');
    repository('libs/interno');
  });

  it('lists the changes of both, instead of one untracked folder', async () => {
    write('index.ts', 'export const versao = 2;\n');
    write('libs/interno/index.ts', 'export const versao = 9;\n');
    write('libs/interno/novo.ts', 'export {};\n');

    const overview = await service.overview('s', folder, 'head');
    expect(summary(overview)).toEqual([
      'modified index.ts',
      'modified libs/interno/index.ts [libs/interno]',
      'untracked libs/interno/novo.ts [libs/interno]',
    ]);
    expect(repos(overview)).toEqual(['. main 1', 'libs/interno main 2']);
    expect(await service.count('s', folder)).toBe(3);

    const diff = await service.diff('s', 'libs/interno/index.ts', 'head');
    expect(diff.original).toEqual({ kind: 'text', text: 'export const versao = 1;\n' });
    expect(diff.modified).toEqual({ kind: 'text', text: 'export const versao = 9;\n' });
  });

  it('compares with the start of the session in both', async () => {
    await service.sessionStarted('s', folder);
    write('index.ts', 'fora\n');
    write('libs/interno/index.ts', 'dentro\n');
    expect(summary(await service.overview('s', folder, 'session'))).toEqual([
      'modified index.ts',
      'modified libs/interno/index.ts [libs/interno]',
    ]);
  });
});

describe('a single repository', () => {
  it('is reported exactly as before: no repository marks, paths from its root', async () => {
    repository('.');
    write('index.ts', 'export const versao = 2;\n');
    write('src/novo.ts', 'export {};\n');
    const overview = ok(await service.overview('s', folder, 'head'));
    expect(overview.changes).toEqual([
      { path: 'index.ts', kind: 'modified' },
      { path: 'src/novo.ts', kind: 'untracked' },
    ]);
    expect(overview.repos).toEqual([
      { path: '', name: path.basename(folder), branch: null, count: 2 },
    ]);
    expect(await service.count('s', folder)).toBe(2);
  });
});
