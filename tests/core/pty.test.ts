import fs from 'node:fs';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { buildChildEnv } from '@core/pty/env';
import { isAlive } from '@core/pty/killTree';
import { toLongPath } from '@core/pty/longPath';
import { PtyManager, type PtyExit } from '@core/pty/PtyManager';
import { quoteWindowsArg, resolveWindowsSpawn } from '@core/pty/windowsArgs';
import { FIXTURES, removeDir, tempDir, waitFor } from './helpers';

const isWindows = process.platform === 'win32';
const NODE = process.execPath;

describe('PtyManager', () => {
  let ptys: PtyManager;
  let output: Record<string, string>;
  let exits: Record<string, PtyExit>;
  let dir: string;

  beforeEach(() => {
    dir = tempDir();
    ptys = new PtyManager();
    output = {};
    exits = {};
    ptys.on('data', (id, chunk) => (output[id] = (output[id] ?? '') + chunk));
    ptys.on('exit', (id, exit) => (exits[id] = exit));
  });
  afterEach(async () => {
    await ptys.killAll({ graceMs: 0 });
    removeDir(dir);
  });

  const node = (
    id: string,
    script: string,
    extra: Partial<Parameters<PtyManager['create']>[0]> = {},
  ) => ptys.create({ id, file: NODE, args: ['-e', script], cwd: dir, ...extra });

  it('creates a PTY, runs a command, reads the output and reports the exit', async () => {
    const { pid } = node('a', "console.log('saida-' + (6 * 7)); process.exit(3)");
    expect(pid).toBeGreaterThan(0);
    expect(ptys.has('a')).toBe(true);
    await waitFor(() => exits.a);
    expect(output.a).toContain('saida-42');
    expect(exits.a!.exitCode).toBe(3);
    expect(ptys.has('a')).toBe(false);
  });

  it('writes to the process', async () => {
    node(
      'a',
      "console.log('pronto'); process.stdin.on('data', d => { console.log('eco:' + String(d).trim().toUpperCase()); process.exit(0) })",
    );
    await waitFor(() => output.a?.includes('pronto'));
    ptys.write('a', 'abc\r');
    await waitFor(() => exits.a);
    expect(output.a).toContain('eco:ABC');
  });

  it('resizes, and the process sees the new size', async () => {
    node(
      'a',
      // Node on Windows only learns about a resize when it writes; ask the console directly.
      "const size = () => { process.stdout._refreshSize(); return process.stdout.getWindowSize().join('x') }; const first = size();" +
        "console.log('inicio ' + first);" +
        "setInterval(() => { if (size() !== first) { console.log('novo ' + size()); process.exit(0) } }, 50)",
      { cols: 90, rows: 25 },
    );
    await waitFor(() => output.a?.includes('inicio 90x25'));
    ptys.resize('a', 132, 43);
    await waitFor(() => exits.a);
    expect(output.a).toContain('novo 132x43');
  });

  it('keeps a map of live PTYs by id', async () => {
    node('a', 'setInterval(() => {}, 1000)');
    node('b', 'setInterval(() => {}, 1000)');
    expect(ptys.ids().sort()).toEqual(['a', 'b']);
    expect(() => node('a', '')).toThrow(/já existe/);
    await ptys.kill('a', { graceMs: 0 });
    expect(ptys.ids()).toEqual(['b']);
  });

  it('injects the session variables and hides the ones of the app', async () => {
    const parent = {
      ...process.env,
      ELECTRON_RUN_AS_NODE: '1',
      VITE_DEV_SERVER_URL: 'http://localhost',
      NODE_OPTIONS: '--max-old-space-size=64',
      MANTIDA: 'sim',
    };
    ptys = new PtyManager(parent);
    ptys.on('data', (id, chunk) => (output[id] = (output[id] ?? '') + chunk));
    ptys.on('exit', (id, exit) => (exits[id] = exit));
    node(
      'a',
      'const e = process.env; console.log(JSON.stringify([e.AGENTCTL_SESSION_ID, e.ELECTRON_RUN_AS_NODE ?? null, e.VITE_DEV_SERVER_URL ?? null, e.NODE_OPTIONS ?? null, e.MANTIDA]))',
      { env: { AGENTCTL_SESSION_ID: 'sessao-9' } },
    );
    await waitFor(() => exits.a);
    expect(output.a).toContain('["sessao-9",null,null,null,"sim"]');
  });

  it('starts the process in the long form of the folder', async () => {
    const long = path.join(dir, 'pasta com nome bem longo');
    fs.mkdirSync(long);
    node('a', "console.log('cwd=' + process.cwd())", { cwd: long });
    await waitFor(() => exits.a);
    expect(output.a!.replace(/\r?\n/g, '')).toContain(`cwd=${long}`);
  });

  it('pause holds the output back until resume', async () => {
    // The process stays alive: what a PTY still holds when its process exits is another matter.
    node('a', "setTimeout(() => console.log('depois-da-pausa'), 300); setInterval(() => {}, 1000)");
    ptys.pause('a');
    await new Promise((resolve) => setTimeout(resolve, 900));
    expect(output.a ?? '').not.toContain('depois-da-pausa');
    ptys.resume('a');
    await waitFor(() => output.a?.includes('depois-da-pausa'));
  });

  it('operations on an unknown or finished PTY are ignored', async () => {
    ptys.write('x', 'oi');
    ptys.resize('x', 10, 10);
    await ptys.kill('x');
    node('a', 'process.exit(0)');
    await waitFor(() => exits.a);
    ptys.write('a', 'oi');
    ptys.resize('a', 10, 10);
  });

  describe('closing', () => {
    it('a process that honours Ctrl+C leaves on the polite request', async () => {
      node(
        'a',
        "process.on('SIGINT', () => { console.log('saindo-por-ctrl-c'); process.exit(0) }); console.log('pronto'); setInterval(() => {}, 1000)",
      );
      await waitFor(() => output.a?.includes('pronto'));
      const started = Date.now();
      await ptys.kill('a', { graceMs: 5000 });
      expect(Date.now() - started).toBeLessThan(4000);
      expect(output.a).toContain('saindo-por-ctrl-c');
      expect(exits.a).toBeDefined();
    });

    it('a process that ignores Ctrl+C is ended by force after the wait', async () => {
      const { pid } = node(
        'a',
        "process.on('SIGINT', () => {}); process.stdin.resume(); console.log('pronto'); setInterval(() => {}, 1000)",
      );
      await waitFor(() => output.a?.includes('pronto'));
      await ptys.kill('a', { graceMs: 300 });
      expect(exits.a).toBeDefined();
      await waitFor(() => !isAlive(pid));
    });

    it('ends children and grandchildren too, leaving no orphan', async () => {
      ptys.create({ id: 'a', file: NODE, args: [path.join(FIXTURES, 'spawn-tree.cjs')], cwd: dir });
      const pids = await waitFor(() => {
        const found = [...(output.a ?? '').matchAll(/PID\d=(\d+)/g)].map((m) => Number(m[1]));
        return found.length === 3 ? found : null;
      });
      expect(pids.every(isAlive)).toBe(true);
      await ptys.kill('a', { graceMs: 200 });
      await waitFor(() => pids.every((pid) => !isAlive(pid)), {
        message: `órfãos: ${pids.filter(isAlive).join(', ')}`,
      });
      expect(exits.a).toBeDefined();
    });

    it('killAll ends every session, as closing the app does', async () => {
      const a = node('a', 'setInterval(() => {}, 1000)');
      const b = node('b', "process.on('SIGINT', () => {}); setInterval(() => {}, 1000)");
      await ptys.killAll({ graceMs: 200 });
      expect(ptys.ids()).toEqual([]);
      await waitFor(() => !isAlive(a.pid) && !isAlive(b.pid));
    });

    it('calling kill twice is the same as once', async () => {
      node('a', 'setInterval(() => {}, 1000)');
      await Promise.all([ptys.kill('a', { graceMs: 100 }), ptys.kill('a', { graceMs: 100 })]);
      expect(exits.a).toBeDefined();
    });
  });
});

