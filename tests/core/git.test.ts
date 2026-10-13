import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { ChangesService } from '@core/git/ChangesService';
import {
  fileDiff,
  gitVersion,
  MAX_TEXT_BYTES,
  parseNameStatus,
  parseStatus,
  repositoryRoot,
  snapshotTree,
  statusChanges,
  treeChanges,
} from '@core/git/GitService';
import { RepoWatcher } from '@core/git/RepoWatcher';
import type { FileChange } from '@shared/git';
import { removeDir, sleep, tempDir, waitFor } from './helpers';

let root: string;
let work: string;

const git = (...args: string[]) =>
  execFileSync('git', args, { cwd: root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
const write = (file: string, content: string | Buffer) => {
  const absolute = path.join(root, file);
  fs.mkdirSync(path.dirname(absolute), { recursive: true });
  fs.writeFileSync(absolute, content);
};
const summary = (changes: FileChange[]) =>
  changes.map((c) => `${c.kind} ${c.origPath ? `${c.origPath} -> ` : ''}${c.path}`);

beforeEach(() => {
  root = tempDir('agent-controller-repo-');
  work = tempDir('agent-controller-work-');
  git('init', '-q', '-b', 'main');
  git('config', 'user.email', 'teste@example.com');
  git('config', 'user.name', 'Teste');
  git('config', 'commit.gpgsign', 'false');
  git('config', 'core.autocrlf', 'false');
});
afterEach(() => {
  removeDir(root);
  removeDir(work);
});

const commitBase = () => {
  write('mantido.txt', 'igual\n');
  write('editado.ts', 'const a = 1;\n');
  write('removido.txt', 'adeus\n');
  write('velho nome.txt', 'conteúdo que será renomeado\nlinha 2\nlinha 3\n');
  write('src/ação/módulo.ts', 'export const x = 1;\n');
  git('add', '-A');
  git('commit', '-q', '-m', 'base');
};

describe('GitService', () => {
  it('detects git and its version', async () => {
    expect(await gitVersion()).toMatch(/^\d+\.\d+\.\d+$/);
  });

  it('tells a repository from a plain folder', async () => {
    expect(await repositoryRoot(root)).toBe(root);
    fs.mkdirSync(path.join(root, 'sub', 'pasta'), { recursive: true });
    expect(await repositoryRoot(path.join(root, 'sub', 'pasta'))).toBe(root);
    const plain = tempDir();
    try {
      expect(await repositoryRoot(plain)).toBeNull();
      expect(await repositoryRoot(path.join(plain, 'nao-existe'))).toBeNull();
    } finally {
      removeDir(plain);
    }
  });

  it('lists every kind of change', async () => {
    commitBase();
    write('editado.ts', 'const a = 2;\n');
    fs.rmSync(path.join(root, 'removido.txt'));
    git('mv', 'velho nome.txt', 'novo nome.txt');
    write('adicionado.txt', 'novo e no índice\n');
    git('add', 'adicionado.txt');
    write('não rastreado.txt', 'novo\n');
    write('src/ação/módulo.ts', 'export const x = 2;\n');
    write('pasta nova/dentro/arquivo.txt', 'fundo\n');

    expect(summary(await statusChanges(root))).toEqual([
      'added adicionado.txt',
      'modified editado.ts',
      'untracked não rastreado.txt',
      'renamed velho nome.txt -> novo nome.txt',
      'untracked pasta nova/dentro/arquivo.txt',
      'removed removido.txt',
      'modified src/ação/módulo.ts',
    ]);
  });

  it('agrees with git status', async () => {
    commitBase();
    write('editado.ts', 'x\n');
    write('novo.txt', 'y\n');
    fs.rmSync(path.join(root, 'removido.txt'));
    const expected = git(
      '-c',
      'core.quotepath=off',
      'status',
      '--porcelain',
      '--untracked-files=all',
    )
      .split('\n')
      .filter(Boolean)
      .map((line) => line.slice(3))
      .sort();
    expect((await statusChanges(root)).map((c) => c.path).sort()).toEqual(expected);
  });

  it('reports nothing in a clean repository and works before the first commit', async () => {
    write('primeiro.txt', 'olá\n');
    expect(summary(await statusChanges(root))).toEqual(['untracked primeiro.txt']);
    const diff = await fileDiff(root, { path: 'primeiro.txt', kind: 'untracked' }, null);
    expect(diff).toEqual({
      path: 'primeiro.txt',
      original: { kind: 'missing' },
      modified: { kind: 'text', text: 'olá\n' },
    });
    git('add', '-A');
    git('commit', '-q', '-m', 'um');
    expect(await statusChanges(root)).toEqual([]);
  });

  it('gives both sides of each kind of change', async () => {
    commitBase();
    write('editado.ts', 'const a = 2;\n');
    fs.rmSync(path.join(root, 'removido.txt'));
    git('mv', 'velho nome.txt', 'novo nome.txt');
    write('novo.txt', 'novo\n');

    expect(await fileDiff(root, { path: 'editado.ts', kind: 'modified' }, 'HEAD')).toEqual({
      path: 'editado.ts',
      original: { kind: 'text', text: 'const a = 1;\n' },
      modified: { kind: 'text', text: 'const a = 2;\n' },
    });
    expect(await fileDiff(root, { path: 'removido.txt', kind: 'removed' }, 'HEAD')).toMatchObject({
      original: { kind: 'text', text: 'adeus\n' },
      modified: { kind: 'missing' },
    });
    expect(await fileDiff(root, { path: 'novo.txt', kind: 'untracked' }, 'HEAD')).toMatchObject({
      original: { kind: 'missing' },
      modified: { kind: 'text', text: 'novo\n' },
    });
    const renamed = await fileDiff(
      root,
      { path: 'novo nome.txt', origPath: 'velho nome.txt', kind: 'renamed' },
      'HEAD',
    );
    expect(renamed.original).toMatchObject({ kind: 'text' });
    expect(renamed.original).toEqual(renamed.modified);
  });

  it('the two sides reproduce what git diff shows', async () => {
    commitBase();
    write('editado.ts', 'const a = 2;\nconst b = 3;\n');
    const { original, modified } = await fileDiff(
      root,
      { path: 'editado.ts', kind: 'modified' },
      'HEAD',
    );
    const patch = git('diff', '--', 'editado.ts');
    const removed = patch
      .split('\n')
      .filter((l) => /^-[^-]/.test(l))
      .map((l) => l.slice(1));
    const added = patch
      .split('\n')
      .filter((l) => /^\+[^+]/.test(l))
      .map((l) => l.slice(1));
    expect(original.kind === 'text' && original.text.trimEnd().split('\n')).toEqual(removed);
    expect(modified.kind === 'text' && modified.text.trimEnd().split('\n')).toEqual(added);
  });

  it('flags binary and oversized files instead of returning them', async () => {
    write('imagem.png', Buffer.from([0x89, 0x50, 0x4e, 0x47, 0, 1, 2, 3, 0, 0]));
    write('enorme.txt', 'a'.repeat(MAX_TEXT_BYTES + 10));
    git('add', '-A');
    git('commit', '-q', '-m', 'binários');
    write('imagem.png', Buffer.from([0x89, 0x50, 0x4e, 0x47, 0, 9, 9, 9, 0, 0, 0]));
    write('enorme.txt', 'b'.repeat(MAX_TEXT_BYTES + 20));

    expect(await fileDiff(root, { path: 'imagem.png', kind: 'modified' }, 'HEAD')).toEqual({
      path: 'imagem.png',
      original: { kind: 'binary', size: 10 },
      modified: { kind: 'binary', size: 11 },
    });
    expect(await fileDiff(root, { path: 'enorme.txt', kind: 'modified' }, 'HEAD')).toEqual({
      path: 'enorme.txt',
      original: { kind: 'too-large', size: MAX_TEXT_BYTES + 10 },
      modified: { kind: 'too-large', size: MAX_TEXT_BYTES + 20 },
    });
  });

  it('refuses a path outside the repository', async () => {
    const diff = await fileDiff(root, { path: '../fora.txt', kind: 'modified' }, null);
    expect(diff.modified).toEqual({ kind: 'missing' });
  });

  it('reading never changes the repository', async () => {
    commitBase();
    write('editado.ts', 'mudou\n');
    const index = path.join(root, '.git', 'index');
    const status = git('status', '--porcelain');
    const before = { mtime: fs.statSync(index).mtimeMs, status };
    await sleep(20);
    await statusChanges(root);
    await fileDiff(root, { path: 'editado.ts', kind: 'modified' }, 'HEAD');
    expect(fs.statSync(index).mtimeMs).toBe(before.mtime);
    expect(git('status', '--porcelain')).toBe(before.status);
  });

  it('parses the porcelain v2 records', () => {
    const output = [
      '1 .M N... 100644 100644 100644 aaa bbb com espaço.txt',
      '1 D. N... 100644 000000 000000 aaa 000 apagado.txt',
      '1 A. N... 000000 100644 100644 000 bbb novo.txt',
      '2 R. N... 100644 100644 100644 aaa bbb R100 destino final.txt',
      'origem inicial.txt',
      'u UU N... 100644 100644 100644 100644 a b c conflito.txt',
      '? solto.txt',
      '! ignorado.log',
      '',
    ].join('\0');
    expect(summary(parseStatus(output))).toEqual([
      'removed apagado.txt',
      'modified com espaço.txt',
      'conflict conflito.txt',
      'renamed origem inicial.txt -> destino final.txt',
      'added novo.txt',
      'untracked solto.txt',
    ]);
  });

  it('parses diff-tree name-status records', () => {
    const output = [
      'M',
      'a.txt',
      'A',
      'b c.txt',
      'D',
      'd.txt',
      'R090',
      'velho.txt',
      'novo.txt',
      '',
    ].join('\0');
    expect(summary(parseNameStatus(output))).toEqual([
      'modified a.txt',
      'added b c.txt',
      'removed d.txt',
      'renamed velho.txt -> novo.txt',
    ]);
  });
});

describe('snapshot of the session start', () => {
  const state = () => ({
    status: git('status', '--porcelain', '--untracked-files=all'),
    stash: git('stash', 'list'),
    refs: git('for-each-ref'),
    index: fs.readFileSync(path.join(root, '.git', 'index')).toString('base64'),
    head: git('rev-parse', 'HEAD'),
  });

  it('does not touch the index, the working tree, the stash or the refs', async () => {
    commitBase();
    write('editado.ts', 'mexido antes da sessão\n');
    write('solto.txt', 'não rastreado\n');
    git('add', 'solto.txt');
    write('outro solto.txt', 'x\n');
    const before = state();
    const tree = await snapshotTree(root, path.join(work, 'base.index'));
    expect(tree).toMatch(/^[0-9a-f]{40,64}$/);
    expect(state()).toEqual(before);
    expect(fs.readdirSync(root).sort()).not.toContain('base.index');
  });

  it('shows only what changed after the session started', async () => {
    commitBase();
    write('editado.ts', 'sujo antes da sessão\n');
    write('ja-existia.txt', 'não rastreado antes\n');
    const base = await snapshotTree(root, path.join(work, 'base.index'));

    // What the agent does.
    write('src/ação/módulo.ts', 'export const x = 99;\n');
    write('criado-pelo-agente.txt', 'novo\n');
    fs.rmSync(path.join(root, 'removido.txt'));

    const current = await snapshotTree(root, path.join(work, 'current.index'));
    expect(summary(await treeChanges(root, base, current))).toEqual([
      'added criado-pelo-agente.txt',
      'removed removido.txt',
      'modified src/ação/módulo.ts',
    ]);
    // Against HEAD, the changes from before the session show up as well.
    expect((await statusChanges(root)).map((c) => c.path)).toContain('editado.ts');

    const diff = await fileDiff(root, { path: 'src/ação/módulo.ts', kind: 'modified' }, base);
    expect(diff.original).toEqual({ kind: 'text', text: 'export const x = 1;\n' });
    const dirty = await fileDiff(root, { path: 'editado.ts', kind: 'modified' }, base);
    expect(dirty.original).toEqual({ kind: 'text', text: 'sujo antes da sessão\n' });
  });

  it('respects .gitignore and works in a repository without commits', async () => {
    write('.gitignore', 'node_modules/\n');
    write('node_modules/pacote/index.js', 'x\n');
    write('a.txt', '1\n');
    const base = await snapshotTree(root, path.join(work, 'base.index'));
    write('a.txt', '2\n');
    write('node_modules/pacote/outro.js', 'y\n');
    const current = await snapshotTree(root, path.join(work, 'current.index'));
    expect(summary(await treeChanges(root, base, current))).toEqual(['modified a.txt']);
  });
});

describe('ChangesService', () => {
  let service: ChangesService;
  let notified: string[];
  beforeEach(() => {
    notified = [];
    service = new ChangesService({ workDirectory: work, onChange: (id) => notified.push(id) });
  });
  afterEach(() => service.dispose());

  it('explains why there is nothing to show in a folder without git', async () => {
    const plain = tempDir();
    try {
      expect(await service.overview('s', plain, 'head')).toMatchObject({
        ok: false,
        reason: 'not-a-repo',
      });
      expect(await service.count('s', plain)).toBeNull();
    } finally {
      removeDir(plain);
    }
  });

  it('compares with HEAD or with the session start', async () => {
    commitBase();
    write('editado.ts', 'antes da sessão\n');
    await service.sessionStarted('s', root);
    write('novo.txt', 'do agente\n');

    const head = await service.overview('s', root, 'head');
    expect(head).toMatchObject({ ok: true, base: 'head', hasSessionBase: true });
    expect(head.ok && summary(head.changes)).toEqual(['modified editado.ts', 'untracked novo.txt']);
    expect(await service.count('s', root)).toBe(2);

    const session = await service.overview('s', root, 'session');
    expect(session.ok && session.base).toBe('session');
    expect(session.ok && summary(session.changes)).toEqual(['added novo.txt']);
    expect(await service.diff('s', 'novo.txt', 'session')).toMatchObject({
      original: { kind: 'missing' },
      modified: { kind: 'text', text: 'do agente\n' },
    });
  });

  it('falls back to HEAD when the session has no snapshot', async () => {
    commitBase();
    write('editado.ts', 'x\n');
    const overview = await service.overview('s', root, 'session');
    expect(overview).toMatchObject({ ok: true, base: 'head', hasSessionBase: false });
  });

  it('closing the session removes its snapshot files', async () => {
    commitBase();
    await service.sessionStarted('s', root);
    await service.overview('s', root, 'session');
    expect(fs.existsSync(path.join(work, 's'))).toBe(true);
    await service.sessionClosed('s');
    expect(fs.existsSync(path.join(work, 's'))).toBe(false);
  });

  it('with the panel open, an edit is announced within 2 seconds', async () => {
    commitBase();
    await service.overview('s', root, 'head', { watch: true });
    await sleep(200);
    const started = Date.now();
    write('editado.ts', 'pelo agente\n');
    await waitFor(() => notified.length > 0, { timeout: 2000 });
    expect(Date.now() - started).toBeLessThan(2000);
    service.close('s');
    const count = notified.length;
    write('editado.ts', 'depois de fechar\n');
    await sleep(700);
    expect(notified.length).toBe(count);
  });
});

describe('RepoWatcher', () => {
  let changes: number;
  let watcher: RepoWatcher;
  beforeEach(async () => {
    write('.gitignore', 'node_modules/\n*.log\n');
    commitBase();
    changes = 0;
    watcher = new RepoWatcher({ root, onChange: () => changes++, debounceMs: 150 });
    watcher.start();
    await sleep(200);
  });
  afterEach(() => watcher.stop());

  it('turns a burst of writes into one refresh', async () => {
    for (let i = 0; i < 60; i++) write(`rajada/arquivo-${i}.txt`, String(i));
    await waitFor(() => changes > 0);
    await sleep(600);
    expect(changes).toBe(1);
  });

  it('ignores what .gitignore covers and git internals', async () => {
    write('node_modules/pacote/index.js', 'x');
    write('saida.log', 'x');
    write('.git/objeto-temporario', 'x');
    await sleep(800);
    expect(changes).toBe(0);
    write('editado.ts', 'agora sim\n');
    await waitFor(() => changes === 1);
  });

  it('notices a commit, which changes what "against HEAD" means', async () => {
    write('editado.ts', 'para commit\n');
    await waitFor(() => changes === 1);
    git('add', '-A');
    git('commit', '-q', '-m', 'dois');
    await waitFor(() => changes >= 2);
  });

  it('reading the status does not trigger the watcher again', async () => {
    write('editado.ts', 'x\n');
    await waitFor(() => changes === 1);
    await statusChanges(root);
    await statusChanges(root);
    await sleep(600);
    expect(changes).toBe(1);
  });
});
