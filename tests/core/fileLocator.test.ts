import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { locateFiles } from '../../src/core/git/FileLocator';

let base: string;
let root: string;
let outside: string;

beforeEach(() => {
  base = fs.realpathSync.native(fs.mkdtempSync(path.join(os.tmpdir(), 'ac-locate-')));
  root = path.join(base, 'projeto');
  outside = path.join(base, 'fora');
  fs.mkdirSync(path.join(root, 'src'), { recursive: true });
  fs.mkdirSync(outside);
  fs.writeFileSync(path.join(root, 'src', 'app.ts'), 'x');
  fs.writeFileSync(path.join(root, 'README.md'), 'x');
  fs.writeFileSync(path.join(outside, 'segredo.txt'), 'x');
});

afterEach(() => fs.rmSync(base, { recursive: true, force: true }));

describe('locateFiles', () => {
  it('resolves relative paths against the folder and names them with forward slashes', async () => {
    const answers = await locateFiles(root, [
      'src/app.ts',
      './src/app.ts',
      'README.md',
      'src/../src/app.ts',
    ]);
    expect(answers).toEqual([
      { path: 'src/app.ts', isFile: true },
      { path: 'src/app.ts', isFile: true },
      { path: 'README.md', isFile: true },
      { path: 'src/app.ts', isFile: true },
    ]);
  });

  it('accepts absolute paths inside the folder, and says when it is a folder', async () => {
    const answers = await locateFiles(root, [
      path.join(root, 'src', 'app.ts'),
      path.join(root, 'src'),
    ]);
    expect(answers).toEqual([
      { path: 'src/app.ts', isFile: true },
      { path: 'src', isFile: false },
    ]);
  });

  it('answers null for what does not exist, and keeps one answer per candidate', async () => {
    expect(await locateFiles(root, ['nada.ts', 'src/app.ts', ''])).toEqual([
      null,
      { path: 'src/app.ts', isFile: true },
      null,
    ]);
  });

  it('refuses what leaves the folder, by .. or by an absolute path', async () => {
    const answers = await locateFiles(root, [
      '../fora/segredo.txt',
      path.join(outside, 'segredo.txt'),
      '..',
      root,
      path.dirname(root),
    ]);
    expect(answers).toEqual([null, null, null, null, null]);
  });

  it('refuses a file reached through a link to outside, and follows one that stays inside', async () => {
    try {
      fs.symlinkSync(outside, path.join(root, 'atalho'), 'junction');
      fs.symlinkSync(path.join(root, 'src'), path.join(root, 'interno'), 'junction');
    } catch {
      return; // no permission to link on this machine
    }
    const answers = await locateFiles(root, ['atalho/segredo.txt', 'interno/app.ts']);
    expect(answers[0]).toBeNull();
    expect(answers[1]).toEqual({ path: 'src/app.ts', isFile: true });
  });

  it('refuses a file link to a file outside', async () => {
    try {
      fs.symlinkSync(path.join(outside, 'segredo.txt'), path.join(root, 'link.txt'), 'file');
    } catch {
      return;
    }
    expect(await locateFiles(root, ['link.txt'])).toEqual([null]);
  });

  it('gives no answer to NUL bytes, huge lists or huge names', async () => {
    expect(await locateFiles(root, ['src/app.ts\0.png'])).toEqual([null]);
    expect(await locateFiles(root, ['a'.repeat(2000)])).toEqual([null]);
    const many = Array.from({ length: 100 }, () => 'README.md');
    const answers = await locateFiles(root, many);
    expect(answers).toHaveLength(100);
    expect(answers.at(-1)).toBeNull();
  });

  it.runIf(process.platform === 'win32')(
    'ignores case and reads the MSYS form on Windows',
    async () => {
      const answers = await locateFiles(root, [
        'SRC\\APP.TS',
        'src\\app.ts',
        root
          .replace(/^([A-Za-z]):/, (_, drive: string) => `/${drive.toLowerCase()}`)
          .replaceAll('\\', '/') + '/src/app.ts',
        path.join(root, 'SRC', 'app.ts').toLowerCase(),
      ]);
      // The name comes back as it is on the disk, whatever was printed.
      expect(answers).toEqual(Array(4).fill({ path: 'src/app.ts', isFile: true }));
    },
  );

  it.runIf(process.platform === 'win32')(
    'matches the 8.3 short and the long form of the folder',
    async () => {
      // os.tmpdir() is the short form (HENRIQ~1) on many Windows machines; the paths printed by
      // tools may use either.
      const folder = fs.mkdtempSync(path.join(os.tmpdir(), 'ac-locate-nome-comprido-'));
      try {
        fs.writeFileSync(path.join(folder, 'a.ts'), 'x');
        const long = fs.realpathSync.native(folder);
        const answers = await locateFiles(folder, [
          path.join(long, 'a.ts'),
          path.join(folder, 'a.ts'),
        ]);
        expect(answers).toEqual(Array(2).fill({ path: 'a.ts', isFile: true }));
        expect(await locateFiles(long, [path.join(folder, 'a.ts')])).toEqual([
          { path: 'a.ts', isFile: true },
        ]);
      } finally {
        fs.rmSync(folder, { recursive: true, force: true });
      }
    },
  );

  it.runIf(process.platform !== 'win32')('is case sensitive on Linux', async () => {
    expect(await locateFiles(root, ['SRC/app.ts'])).toEqual([null]);
  });
});
