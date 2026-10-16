import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { interactiveShell, type LaunchCommand } from '@core/agents';
import { isAlive } from '@core/pty/killTree';
import { PtyManager } from '@core/pty/PtyManager';
import { SessionManager } from '@core/sessions/SessionManager';
import { createSocketPath, HookServer } from '@core/signals/HookServer';
import { DEFAULT_PREFERENCES } from '@shared/prefs';
import { auxTerminalId, parseTerminalId, type SessionState } from '@shared/session';
import { AGENTCTL_SCRIPT, FIXTURES, removeDir, sleep, tempDir, waitFor } from './helpers';

const SIZE = { cols: 100, rows: 30 };
const FAKE_AGENT = path.join(FIXTURES, 'fake-agent.cjs');
const isWindows = process.platform === 'win32';
// A plain shell, as the e2e tests use: no profile of whoever runs the tests.
const SHELL: LaunchCommand = isWindows
  ? { file: process.env.ComSpec || 'cmd.exe', args: [], env: {} }
  : { file: 'bash', args: ['--noprofile', '--norc'], env: { PS1: '$ ' } };
const PRINT_FOLDER = isWindows ? 'cd' : 'pwd';

describe('the terminal beside the agent', () => {
  let dir: string;
  let ptys: PtyManager;
  let hooks: HookServer;
  let manager: SessionManager;
  let data: Record<string, string>;

  const state = (id: string): SessionState => manager.statusOf(id).state;
  const create = (name = 'Sessão') => manager.create({ name, cwd: dir, profile: 'claude-code' });
  const screen = (id: string) => manager.screenText(id);
  const run = async (id: string, line: string, expected: string) => {
    manager.input(id, `${line}\r`);
    await waitFor(async () => (await screen(id)).includes(expected), {
      timeout: 15_000,
      message: `"${expected}" no terminal ${id}`,
    });
  };

  beforeEach(async () => {
    dir = tempDir('ac-aux-ção ');
    ptys = new PtyManager();
    data = {};
    hooks = new HookServer({
      socketPath: createSocketPath(),
      isKnownSession: (id) => manager.has(id),
    });
    hooks.on('message', (message) => manager.handleHook(message));
    await hooks.listen();
    manager = new SessionManager({
      ptys,
      sessions: [],
      selectedId: null,
      prefs: { ...DEFAULT_PREFERENCES, silenceSeconds: 0 },
      persist: () => {},
      resolveLaunch: (session) => ({
        file: process.execPath,
        args: [FAKE_AGENT],
        env: {
          AGENTCTL_SESSION_ID: session.id,
          AGENTCTL_SOCKET: hooks.socketPath,
          FAKE_AGENTCTL: AGENTCTL_SCRIPT,
        },
      }),
      resolveAuxShell: () => SHELL,
    });
    manager.on('data', (id, chunk) => (data[id] = (data[id] ?? '') + chunk));
  });
  afterEach(async () => {
    await manager.dispose(0);
    await ptys.killAll({ graceMs: 0 });
    await hooks.close();
    removeDir(dir);
  });

  it('opens a shell in the folder of the session, and nothing typed there reaches the agent', async () => {
    const s = create();
    manager.start(s.id, SIZE);
    await waitFor(() => state(s.id) === 'aguardando', { timeout: 15_000 });

    const aux = auxTerminalId(s.id);
    expect(manager.hasTerminal(aux)).toBe(false);
    manager.openAux(s.id, SIZE);
    expect(manager.list()[0]!.auxOpen).toBe(true);
    expect(manager.hasTerminal(aux)).toBe(true);
    // Opening it twice keeps the one that is there.
    const pid = ptys.pid(aux)!;
    manager.openAux(s.id, SIZE);
    expect(ptys.pid(aux)).toBe(pid);

    await run(aux, PRINT_FOLDER, path.basename(dir));
    await run(aux, 'echo marca-do-auxiliar', 'marca-do-auxiliar');

    await sleep(300);
    const agentScreen = await screen(s.id);
    expect(agentScreen).not.toContain('marca-do-auxiliar');
    expect(agentScreen).not.toContain(PRINT_FOLDER);
    expect(state(s.id)).toBe('aguardando');
    expect(data[s.id] ?? '').not.toContain('marca-do-auxiliar');
  });

  it('closing hides it at once, and opening it again right away waits for the old shell', async () => {
    const s = create();
    const aux = auxTerminalId(s.id);
    manager.openAux(s.id, SIZE);
    await run(aux, 'echo primeiro', 'primeiro');
    const oldPid = ptys.pid(aux)!;

    const closing = manager.closeAux(s.id);
    // Before the process tree is gone, the session already says it is closed.
    expect(manager.list()[0]!.auxOpen).toBeUndefined();
    const reopened = manager.openAux(s.id, SIZE);
    await Promise.all([closing, reopened]);

    expect(manager.list()[0]!.auxOpen).toBe(true);
    const newPid = ptys.pid(aux)!;
    expect(newPid).not.toBe(oldPid);
    await waitFor(() => !isAlive(oldPid));
    await run(aux, 'echo segundo', 'segundo');
  });

  it('closing it ends the shell and what it started; the agent goes on', async () => {
    const s = create();
    manager.start(s.id, SIZE);
    await waitFor(() => state(s.id) === 'aguardando', { timeout: 15_000 });
    manager.openAux(s.id, SIZE);
    const aux = auxTerminalId(s.id);
    const pid = ptys.pid(aux)!;
    await run(aux, 'echo pronto', 'pronto');

    await manager.closeAux(s.id);
    expect(manager.list()[0]!.auxOpen).toBeUndefined();
    expect(manager.hasTerminal(aux)).toBe(false);
    await waitFor(() => !isAlive(pid));
    expect(manager.isRunning(s.id)).toBe(true);
    // Closing what is not open is nothing.
    await manager.closeAux(s.id);
  });

  it('opens without the agent running, and closes by itself when the shell exits', async () => {
    const s = create();
    manager.openAux(s.id, SIZE);
    const aux = auxTerminalId(s.id);
    await run(aux, 'echo vivo', 'vivo');
    manager.input(aux, 'exit\r');
    await waitFor(() => !manager.list()[0]!.auxOpen, { timeout: 15_000 });
    expect(manager.isRunning(s.id)).toBe(false);
  });

  it('dies with its session, and with the app', async () => {
    const a = create('A');
    const b = create('B');
    manager.openAux(a.id, SIZE);
    manager.openAux(b.id, SIZE);
    const pids = [ptys.pid(auxTerminalId(a.id))!, ptys.pid(auxTerminalId(b.id))!];

    await manager.remove(a.id);
    await waitFor(() => !isAlive(pids[0]!));
    expect(manager.hasTerminal(auxTerminalId(a.id))).toBe(false);

    await manager.dispose(0);
    await waitFor(() => !isAlive(pids[1]!));
  });

  it('is closed when the session moves to another folder', async () => {
    const other = tempDir();
    try {
      const s = create();
      manager.openAux(s.id, SIZE);
      const pid = ptys.pid(auxTerminalId(s.id))!;
      await manager.setCwd(s.id, other);
      expect(manager.list()[0]).toMatchObject({ cwd: other });
      expect(manager.list()[0]!.auxOpen).toBeUndefined();
      await waitFor(() => !isAlive(pid));
    } finally {
      removeDir(other);
    }
  });

  it('a remounted terminal gets back the same screen', async () => {
    const s = create();
    manager.openAux(s.id, SIZE);
    const aux = auxTerminalId(s.id);
    await run(aux, 'echo de-volta', 'de-volta');
    // The shell prints its prompt a moment after the output: the screen settles first.
    const screen = async () => {
      const { data } = await manager.attach(aux, SIZE);
      manager.detach(aux);
      return data;
    };
    let first = await screen();
    await waitFor(
      async () => {
        await sleep(300);
        const now = await screen();
        const settled = now === first;
        first = now;
        return settled;
      },
      { message: 'a tela do shell parar de mudar' },
    );
    expect(first).toContain('de-volta');
    const again = await manager.attach(aux, SIZE);
    expect(again.data).toBe(first);
    // Attaching the shell does not count as mounting the agent's terminal.
    expect(manager.attachedCount()).toBe(0);
  });

  it('terminal ids: a session, or the shell beside it', () => {
    const s = create();
    expect(parseTerminalId(s.id)).toEqual({ sessionId: s.id, aux: false });
    expect(parseTerminalId(auxTerminalId(s.id))).toEqual({ sessionId: s.id, aux: true });
    expect(manager.hasTerminal(s.id)).toBe(true);
    expect(manager.hasTerminal('nao-existe')).toBe(false);
    expect(manager.hasTerminal(auxTerminalId('nao-existe'))).toBe(false);
  });
});

describe('the shell of the user', () => {
  it('is PowerShell on Windows and $SHELL elsewhere, with no command of its own', () => {
    expect(interactiveShell({ platform: 'win32', env: { PATH: '' } })).toEqual({
      file: 'powershell.exe',
      args: ['-NoLogo'],
      env: {},
    });
    expect(interactiveShell({ platform: 'linux', env: { SHELL: '/usr/bin/zsh' } })).toEqual({
      file: '/usr/bin/zsh',
      args: [],
      env: {},
    });
    expect(interactiveShell({ platform: 'linux', env: {} }).file).toBe('/bin/bash');
  });
});
