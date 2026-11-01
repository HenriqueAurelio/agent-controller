import fs from 'node:fs';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { shellCommandLine } from '../../src/core/agents/shellCommand';
import { PtyManager } from '../../src/core/pty/PtyManager';
import {
  BackgroundService,
  type BackgroundNotice,
} from '../../src/core/background/BackgroundService';
import { sanitizeBackgroundCommands, type BackgroundCommand } from '../../src/shared/background';
import { tempDir, removeDir, sleep, waitFor } from './helpers';

// A command line is a Node script here: the same on Windows and Linux, and no shell profile.
const node = (script: string) => ({ file: process.execPath, args: ['-e', script], env: {} });

const PROXY = `console.log('proxy pronto na porta 5432'); setInterval(() => {}, 1000);`;
const FALLS = `console.log('sem login'); process.exit(3);`;

const cmd = (over: Partial<BackgroundCommand>): BackgroundCommand => ({
  id: 'db',
  name: 'Banco',
  command: PROXY,
  cwd: '',
  on: true,
  ...over,
});

let service: BackgroundService | null = null;
afterEach(async () => {
  await service?.dispose();
  service = null;
});

const make = () => {
  service = new BackgroundService({ launch: node });
  return service;
};

describe('commands in the background', () => {
  it('turned on runs, keeps its output and tells each piece; turned off stops', async () => {
    const s = make();
    const chunks: string[] = [];
    s.on('data', (id, chunk) => id === 'db' && chunks.push(chunk));
    s.configure([cmd({})]);
    expect(s.get().runs.db?.status).toBe('running');
    await waitFor(() => s.outputOf('db').includes('proxy pronto'));
    expect(chunks.join('')).toContain('proxy pronto');

    s.configure([cmd({ on: false })]);
    await waitFor(() => s.get().runs.db?.status === 'stopped');
    // The output of the run that ended stays, to read.
    expect(s.outputOf('db')).toContain('proxy pronto');
  });

  it('one that ends by itself says so once, and stays down until asked again', async () => {
    const s = make();
    const notices: BackgroundNotice[] = [];
    s.on('notice', (n) => notices.push(n));
    s.configure([cmd({ command: FALLS })]);
    await waitFor(() => s.get().runs.db?.status === 'exited');
    expect(s.get().runs.db?.exitCode).toBe(3);
    expect(notices.map((n) => [n.command.id, n.exitCode])).toEqual([['db', 3]]);
    expect(s.outputOf('db')).toContain('sem login');

    // Saving the preferences again does not start it over and over.
    s.configure([cmd({ command: FALLS })]);
    await sleep(300);
    expect(s.get().runs.db?.status).toBe('exited');
    expect(notices).toHaveLength(1);

    // Restart, or off and on, start it again.
    await s.restart('db');
    expect(s.get().runs.db?.status).toBe('running');
    await waitFor(() => notices.length === 2);
    s.configure([cmd({ command: FALLS, on: false })]);
    expect(s.get().runs.db?.status).toBe('stopped');
    s.configure([cmd({ command: PROXY, on: true })]);
    expect(s.get().runs.db?.status).toBe('running');
  });

  it('a changed command or folder starts it again with the new one', async () => {
    const dir = tempDir('ac-bg-');
    try {
      const s = make();
      s.configure([cmd({})]);
      await waitFor(() => s.outputOf('db').includes('proxy pronto'));
      s.configure([
        cmd({
          command: `console.log('cwd=' + process.cwd()); setInterval(() => {}, 1000);`,
          cwd: dir,
        }),
      ]);
      await waitFor(() => s.outputOf('db').includes('cwd='), { timeout: 15_000 });
      expect(path.resolve(s.outputOf('db').split('cwd=')[1]!.trim().split(/\r?\n/)[0]!)).toBe(
        path.resolve(dir),
      );
      expect(s.get().runs.db?.status).toBe('running');
    } finally {
      // Windows does not delete a folder a process is running in.
      await service?.dispose();
      removeDir(dir);
    }
  });

  it('a folder that does not exist fails to start, with the reason', async () => {
    const s = make();
    s.configure([cmd({ cwd: path.join(tempDir('ac-bg-'), 'nao-existe') })]);
    await waitFor(() => s.get().runs.db?.status !== 'running', { timeout: 5000 }).catch(() => null);
    const run = s.get().runs.db!;
    // node-pty refuses a missing folder at once on Windows; on Linux the child fails right after.
    expect(['failed', 'exited']).toContain(run.status);
  });

  it('a command taken out of the list stops, and closing the app stops them all', async () => {
    const s = make();
    s.configure([cmd({}), cmd({ id: 'tunel', name: 'Túnel' })]);
    await waitFor(() => s.outputOf('tunel').includes('proxy pronto'));
    s.configure([cmd({})]);
    expect(Object.keys(s.get().runs)).toEqual(['db']);
    await s.dispose();
    expect(s.get().runs.db?.status).toBe('stopped');
  });
});

