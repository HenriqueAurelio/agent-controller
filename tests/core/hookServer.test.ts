import { spawn } from 'node:child_process';
import fs from 'node:fs';
import net from 'node:net';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { hookCommandFor, installAgentctl } from '@core/signals/agentctlInstall';
import {
  createSocketPath,
  HookServer,
  parseHookMessage,
  type HookMessage,
} from '@core/signals/HookServer';
import { AGENTCTL_SCRIPT, removeDir, sleep, tempDir, waitFor } from './helpers';

interface RunResult {
  code: number | null;
  ms: number;
  stdout: string;
  stderr: string;
}

interface RunOptions {
  env?: Record<string, string | undefined>;
  stdin?: string;
  shell?: boolean;
}

function run(file: string, args: string[], options: RunOptions = {}): Promise<RunResult> {
  return new Promise((resolve, reject) => {
    const started = Date.now();
    const child = spawn(file, args, {
      env: { ...process.env, ...options.env },
      shell: options.shell,
      windowsHide: true,
    });
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (d) => (stdout += d));
    child.stderr.on('data', (d) => (stderr += d));
    child.on('error', reject);
    child.on('close', (code) => resolve({ code, ms: Date.now() - started, stdout, stderr }));
    child.stdin.end(options.stdin ?? '');
  });
}

const agentctl = (args: string[], options: RunOptions = {}) =>
  run(process.execPath, [AGENTCTL_SCRIPT, ...args], options);