describe('toLongPath', () => {
  it('returns an absolute path', () => {
    expect(path.isAbsolute(toLongPath('.'))).toBe(true);
  });

  it('keeps a path that does not exist', () => {
    const missing = path.resolve('pasta-que-nao-existe-123');
    expect(toLongPath(missing)).toBe(missing);
  });

  it.runIf(isWindows)('expands the 8.3 short name', async () => {
    const dir = tempDir();
    try {
      const long = path.join(dir, 'Pasta Com Nome Longo');
      fs.mkdirSync(long);
      const { spawnSync } = await import('node:child_process');
      const short = spawnSync('cmd.exe', ['/d', '/c', `for %I in ("${long}") do @echo %~sI`], {
        encoding: 'utf8',
        windowsVerbatimArguments: true,
      }).stdout.trim();
      if (short.toLowerCase() === long.toLowerCase()) return; // Volume without 8.3 names.
      expect(short).toMatch(/~\d/);
      expect(toLongPath(short)).toBe(long);
    } finally {
      removeDir(dir);
    }
  });
});

describe('buildChildEnv', () => {
  it('removes the variables of the app and of a parent agent, case-insensitively', () => {
    const env = buildChildEnv(
      {
        Path: 'C:\\bin',
        electron_run_as_node: '1',
        ELECTRON_RENDERER_URL: 'x',
        AGENT_CONTROLLER_USER_DATA: 'x',
        AGENTCTL_SESSION_ID: 'de-outra-sessao',
        CLAUDECODE: '1',
        ANTHROPIC_API_KEY: 'sk-mantida',
        APPIMAGE: '/tmp/x.AppImage',
        VAZIA: undefined,
      },
      { AGENTCTL_SESSION_ID: 'nova' },
    );
    expect(env).toMatchObject({
      Path: 'C:\\bin',
      ANTHROPIC_API_KEY: 'sk-mantida',
      AGENTCTL_SESSION_ID: 'nova',
    });
    for (const gone of [
      'electron_run_as_node',
      'ELECTRON_RENDERER_URL',
      'AGENT_CONTROLLER_USER_DATA',
      'CLAUDECODE',
      'APPIMAGE',
      'VAZIA',
    ]) {
      expect(env).not.toHaveProperty(gone);
    }
  });
});

