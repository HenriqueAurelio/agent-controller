import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { ChangesService } from '@core/git/ChangesService';
import { listDirectory } from '@core/git/FileBrowser';
import { removeDir, tempDir } from './helpers';

let root: string;
let work: string;

const write = (file: string, content = 'x\n') => {
  fs.mkdirSync(path.dirname(path.join(root, file)), { recursive: true });
  fs.writeFileSync(path.join(root, file), content);
};
const git = (...args: string[]) =>
  execFileSync('git', args, { cwd: root, stdio: ['ignore', 'pipe', 'pipe'] });
const names = (listing: { entries: { name: string }[] }) => listing.entries.map((e) => e.name);

beforeEach(() => {
  root = tempDir();
  work = tempDir();
  write('README.md');
  write('.env', 'SEGREDO=1\n');
  write('.gitignore', 'build/\n*.log\n');
  write('src/app.ts');
  write('src/.oculto');
  write('build/saida.js');
  write('erro.log');
});
afterEach(() => {
  removeDir(root);
  removeDir(work);
});

describe('listDirectory', () => {
  it('lists folders first and leaves dotfiles out unless asked', async () => {
    const visible = await listDirectory(root, '', { showHidden: false, git: false });
    expect(names(visible)).toEqual(['build', 'src', 'erro.log', 'README.md']);
    expect(visible.entries.every((e) => !e.hidden)).toBe(true);

    const all = await listDirectory(root, '', { showHidden: true, git: false });
    expect(names(all)).toEqual(['build', 'src', '.env', '.gitignore', 'erro.log', 'README.md']);
    expect(all.entries.filter((e) => e.hidden).map((e) => e.name)).toEqual(['.env', '.gitignore']);
    expect(all.entries.find((e) => e.name === 'src')).toMatchObject({ kind: 'dir', path: 'src' });
  });

  it('lists a subfolder with paths relative to the root', async () => {
    const listing = await listDirectory(root, 'src', { showHidden: true, git: false });
    expect(listing.entries.map((e) => e.path)).toEqual(['src/.oculto', 'src/app.ts']);
  });

  it('treats what .gitignore covers as hidden, in a repository', async () => {
    git('init', '-q');
    const visible = await listDirectory(root, '', { showHidden: false, git: true });
    expect(names(visible)).toEqual(['src', 'README.md']);

    const all = await listDirectory(root, '', { showHidden: true, git: true });
    expect(names(all)).toEqual([
      '.git',
      'build',
      'src',
      '.env',
      '.gitignore',
      'erro.log',
      'README.md',
    ]);
    const hidden = all.entries.filter((e) => e.hidden).map((e) => e.name);
    expect(hidden).toEqual(['.git', 'build', '.env', '.gitignore', 'erro.log']);

    // Inside an ignored folder, and inside git's own.
    const build = await listDirectory(root, 'build', { showHidden: true, git: true });
    expect(build.entries).toEqual([
      { name: 'saida.js', path: 'build/saida.js', kind: 'file', hidden: true },
    ]);
    expect(names(await listDirectory(root, '.git', { showHidden: true, git: true }))).toContain(
      'HEAD',
    );
  });

  it('never leaves the root', async () => {
    const options = { showHidden: true, git: false };
    await expect(listDirectory(root, '..', options)).rejects.toThrow(/fora da sessão/);
    await expect(listDirectory(root, '../outra', options)).rejects.toThrow(/fora da sessão/);
    await expect(listDirectory(root, path.dirname(root), options)).rejects.toThrow(
      /fora da sessão/,
    );
  });

  it('lists a link to a folder as a file, and does not follow one in the path', async () => {
    const outside = tempDir();
    try {
      fs.writeFileSync(path.join(outside, 'segredo.txt'), 'x');
      try {
        fs.symlinkSync(outside, path.join(root, 'atalho'), 'junction');
      } catch {
        return; // No permission to create links here.
      }
      const listing = await listDirectory(root, '', { showHidden: false, git: false });
      expect(listing.entries.find((e) => e.name === 'atalho')).toMatchObject({ kind: 'file' });
      await expect(listDirectory(root, 'atalho', { showHidden: true, git: false })).rejects.toThrow(
        /fora da sessão/,
      );
    } finally {
      fs.rmSync(path.join(root, 'atalho'), { force: true, recursive: false });
      removeDir(outside);
    }
  });

  it('cuts a huge folder short and says so', async () => {
    for (let i = 0; i < 12; i++) write(`muitos/arquivo-${String(i).padStart(2, '0')}.txt`);
    const listing = await listDirectory(root, 'muitos', {
      showHidden: true,
      git: false,
      maxEntries: 5,
    });
    expect(listing.truncated).toBe(true);
    expect(names(listing)).toHaveLength(5);
    expect(names(listing)[0]).toBe('arquivo-00.txt');
  });
});

describe('ChangesService: all files', () => {
  let service: ChangesService;
  beforeEach(() => {
    service = new ChangesService({ workDirectory: work, onChange: () => {} });
  });
  afterEach(() => service.dispose());

  it('lists, opens and saves files of a folder without git', async () => {
    expect(names(await service.list('s', root, '', false))).toEqual([
      'build',
      'src',
      'erro.log',
      'README.md',
    ]);
    expect(names(await service.list('s', root, '', true))).toContain('.env');

    const diff = await service.diff('s', '.env', 'head');
    expect(diff.original).toEqual({ kind: 'missing' });
    expect(diff.modified).toEqual({ kind: 'text', text: 'SEGREDO=1\n' });

    expect(await service.save('s', '.env', 'SEGREDO=2\n', 'SEGREDO=1\n')).toEqual({ saved: true });
    expect(fs.readFileSync(path.join(root, '.env'), 'utf8')).toBe('SEGREDO=2\n');
    await expect(service.save('s', '../fora.txt', 'x', null)).rejects.toThrow(/fora/);
  });

  it('lists from the root of the repository, and shows unchanged and ignored files', async () => {
    git('init', '-q');
    git('add', '-A');
    git('-c', 'user.email=t@example.com', '-c', 'user.name=T', 'commit', '-q', '-m', 'base');

    // The session runs in a subfolder; the tree starts at the root, like the list of changes.
    const cwd = path.join(root, 'src');
    expect(names(await service.list('s', cwd, '', false))).toEqual(['src', 'README.md']);
    expect(names(await service.list('s', cwd, '', true))).toContain('build');

    const unchanged = await service.diff('s', 'README.md', 'head');
    expect(unchanged.original).toEqual(unchanged.modified);
    const ignored = await service.diff('s', 'build/saida.js', 'head');
    expect(ignored.original).toEqual({ kind: 'missing' });
    expect(ignored.modified).toEqual({ kind: 'text', text: 'x\n' });
  });
});
