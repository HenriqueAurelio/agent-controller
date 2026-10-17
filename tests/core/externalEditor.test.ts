import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  customLaunch,
  detectEditors,
  editorLaunch,
  launchFor,
  quoteCmdArg,
  startEditor,
} from '@core/tools/externalEditor';
import { UserError } from '@shared/i18n';
import { sanitizeExternalEditor } from '@shared/editor';

let dir: string;
let record: string;

/**
 * A stand-in for the `code` command that writes the arguments it got to a file. On Windows it is
 * a .cmd shim, like the real one, which is what makes the escaping matter.
 */
function fakeEditor(name: string): void {
  fs.writeFileSync(
    path.join(dir, 'rec.cjs'),
    "require('fs').writeFileSync(process.env.EDITOR_RECORD, JSON.stringify(process.argv.slice(2)));\n",
  );
  if (process.platform === 'win32') {
    fs.writeFileSync(path.join(dir, `${name}.cmd`), '@echo off\r\nnode "%~dp0rec.cjs" %*\r\n');
  } else {
    const file = path.join(dir, name);
    fs.writeFileSync(file, '#!/bin/sh\nexec node "$(dirname "$0")/rec.cjs" "$@"\n');
    fs.chmodSync(file, 0o755);
  }
}

async function recorded(): Promise<string[]> {
  for (let i = 0; i < 100; i++) {
    if (fs.existsSync(record)) {
      try {
        return JSON.parse(fs.readFileSync(record, 'utf8')) as string[];
      } catch {
        // Still being written.
      }
    }
    await new Promise((r) => setTimeout(r, 100));
  }
  throw new Error('the editor never ran');
}

beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ed-'));
  record = path.join(dir, 'args.json');
  process.env.EDITOR_RECORD = record;
});
afterEach(() => {
  delete process.env.EDITOR_RECORD;
  fs.rmSync(dir, { recursive: true, force: true });
});

const env = () => ({ ...process.env, PATH: dir, Path: dir });

describe('quoteCmdArg', () => {
  it('leaves a plain argument alone and quotes what cmd.exe would read', () => {
    expect(quoteCmdArg('C:\\proj\\a.ts:3:1')).toBe('C:\\proj\\a.ts:3:1');
    expect(quoteCmdArg('C:\\a b\\c.ts')).toBe('"C:\\a b\\c.ts"');
    expect(quoteCmdArg('C:\\a&b\\c.ts')).toBe('"C:\\a&b\\c.ts"');
    expect(quoteCmdArg('C:\\ação\\(x)^y')).toBe('"C:\\ação\\(x)^y"');
    // A trailing backslash must not swallow the closing quote.
    expect(quoteCmdArg('C:\\a b\\')).toBe('"C:\\a b\\\\"');
  });

  it('refuses a percent sign, which cmd.exe expands even inside quotes', () => {
    expect(() => quoteCmdArg('C:\\%PATH%\\x')).toThrow(UserError);
  });
});

describe('detectEditors', () => {
  it('lists the known editors and which are on the PATH', () => {
    fakeEditor('code');
    const found = detectEditors(env());
    expect(found.map((e) => e.id)).toEqual(['vscode', 'cursor', 'zed', 'windsurf']);
    expect(found.find((e) => e.id === 'vscode')).toMatchObject({ found: true });
    expect(found.find((e) => e.id === 'zed')?.found).toBe(false);
  });
});

describe('arguments of the known editors', () => {
  const folder = path.join(os.tmpdir(), 'x');

  it('VS Code takes the folder and -g file:line:column', () => {
    fakeEditor('code');
    const target = { folder, file: path.join(folder, 'a.ts'), line: 12, column: 3 };
    const launch = editorLaunch('vscode', target, { env: env() });
    const text = launch.args.join(' ');
    expect(text).toContain('-g');
    expect(text).toContain(`${target.file}:12:3`);
  });

  it('without a file it is only the folder; without a column, only the line', () => {
    fakeEditor('code');
    const only = editorLaunch('vscode', { folder }, { env: env() });
    expect(only.args.join(' ')).not.toContain('-g');
    const line = editorLaunch('vscode', { folder, file: 'f.ts', line: 7 }, { env: env() });
    expect(line.args.join(' ')).toContain('f.ts:7');
    expect(line.args.join(' ')).not.toContain('f.ts:7:');
  });

  it('Zed takes the folder and file:line:column', () => {
    fakeEditor('zed');
    const launch = editorLaunch(
      'zed',
      { folder, file: 'f.ts', line: 2, column: 5 },
      { env: env() },
    );
    // On Windows the shim is a .cmd, so the arguments are a command line for cmd.exe.
    expect(launch.args.join(' ')).toContain('f.ts:2:5');
    expect(launch.args.join(' ')).not.toContain('-g');
  });

  it('says which editor is missing', () => {
    expect(() => editorLaunch('cursor', { folder }, { env: env() })).toThrow(/Cursor/);
  });
});