describe('Windows command line', () => {
  it.each([
    ['simples', 'simples'],
    ['com espaço', '"com espaço"'],
    ['', '""'],
    ['aspas "aqui"', '"aspas \\"aqui\\""'],
    ['C:\\pasta final\\', '"C:\\pasta final\\\\"'],
    ["notify=['C:\\a b\\x.cmd','codex-notify']", "\"notify=['C:\\a b\\x.cmd','codex-notify']\""],
  ])('quotes %s', (input, expected) => {
    expect(quoteWindowsArg(input)).toBe(expected);
  });

  it('runs an .exe directly and a .cmd shim through cmd.exe', () => {
    expect(resolveWindowsSpawn('C:\\bin\\codex.exe', ['-c', 'a b'], 'cmd.exe')).toEqual({
      file: 'C:\\bin\\codex.exe',
      args: ['-c', 'a b'],
    });
    expect(resolveWindowsSpawn('C:\\npm dir\\codex.cmd', ['-c', 'a b'], 'cmd.exe')).toEqual({
      file: 'cmd.exe',
      args: '/d /s /c ""C:\\npm dir\\codex.cmd" -c "a b""',
    });
  });

  it.runIf(isWindows)('a .cmd shim receives its arguments intact through the PTY', async () => {
    const dir = tempDir();
    const ptys = new PtyManager();
    try {
      const shim = path.join(dir, 'com espaço', 'agente.cmd');
      fs.mkdirSync(path.dirname(shim));
      const echo = path.join(dir, 'echo.cjs');
      fs.writeFileSync(echo, 'console.log(JSON.stringify(process.argv.slice(2)))');
      fs.writeFileSync(shim, `@echo off\r\n"${NODE}" "${echo}" %*\r\n`);
      let out = '';
      let done = false;
      ptys.on('data', (_id, chunk) => (out += chunk));
      ptys.on('exit', () => (done = true));
      const args = [
        '-c',
        "notify=['C:\\Users\\Dev User\\agentctl.cmd','codex-notify']",
        '--settings',
        'C:\\a b\\s.json',
      ];
      ptys.create({ id: 'a', file: shim, args, cwd: dir });
      await waitFor(() => done);
      expect(out.replace(/\r?\n/g, '')).toContain(JSON.stringify(args));
    } finally {
      await ptys.killAll({ graceMs: 0 });
      removeDir(dir);
    }
  });
});
