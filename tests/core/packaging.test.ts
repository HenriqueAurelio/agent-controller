import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const ROOT = path.resolve(__dirname, '..', '..');
const read = (file: string) => fs.readFileSync(path.join(ROOT, file), 'utf8');

/** Width and height from the header of a PNG. */
function pngSize(file: string): [number, number] {
  const header = fs.readFileSync(file).subarray(16, 24);
  return [header.readUInt32BE(0), header.readUInt32BE(4)];
}

// The sizes of the hicolor icon theme: an icon of any other size is installed where the menu and
// the dock never look.
const THEME_SIZES = [16, 22, 24, 32, 48, 64, 128, 256, 512];

describe('packaging', () => {
  it('the Linux package has its icon in sizes of the icon theme', () => {
    const builder = read('electron-builder.yml');
    const linux = builder.slice(builder.indexOf('\nlinux:'));
    const folder = /\n {2}icon: (\S+)/.exec(linux)?.[1];
    expect(folder).toBe('build/icons');
    const files = fs.readdirSync(path.join(ROOT, folder!));
    expect(files.length).toBeGreaterThan(0);
    for (const name of files) {
      const size = Number(/^(\d+)x\1\.png$/.exec(name)?.[1]);
      expect(THEME_SIZES, name).toContain(size);
      expect(pngSize(path.join(ROOT, folder!, name)), name).toEqual([size, size]);
    }
    expect(files).toContain('256x256.png');
  });

  it('the window icon is read from where the package puts it', () => {
    const builder = read('electron-builder.yml');
    const window = read('src/main/window.ts');
    const asset = /'assets', '([^']+)'/.exec(window)?.[1];
    expect(asset).toBeDefined();
    // Listed in `files`, it goes into app.asar; resources/ only has what `extraResources` lists.
    expect(builder).toContain(`- assets/${asset}`);
    expect(window).toContain(`path.join(app.getAppPath(), 'assets', '${asset}')`);
    expect(window).not.toMatch(/resourcesPath[^\n]*assets/);
  });
});