describe('an alias of the user', () => {
  it.runIf(process.platform === 'linux')(
    'runs through the interactive bash, which reads the .bashrc where the alias is',
    async () => {
      const home = tempDir('ac-bg-home-');
      try {
        fs.writeFileSync(
          path.join(home, '.bashrc'),
          "alias sql_exp_prod='echo proxy do banco via alias; sleep 30'\n",
        );
        const env = { ...process.env, HOME: home, SHELL: '/bin/bash' };
        service = new BackgroundService({
          ptys: new PtyManager(env),
          launch: (command) => shellCommandLine(command, { platform: 'linux', env }),
          home,
        });
        service.configure([cmd({ command: 'sql_exp_prod' })]);
        await waitFor(() => service!.outputOf('db').includes('proxy do banco via alias'), {
          timeout: 15_000,
        });
        expect(service.get().runs.db?.status).toBe('running');
      } finally {
        await service?.dispose();
        removeDir(home);
      }
    },
  );
});

describe('the saved list', () => {
  it('keeps one line per command, drops what is broken, and names the unnamed', () => {
    expect(
      sanitizeBackgroundCommands([
        { id: 'a', name: ' Banco ', command: 'sql_exp_prod\n', cwd: '', on: true },
        { id: 'a', name: 'repetido', command: 'x' },
        { id: 'b', name: '', command: '  ' },
        { id: 'c b', command: 'x' },
        { id: 'd', command: 'npm run dev', on: 'yes' },
        'nada',
      ]),
    ).toEqual([
      { id: 'a', name: 'Banco', command: 'sql_exp_prod', cwd: '', on: true },
      { id: 'd', name: 'npm run dev', command: 'npm run dev', cwd: '', on: false },
    ]);
    expect(sanitizeBackgroundCommands(undefined)).toEqual([]);
  });
});

describe("the user's shell", () => {
  it('runs a line in the interactive shell on POSIX, where aliases are', () => {
    expect(
      shellCommandLine('sql_exp_prod', { platform: 'linux', env: { SHELL: '/bin/zsh' } }),
    ).toEqual({ file: '/bin/zsh', args: ['-ic', 'sql_exp_prod'], env: {} });
    expect(shellCommandLine('x', { platform: 'linux', env: {}, profile: false }).args).toEqual([
      '-c',
      'x',
    ]);
  });

  it('runs it in PowerShell with the profile on Windows, encoded', () => {
    const line = shellCommandLine('sql_exp_prod', { platform: 'win32', env: { PATH: '' } });
    expect(line.file).toBe('powershell.exe');
    expect(line.args.slice(0, 2)).toEqual(['-NoLogo', '-EncodedCommand']);
    const script = Buffer.from(line.args[2]!, 'base64').toString('utf16le');
    expect(script).toContain('sql_exp_prod');
    expect(
      shellCommandLine('x', { platform: 'win32', env: { PATH: '' }, profile: false }).args,
    ).toContain('-NoProfile');
  });
});