describe('what the editor really receives', () => {
  it.each([
    ['with a space and an accent', 'pasta com espaço e ação'],
    ['with an ampersand', 'a&b'],
    ['with parentheses and a caret', 'c(1)^d'],
  ])('a path %s arrives as one argument', async (_name, folderName) => {
    fakeEditor('code');
    const folder = path.join(dir, folderName);
    fs.mkdirSync(folder);
    const file = path.join(folder, 'arquivo ç&.ts');
    fs.writeFileSync(file, 'x');
    const launch = editorLaunch('vscode', { folder, file, line: 4, column: 9 }, { env: env() });
    await startEditor(launch, folder);
    expect(await recorded()).toEqual([folder, '-g', `${file}:4:9`]);
  });

  it.runIf(process.platform === 'win32')('a % in the path is refused, not run', () => {
    fakeEditor('code');
    expect(() =>
      editorLaunch('vscode', { folder: path.join(dir, '%TEMP%') }, { env: env() }),
    ).toThrow(UserError);
  });

  it('fails when the program cannot start', async () => {
    await expect(startEditor({ file: path.join(dir, 'nope'), args: [] }, dir)).rejects.toThrow(
      UserError,
    );
  });
});

describe('the command of "other"', () => {
  const target = { folder: '/p/pasta com espaço', file: "/p/it's here.ts", line: 3, column: 8 };

  it('puts each value in one POSIX argument', () => {
    const launch = customLaunch('myeditor {arquivo} +{linha} --col={coluna} {pasta}', target, {
      platform: 'linux',
    });
    expect(launch.file).toBe('/bin/sh');
    expect(launch.args).toEqual([
      '-c',
      "myeditor '/p/it'\\''s here.ts' +3 --col=8 '/p/pasta com espaço'",
    ]);
  });

  it('puts each value in one PowerShell string on Windows', () => {
    const launch = customLaunch('myeditor {arquivo}', target, { platform: 'win32', env: {} });
    expect(launch.args.slice(0, 3)).toEqual(['-NoLogo', '-NonInteractive', '-EncodedCommand']);
    const script = Buffer.from(launch.args[3]!, 'base64').toString('utf16le');
    expect(script).toBe("myeditor '/p/it''s here.ts'");
  });

  it('an unknown value is an empty argument', () => {
    const launch = customLaunch('e {arquivo} {linha}', { folder: '/p' }, { platform: 'linux' });
    expect(launch.args[1]).toBe("e '' ''");
  });

  it('a shell-looking value cannot become a command', async () => {
    const marker = path.join(dir, 'pwned');
    const folder = path.join(dir, 'x; touch pwned');
    fs.mkdirSync(folder);
    fakeEditor('rec');
    const command =
      process.platform === 'win32'
        ? `& '${path.join(dir, 'rec.cmd')}' {pasta}`
        : `${path.join(dir, 'rec')} {pasta}`;
    await startEditor(customLaunch(command, { folder }), folder);
    expect(await recorded()).toEqual([folder]);
    expect(fs.existsSync(marker)).toBe(false);
  });

  it('refuses an empty command and a missing choice', () => {
    expect(() => customLaunch('  ', { folder: '/p' })).toThrow(UserError);
    expect(() => launchFor({ editor: '', command: '' }, { folder: '/p' })).toThrow(UserError);
    expect(() => launchFor({ editor: 'other', command: '' }, { folder: '/p' })).toThrow(UserError);
  });
});

describe('sanitizeExternalEditor', () => {
  it('keeps a known choice and drops what is not one', () => {
    expect(sanitizeExternalEditor({ editor: 'zed', command: ' x ' })).toEqual({
      editor: 'zed',
      command: 'x',
    });
    expect(sanitizeExternalEditor({ editor: 'rm -rf', command: 3 })).toEqual({
      editor: '',
      command: '',
    });
    expect(sanitizeExternalEditor(undefined)).toEqual({ editor: '', command: '' });
    expect(sanitizeExternalEditor({ editor: 'other', command: 'a'.repeat(2000) }).command).toBe('');
  });
});
