import { describe, expect, it } from 'vitest';
import {
  DETACHED_ENV,
  desktopEntry,
  detachTarget,
  execArgument,
  FOREGROUND_FLAG,
  type StartContext,
} from '../../src/core/desktop/linuxDesktop';

const fromTerminal: StartContext = {
  platform: 'linux',
  packaged: true,
  stdoutIsTTY: true,
  env: {},
  argv: ['/opt/Aurelium/aurelium', '--some-flag'],
  execPath: '/opt/Aurelium/aurelium',
};

describe('letting go of the terminal', () => {
  it('starts a copy of the installed app, with the same arguments', () => {
    expect(detachTarget(fromTerminal)).toEqual({
      file: '/opt/Aurelium/aurelium',
      args: ['--some-flag'],
    });
  });

  it('starts the AppImage file, not the program inside its mount', () => {
    const target = detachTarget({
      ...fromTerminal,
      env: { APPIMAGE: '/home/eu/Aurelium-0.5.0.AppImage' },
      execPath: '/tmp/.mount_AureliXYZ/aurelium',
    });
    expect(target?.file).toBe('/home/eu/Aurelium-0.5.0.AppImage');
  });

  it.each([
    ['on Windows', { platform: 'win32' as const }],
    ['in development', { packaged: false }],
    ['started from the menu', { stdoutIsTTY: false }],
    ['once detached already', { env: { [DETACHED_ENV]: '1' } }],
    ['in the tests', { env: { AGENT_CONTROLLER_TEST_SHELL: '1' } }],
    ['asked to stay', { argv: ['/opt/Aurelium/aurelium', FOREGROUND_FLAG] }],
  ])('stays %s', (_case, change) => {
    expect(detachTarget({ ...fromTerminal, ...change })).toBeNull();
  });
});

describe('the entry in the menu of applications', () => {
  it('quotes the program as the desktop entry spec asks', () => {
    expect(execArgument('/home/eu/Meus Apps/Aurelium.AppImage')).toBe(
      '"/home/eu/Meus Apps/Aurelium.AppImage"',
    );
    expect(execArgument('/a/$x`y"z\\w')).toBe('"/a/\\$x\\`y\\"z\\\\w"');
  });

  it('names the app, its icon and the window it opens', () => {
    const entry = desktopEntry({
      name: 'Aurelium',
      comment: 'Sessões em uma janela só',
      exec: '/home/eu/Aurelium.AppImage',
      icon: 'aurelium',
      wmClass: 'aurelium',
    });
    expect(entry.split('\n')).toEqual([
      '[Desktop Entry]',
      'Name=Aurelium',
      'Comment=Sessões em uma janela só',
      'Exec="/home/eu/Aurelium.AppImage" %U',
      'TryExec=/home/eu/Aurelium.AppImage',
      'Terminal=false',
      'Type=Application',
      'Icon=aurelium',
      'StartupWMClass=aurelium',
      'Categories=Development;',
      '',
    ]);
  });

  it('keeps a newline in a text from making a key of its own', () => {
    const entry = desktopEntry({
      name: 'A',
      comment: 'x\nExec=/bin/evil',
      exec: '/a',
      icon: 'i',
      wmClass: 'w',
    });
    expect(entry).toContain('Comment=x\\nExec=/bin/evil');
    expect(entry.match(/^Exec=/gm)).toHaveLength(1);
  });
});