describe('HookServer + agentctl', () => {
  let server: HookServer;
  let received: HookMessage[];
  const known = new Set(['sessao-1', 'sessao-2']);
  let dir: string;

  beforeEach(async () => {
    dir = tempDir();
    received = [];
    server = new HookServer({
      socketPath: createSocketPath(),
      isKnownSession: (id) => known.has(id),
    });
    server.on('message', (m) => received.push(m));
    await server.listen();
  });
  afterEach(async () => {
    await server.close();
    removeDir(dir);
  });

  const env = (session: string | undefined) => ({
    AGENTCTL_SESSION_ID: session,
    AGENTCTL_SOCKET: server.socketPath,
  });

  it('a hook payload on stdin reaches the right session', async () => {
    const payload = { hook_event_name: 'Stop', session_id: 'abc' };
    const result = await agentctl(['claude-hook'], {
      env: env('sessao-2'),
      stdin: JSON.stringify(payload),
    });
    expect(result).toMatchObject({ code: 0, stdout: '', stderr: '' });
    await waitFor(() => received.length === 1);
    expect(received[0]).toEqual({ sessionId: 'sessao-2', source: 'claude-hook', payload });
  });

  it('a notify payload as the last argument reaches the session', async () => {
    const payload = {
      type: 'agent-turn-complete',
      'thread-id': 't1',
      'input-messages': ['olá "mundo" 100%'],
    };
    await agentctl(['codex-notify', JSON.stringify(payload)], { env: env('sessao-1') });
    await waitFor(() => received.length === 1);
    expect(received[0]).toEqual({ sessionId: 'sessao-1', source: 'codex-notify', payload });
  });

  it('messages for an unknown session are dropped', async () => {
    const result = await agentctl(['claude-hook'], { env: env('intruso'), stdin: '{}' });
    expect(result.code).toBe(0);
    await agentctl(['claude-hook'], { env: env('sessao-1'), stdin: '{}' });
    await waitFor(() => received.length === 1);
    expect(received.map((m) => m.sessionId)).toEqual(['sessao-1']);
  });

  it('without a session id nothing is sent', async () => {
    const result = await agentctl(['claude-hook'], { env: env(undefined), stdin: '{}' });
    expect(result).toMatchObject({ code: 0, stdout: '', stderr: '' });
    await sleep(150);
    expect(received).toEqual([]);
  });

  it('non-JSON input is forwarded as raw text instead of failing', async () => {
    await agentctl(['codex-hook'], { env: env('sessao-1'), stdin: 'não é json' });
    await waitFor(() => received.length === 1);
    expect(received[0]!.payload).toEqual({ raw: 'não é json' });
  });

  it('with the app closed, exits 0 in under a second and prints nothing', async () => {
    const socketPath = server.socketPath;
    await server.close();
    const result = await agentctl(['claude-hook'], {
      env: { AGENTCTL_SESSION_ID: 'sessao-1', AGENTCTL_SOCKET: socketPath },
      stdin: '{}',
    });
    expect(result).toMatchObject({ code: 0, stdout: '', stderr: '' });
    expect(result.ms).toBeLessThan(1000);
  });

  it('a stdin that never closes does not hang the hook', async () => {
    const child = spawn(process.execPath, [AGENTCTL_SCRIPT, 'claude-hook'], {
      env: { ...process.env, ...env('sessao-1') },
    });
    const started = Date.now();
    child.stdin.write('{"hook_event_name":"Stop"}');
    const code = await new Promise((resolve) => child.on('close', resolve));
    expect(code).toBe(0);
    expect(Date.now() - started).toBeLessThan(1500);
    await waitFor(() => received.length === 1);
    expect(received[0]!.payload).toEqual({ hook_event_name: 'Stop' });
  });

  it('garbage sent straight to the socket is ignored and the server keeps working', async () => {
    await new Promise<void>((resolve) => {
      const socket = net.connect(server.socketPath, () =>
        socket.end('{"v":2,"session":"sessao-1"}\nlixo'),
      );
      socket.on('close', () => resolve());
    });
    await agentctl(['claude-hook'], { env: env('sessao-1'), stdin: '{}' });
    await waitFor(() => received.length === 1);
    expect(received).toHaveLength(1);
  });

  it('the endpoint is private to the user', () => {
    if (process.platform === 'win32') {
      expect(server.socketPath).toMatch(/^\\\\\.\\pipe\\agent-controller-[0-9a-f]{16}$/);
      return;
    }
    expect(fs.statSync(server.socketPath).mode & 0o777).toBe(0o600);
    expect(fs.statSync(path.dirname(server.socketPath)).mode & 0o777).toBe(0o700);
  });

  describe('installed launcher', () => {
    it('lives in a fixed folder and is not rewritten when nothing changed', () => {
      const directory = path.join(dir, 'com espaço', 'bin');
      const first = installAgentctl({ sourceScript: AGENTCTL_SCRIPT, directory });
      const mtime = fs.statSync(first.program).mtimeMs;
      const second = installAgentctl({ sourceScript: AGENTCTL_SCRIPT, directory });
      expect(second).toEqual(first);
      expect(fs.statSync(second.program).mtimeMs).toBe(mtime);
      expect(path.dirname(first.program)).toBe(directory);
      expect(fs.existsSync(path.join(directory, 'agentctl.cjs'))).toBe(true);
    });

    it('executed directly with a JSON argument, as Codex does with notify', async () => {
      const install = installAgentctl({
        sourceScript: AGENTCTL_SCRIPT,
        directory: path.join(dir, 'com espaço', 'bin'),
      });
      const payload = {
        type: 'agent-turn-complete',
        'thread-id': 'th-1',
        'input-messages': ['rode "npm test" & veja <ok> 100% | ^ fim\\'],
      };
      const [program, ...leading] = install.notify;
      const result = await run(program!, [...leading, 'codex-notify', JSON.stringify(payload)], {
        env: env('sessao-1'),
      });
      expect(result.code).toBe(0);
      await waitFor(() => received.length === 1);
      expect(received[0]).toEqual({ sessionId: 'sessao-1', source: 'codex-notify', payload });
    });

    it('the hook command, run through a shell, delivers stdin', async () => {
      const install = installAgentctl({
        sourceScript: AGENTCTL_SCRIPT,
        directory: path.join(dir, 'com espaço', 'bin'),
      });
      const result = await run(`${install.command} claude-hook`, [], {
        env: env('sessao-2'),
        stdin: JSON.stringify({ hook_event_name: 'PermissionRequest', tool_name: 'Bash' }),
        shell: true,
      });
      expect(result).toMatchObject({ code: 0, stdout: '' });
      await waitFor(() => received.length === 1);
      expect(received[0]).toMatchObject({
        sessionId: 'sessao-2',
        source: 'claude-hook',
        payload: { tool_name: 'Bash' },
      });
    });

    it('the hook command has no spaces to trip a shell, or is quoted', () => {
      const program = path.join(dir, 'com espaço', process.platform === 'win32' ? 'a.cmd' : 'a');
      fs.mkdirSync(path.dirname(program), { recursive: true });
      fs.writeFileSync(program, '');
      const command = hookCommandFor(program);
      expect(/^\S+$/.test(command) || /^(["']).*\1$/.test(command)).toBe(true);
    });
  });
});

describe('parseHookMessage', () => {
  it.each([
    [''],
    ['null'],
    ['{"v":1}'],
    ['{"v":1,"session":"a b","source":"x"}'],
    ['{"v":1,"session":"../../x","source":"x"}'],
    ['{"v":1,"session":"ok","source":"com espaço"}'],
  ])('rejects %s', (text) => {
    expect(parseHookMessage(text)).toBeNull();
  });

  it('accepts a well-formed message', () => {
    expect(
      parseHookMessage('{"v":1,"session":"a-1","source":"claude-hook","payload":{"x":1}}\n'),
    ).toEqual({ sessionId: 'a-1', source: 'claude-hook', payload: { x: 1 } });
  });
});
