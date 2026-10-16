import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { ChangesService } from '@core/git/ChangesService';
import { statusChanges } from '@core/git/GitService';
import {
  cleanDiscarded,
  commit,
  discard,
  repoPath,
  stage,
  stagedFiles,
  undoDiscard,
  unstage,
} from '@core/git/GitWriteService';
import { UserError } from '@shared/i18n';
import { removeDir, tempDir } from './helpers';

let root: string;
let trash: string;

const git = (...args: string[]) =>
  execFileSync('git', args, { cwd: root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
const write = (file: string, content: string | Buffer) => {
  const absolute = path.join(root, file);
  fs.mkdirSync(path.dirname(absolute), { recursive: true });
  fs.writeFileSync(absolute, content);
};
const read = (file: string) => fs.readFileSync(path.join(root, file), 'utf8');
const exists = (file: string) => fs.existsSync(path.join(root, file));
const staged = async () =>
  Object.fromEntries((await statusChanges(root)).map((c) => [c.path, c.staged ?? 'none']));

beforeEach(() => {
  root = tempDir('ac-gitw-ção ');
  trash = tempDir('ac-descartados-');
  git('init', '-q', '-b', 'main');
  git('config', 'user.email', 'teste@example.com');
  git('config', 'user.name', 'Teste');
  git('config', 'commit.gpgsign', 'false');
  git('config', 'core.autocrlf', 'false');
  write('modificado.ts', 'const a = 1;\n');
  write('removido.txt', 'adeus\n');
  write('velho nome.txt', 'linha 1\nlinha 2\nlinha 3\nlinha 4\n');
  write('ação/módulo.ts', 'export const x = 1;\n');
  git('add', '-A');
  git('commit', '-q', '-m', 'base');
});
afterEach(() => {
  removeDir(root);
  removeDir(trash);
});

describe('stage and unstage', () => {
  it('stages and unstages new, modified, removed and renamed files, names with spaces and accents', async () => {
    write('modificado.ts', 'const a = 2;\n');
    fs.rmSync(path.join(root, 'removido.txt'));
    write('novo arquivo.ts', 'novo\n');
    write('ação/módulo.ts', 'export const x = 2;\n');
    fs.renameSync(path.join(root, 'velho nome.txt'), path.join(root, 'nome novo.txt'));

    await stage(root, [
      'modificado.ts',
      'removido.txt',
      'novo arquivo.ts',
      'ação/módulo.ts',
      'nome novo.txt',
      'velho nome.txt',
    ]);
    const status = await statusChanges(root);
    expect(status.every((c) => c.staged === 'all')).toBe(true);
    expect(status.find((c) => c.path === 'nome novo.txt')).toMatchObject({
      kind: 'renamed',
      origPath: 'velho nome.txt',
    });
    // The rename counts once, under its new name.
    expect(await stagedFiles(root)).toHaveLength(5);

    await unstage(root, ['modificado.ts', 'novo arquivo.ts', 'ação/módulo.ts']);
    expect(await staged()).toMatchObject({
      'modificado.ts': 'none',
      'novo arquivo.ts': 'none',
      'ação/módulo.ts': 'none',
      'removido.txt': 'all',
    });
    // Unstaging never touches the file.
    expect(read('modificado.ts')).toBe('const a = 2;\n');
  });

  it('tells a change staged in part from one staged whole', async () => {
    write('modificado.ts', 'const a = 2;\n');
    await stage(root, ['modificado.ts']);
    write('modificado.ts', 'const a = 3;\n');
    expect(await staged()).toEqual({ 'modificado.ts': 'partial' });
  });

  it('refuses a path outside the repository, and anything in .git', async () => {
    expect(() => repoPath(root, '../fora.txt')).toThrow(UserError);
    expect(() => repoPath(root, '.git/config')).toThrow(/internos do git/);
    expect(() => repoPath(root, 'sub/.GIT/x')).toThrow(UserError);
    await expect(stage(root, ['../fora.txt'])).rejects.toThrow(UserError);
    expect(repoPath(root, 'ação\\módulo.ts'.replaceAll('\\', path.sep))).toBe('ação/módulo.ts');
  });

  it('says the index is locked, and leaves the lock alone', async () => {
    write('modificado.ts', 'const a = 2;\n');
    fs.writeFileSync(path.join(root, '.git', 'index.lock'), '');
    await expect(stage(root, ['modificado.ts'])).rejects.toThrow(/index\.lock/);
    expect(fs.existsSync(path.join(root, '.git', 'index.lock'))).toBe(true);
  });
});

describe('commit', () => {
  it('commits only what is staged, with the message through stdin', async () => {
    write('modificado.ts', 'const a = 2;\n');
    write('fica de fora.ts', 'x\n');
    await stage(root, ['modificado.ts']);
    const result = await commit(root, 'Mudança "com aspas"\n\nE um corpo; `crases` e $(nada)\n');
    expect(result.commit).toMatch(/^[0-9a-f]{40}$/);
    expect(git('log', '-1', '--format=%B').trim()).toBe(
      'Mudança "com aspas"\n\nE um corpo; `crases` e $(nada)',
    );
    expect(git('show', '--name-only', '--format=', 'HEAD').trim()).toBe('modificado.ts');
    expect(await staged()).toEqual({ 'fica de fora.ts': 'none' });
  });

  it('refuses an empty message, and nothing staged', async () => {
    await expect(commit(root, '  \n')).rejects.toThrow(/mensagem/);
    await expect(commit(root, 'nada')).rejects.toThrow(/Nada marcado/);
  });

  it('runs the hook of the repository; when it fails, its output is the error', async () => {
    const hook = path.join(root, '.git', 'hooks', 'pre-commit');
    fs.writeFileSync(hook, '#!/bin/sh\necho "lint falhou em modificado.ts" >&2\nexit 1\n');
    fs.chmodSync(hook, 0o755);
    write('modificado.ts', 'const a = 2;\n');
    await stage(root, ['modificado.ts']);
    await expect(commit(root, 'tentativa')).rejects.toThrow(/lint falhou em modificado\.ts/);
    expect(git('log', '--format=%s').trim()).toBe('base');
    // Nothing staged was lost.
    expect(await staged()).toEqual({ 'modificado.ts': 'all' });
  });

  it('gives up a hook that takes too long', async () => {
    const hook = path.join(root, '.git', 'hooks', 'pre-commit');
    fs.writeFileSync(hook, '#!/bin/sh\nsleep 30\n');
    fs.chmodSync(hook, 0o755);
    write('modificado.ts', 'const a = 2;\n');
    await stage(root, ['modificado.ts']);
    await expect(commit(root, 'lento', 1500)).rejects.toThrow(/limite de tempo/);
  });
});

describe('discard and undo', () => {
  it('a modified file goes back to the commit, and undo gives the edit back', async () => {
    write('modificado.ts', 'const a = 2;\n');
    await stage(root, ['modificado.ts']);
    write('modificado.ts', 'const a = 3;\n');
    const record = await discard(root, 'modificado.ts', trash);
    expect(read('modificado.ts')).toBe('const a = 1;\n');
    expect(await statusChanges(root)).toEqual([]);
    // The copy is under the day it was made.
    const day = new Date(record.at).toISOString().slice(0, 10);
    expect(fs.existsSync(path.join(trash, day, record.id, 'content'))).toBe(true);

    await undoDiscard(trash, record.id);
    expect(read('modificado.ts')).toBe('const a = 3;\n');
    await expect(undoDiscard(trash, record.id)).rejects.toThrow(/não existe mais/);
  });

  it('an untracked file goes away, and comes back', async () => {
    write('rascunho.md', '# ideia\n');
    const record = await discard(root, 'rascunho.md', trash);
    expect(exists('rascunho.md')).toBe(false);
    await undoDiscard(trash, record.id);
    expect(read('rascunho.md')).toBe('# ideia\n');
  });

  it('a binary file comes back byte for byte', async () => {
    const bytes = Buffer.from([0, 1, 2, 255, 0, 10, 13, 0]);
    write('imagem.bin', bytes);
    const record = await discard(root, 'imagem.bin', trash);
    expect(exists('imagem.bin')).toBe(false);
    await undoDiscard(trash, record.id);
    expect(fs.readFileSync(path.join(root, 'imagem.bin')).equals(bytes)).toBe(true);
  });

  it('a removed file is brought back, and undo removes it again', async () => {
    fs.rmSync(path.join(root, 'removido.txt'));
    const record = await discard(root, 'removido.txt', trash);
    expect(read('removido.txt')).toBe('adeus\n');
    await undoDiscard(trash, record.id);
    expect(exists('removido.txt')).toBe(false);
  });

  it('a rename goes back to the old name', async () => {
    fs.renameSync(path.join(root, 'velho nome.txt'), path.join(root, 'nome novo.txt'));
    await stage(root, ['velho nome.txt', 'nome novo.txt']);
    await discard(root, 'nome novo.txt', trash, 'velho nome.txt');
    expect(exists('nome novo.txt')).toBe(false);
    expect(read('velho nome.txt')).toContain('linha 1');
    expect(await statusChanges(root)).toEqual([]);
  });

  it('undo is refused when the file changed after the discard', async () => {
    write('modificado.ts', 'const a = 2;\n');
    const record = await discard(root, 'modificado.ts', trash);
    write('modificado.ts', 'o agente escreveu\n');
    await expect(undoDiscard(trash, record.id)).rejects.toThrow(/mudou depois de descartado/);
    expect(read('modificado.ts')).toBe('o agente escreveu\n');
  });

  it('copies older than a month go away', async () => {
    const old = path.join(trash, '2026-01-01', 'x');
    const recent = path.join(trash, '2026-10-10', 'y');
    for (const dir of [old, recent]) fs.mkdirSync(dir, { recursive: true });
    await cleanDiscarded(trash, 30, Date.parse('2026-10-16T12:00:00Z'));
    expect(fs.existsSync(old)).toBe(false);
    expect(fs.existsSync(recent)).toBe(true);
  });
});

describe('through the panel', () => {
  it('works on the paths of the panel, in the repository each one is in', async () => {
    // A plain folder holding two repositories, as a session may have.
    const top = tempDir('ac-gitw-top-');
    const work = tempDir();
    try {
      for (const name of ['api', 'web']) {
        const repo = path.join(top, name);
        fs.mkdirSync(repo);
        const g = (...args: string[]) => execFileSync('git', args, { cwd: repo, stdio: 'ignore' });
        g('init', '-q', '-b', 'main');
        g('config', 'user.email', 't@example.com');
        g('config', 'user.name', 'T');
        g('config', 'commit.gpgsign', 'false');
        g('config', 'core.autocrlf', 'false');
        fs.writeFileSync(path.join(repo, 'a.txt'), '1\n');
        g('add', '-A');
        g('commit', '-q', '-m', 'base');
        fs.writeFileSync(path.join(repo, 'a.txt'), '2\n');
      }
      const service = new ChangesService({ workDirectory: work, onChange: () => {} });
      try {
        await expect(service.stage('s', ['api/a.txt'])).rejects.toThrow(/não está aberto/);
        await service.overview('s', top, 'head');
        await service.stage('s', ['api/a.txt', 'web/a.txt']);
        let overview = await service.overview('s', top, 'head');
        expect(overview.ok && overview.changes.map((c) => `${c.path} ${c.staged}`)).toEqual([
          'api/a.txt all',
          'web/a.txt all',
        ]);
        const { commit: made } = await service.commit('s', 'web', 'só o web');
        expect(made).toMatch(/^[0-9a-f]{40}$/);
        overview = await service.overview('s', top, 'head');
        expect(overview.ok && overview.changes.map((c) => c.path)).toEqual(['api/a.txt']);
        await expect(service.commit('s', 'nao-existe', 'x')).rejects.toThrow(UserError);

        const record = await service.discard('s', 'api/a.txt', trash);
        expect(fs.readFileSync(path.join(top, 'api', 'a.txt'), 'utf8')).toBe('1\n');
        await service.undoDiscard('s', record.id, trash);
        expect(fs.readFileSync(path.join(top, 'api', 'a.txt'), 'utf8')).toBe('2\n');
      } finally {
        service.dispose();
      }
    } finally {
      removeDir(top);
      removeDir(work);
    }
  });
});
