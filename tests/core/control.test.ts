import { spawn } from 'node:child_process';
import { EventEmitter } from 'node:events';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { installCli, writeDiscovery, DISCOVERY_FILE } from '../../src/core/control/cliInstall';
import { ControlServer } from '../../src/core/control/ControlServer';
import { ControlService, type ControlSessions } from '../../src/core/control/ControlService';
import { parseControlRequest } from '../../src/core/control/protocol';
import { createSocketPath } from '../../src/core/signals/HookServer';
import { errorText } from '../../src/shared/i18n';
import type { SessionState, SessionView } from '../../src/shared/session';

const SCRIPT = path.resolve(__dirname, '../../resources/agentctl/aurelium.cjs');
const MESSAGES = {
  'cli.usage': 'USO',
  'cli.notRunning': 'FECHADO',
  'cli.refused': 'RECUSADO',
  'cli.sent': 'ENVIADO',
  'cli.queued': 'NA ESPERA',
  'cli.timedOut': 'ACABOU: {state}',
};

function view(id: string, name: string, state: SessionState = 'aguardando', extra = {}) {
  return {
    id,
    name,
    cwd: `/w/${name}`,
    profile: 'claude-code',
    running: true,
    pendingSends: 0,
    status: { state, origin: 'hook', confirmed: true, since: 0 },
    ...extra,
  } as unknown as SessionView;
}

/** Sessions in memory, with the events of the manager that the service listens to. */
class FakeSessions extends EventEmitter {
  sessions: SessionView[] = [];
  sent: Array<{ id: string; text: string }> = [];
  started: string[] = [];
  screen = 'linha 1\nlinha 2\nlinha 3\n\n';
  list = () => this.sessions;
  start = (id: string) => {
    this.started.push(id);
    this.update(id, { running: true });
  };
  sendText = (id: string, text: string) => {
    this.sent.push({ id, text });
    return 'sent' as const;
  };
  screenText = async () => this.screen;
  update(id: string, change: Partial<SessionView>) {
    this.sessions = this.sessions.map((s) => (s.id === id ? { ...s, ...change } : s));
  }
  setState(id: string, state: SessionState, confirmed = true) {
    this.update(id, { status: { state, origin: 'hook', confirmed, since: 0 } });
    const session = this.sessions.find((s) => s.id === id)!;
    this.emit('transition', { session, previous: session.status });
  }
}

function service(fake: FakeSessions, now?: () => number) {
  return new ControlService({
    sessions: fake as unknown as ControlSessions,
    create: async ({ name, cwd, profile }) => {
      if (cwd === '/nao-existe') throw new Error('sem pasta');
      const created = view(`s${fake.sessions.length + 1}`, name, 'parada', {
        cwd,
        profile,
        running: false,
      });
      fake.sessions.push(created);
      return created;
    },
    now,
    pollMs: 10,
  });
}

const ask = (op: string, args: Record<string, unknown> = {}) =>
  parseControlRequest(JSON.stringify({ v: 1, op, token: 't', args }))!;

describe('parseControlRequest', () => {
  it('takes only a known operation with a token', () => {
    expect(ask('list')).toEqual({ op: 'list', token: 't', args: {} });
    expect(parseControlRequest('{"v":1,"op":"rm","token":"t"}')).toBeNull();
    expect(parseControlRequest('{"v":1,"op":"list"}')).toBeNull();
    expect(parseControlRequest('{"v":2,"op":"list","token":"t"}')).toBeNull();
    expect(parseControlRequest('nada')).toBeNull();
  });
});

describe('ControlService', () => {
  it('lists the sessions and finds one by id or by its name', async () => {
    const fake = new FakeSessions();
    fake.sessions = [view('a1', 'API'), view('b2', 'Web')];
    const control = service(fake);
    expect(await control.handle(ask('list'))).toEqual([
      expect.objectContaining({ id: 'a1', name: 'API', state: 'aguardando', agent: 'claude-code' }),
      expect.objectContaining({ id: 'b2', name: 'Web' }),
    ]);
    expect(await control.handle(ask('status', { session: 'api' }))).toMatchObject({ id: 'a1' });
    await expect(control.handle(ask('status', { session: 'x' }))).rejects.toThrow(
      'Sessão não encontrada',
    );
    fake.sessions.push(view('c3', 'web'));
    await expect(control.handle(ask('status', { session: 'Web' }))).rejects.toThrow(
      'Mais de uma sessão se chama "Web"',
    );
  });

  it('opens a session, starts it and sends the first prompt', async () => {
    const fake = new FakeSessions();
    const control = service(fake);
    const created = await control.handle(ask('new', { cwd: '/w/novo', prompt: 'olá' }));
    expect(created).toMatchObject({ id: 's1', name: 'novo', cwd: '/w/novo', running: true });
    expect(fake.started).toEqual(['s1']);
    expect(fake.sent).toEqual([{ id: 's1', text: 'olá' }]);
    await expect(control.handle(ask('new', { cwd: '/w/x', agent: 'gpt' }))).rejects.toThrow(
      'Perfil desconhecido',
    );
    await expect(control.handle(ask('new', {}))).rejects.toThrow('Argumento inválido');
  });

  it('waits for the turn that the text started, not the idle state of before it', async () => {
    let now = 1000;
    const fake = new FakeSessions();
    fake.sessions = [view('a1', 'API', 'terminou')];
    const control = service(fake, () => now);
    await control.handle(ask('send', { session: 'a1', text: 'faça' }));
    let result: unknown = null;
    const waiting = control.handle(ask('wait', { session: 'a1' })).then((r) => (result = r));
    await new Promise((r) => setTimeout(r, 50));
    expect(result).toBeNull();
    fake.setState('a1', 'trabalhando');
    await new Promise((r) => setTimeout(r, 50));
    expect(result).toBeNull();
    fake.setState('a1', 'terminou');
    await waiting;
    expect(result).toMatchObject({ timedOut: false, session: { state: 'terminou' } });

    // Silence is not the end of a turn: only a state the agent confirmed.
    now += 60_000;
    fake.setState('a1', 'aguardando', false);
    const late = await control.handle(ask('wait', { session: 'a1', timeout: 0.05 }));
    expect(late).toMatchObject({ timedOut: true, session: { state: 'aguardando' } });
  });

  it('a stopped agent ends the wait, and a caller that leaves ends it too', async () => {
    const fake = new FakeSessions();
    fake.sessions = [view('a1', 'API', 'trabalhando')];
    const control = service(fake);
    const gone = new AbortController();
    const left = control.handle(ask('wait', { session: 'a1' }), gone.signal);
    gone.abort();
    expect(await left).toMatchObject({ timedOut: true });
    const waiting = control.handle(ask('wait', { session: 'a1' }));
    fake.update('a1', { running: false });
    expect(await waiting).toMatchObject({ timedOut: false, session: { running: false } });
  });

  it('reads the last lines of the screen', async () => {
    const fake = new FakeSessions();
    fake.sessions = [view('a1', 'API')];
    const control = service(fake);
    expect(await control.handle(ask('read', { session: 'a1', lines: 2 }))).toEqual({
      text: 'linha 2\nlinha 3',
    });
  });
});

describe('the aurelium command line', () => {
  let dir: string;
  let server: ControlServer;
  let fake: FakeSessions;

  beforeEach(async () => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ac-cli-'));
    fake = new FakeSessions();
    fake.sessions = [view('a1', 'API'), view('b2', 'Web', 'trabalhando')];
    const control = service(fake);
    server = new ControlServer({
      socketPath: createSocketPath('control'),
      handle: (request, signal) => control.handle(request, signal),
      describeError: (err) => errorText('pt-BR', err),
    });
    await server.listen();
    fs.copyFileSync(SCRIPT, path.join(dir, 'aurelium.cjs'));
    writeDiscovery(dir, {
      socket: server.socketPath,
      token: server.token,
      version: '9.9.9',
      messages: MESSAGES,
    });
  });

  afterEach(async () => {
    await server.close();
    fs.rmSync(dir, { recursive: true, force: true });
  });

  const exec = (file: string, args: string[]) =>
    new Promise<{ code: number | null; out: string; err: string }>((resolve) => {
      const child = spawn(file, args);
      let out = '';
      let err = '';
      child.stdout.on('data', (d) => (out += d));
      child.stderr.on('data', (d) => (err += d));
      child.on('close', (code) => resolve({ code, out, err }));
    });
  const run = (...args: string[]) =>
    exec(process.execPath, [path.join(dir, 'aurelium.cjs'), ...args]);

  it('lists, sends and waits, with the exit code of each outcome', async () => {
    const list = await run('list');
    expect(list.code).toBe(0);
    expect(list.out).toBe(
      'a1\tAPI\taguardando\tclaude-code\t/w/API\nb2\tWeb\ttrabalhando\tclaude-code\t/w/Web\n',
    );

    const json = await run('status', 'web', '--json');
    expect(JSON.parse(json.out)).toMatchObject({ id: 'b2', state: 'trabalhando' });

    const sent = await run('send', 'API', 'rode', 'os', 'testes');
    expect(sent.out).toBe('ENVIADO\n');
    expect(fake.sent).toEqual([{ id: 'a1', text: 'rode os testes' }]);

    const timedOut = await run('wait', 'Web', '--timeout', '1');
    expect(timedOut.code).toBe(2);
    expect(timedOut.out).toBe('ACABOU: trabalhando\n');

    const missing = await run('status', 'nada');
    expect(missing.code).toBe(1);
    expect(missing.err).toBe('Sessão não encontrada\n');
  });

  it('is refused without the token, and says when the app is closed', async () => {
    const file = path.join(dir, DISCOVERY_FILE);
    const discovery = JSON.parse(fs.readFileSync(file, 'utf8'));
    fs.writeFileSync(file, JSON.stringify({ ...discovery, token: 'outro' }));
    expect(await run('list')).toMatchObject({ code: 1, err: 'RECUSADO\n' });
    fs.writeFileSync(file, JSON.stringify(discovery));
    await server.close();
    expect(await run('list')).toMatchObject({ code: 1, err: 'FECHADO\n' });
    expect(await run('ajuda')).toMatchObject({ code: 1, out: 'USO\n' });
    expect(await run()).toMatchObject({ code: 0, out: 'USO\n' });
  });

  it('serves the same commands as MCP tools', async () => {
    const child = spawn(process.execPath, [path.join(dir, 'aurelium.cjs'), 'mcp']);
    const lines: Array<Record<string, unknown>> = [];
    let buffer = '';
    child.stdout.on('data', (d) => {
      buffer += d;
      let end;
      while ((end = buffer.indexOf('\n')) !== -1) {
        lines.push(JSON.parse(buffer.slice(0, end)));
        buffer = buffer.slice(end + 1);
      }
    });
    const call = async (id: number, method: string, params?: unknown) => {
      child.stdin.write(JSON.stringify({ jsonrpc: '2.0', id, method, params }) + '\n');
      await expect.poll(() => lines.find((l) => l.id === id), { timeout: 5000 }).toBeTruthy();
      return lines.find((l) => l.id === id)!;
    };
    try {
      const init = await call(1, 'initialize', { protocolVersion: '2025-06-18' });
      expect(init.result).toMatchObject({
        protocolVersion: '2025-06-18',
        capabilities: { tools: {} },
        serverInfo: { name: 'aurelium', version: '9.9.9' },
      });
      child.stdin.write(
        JSON.stringify({ jsonrpc: '2.0', method: 'notifications/initialized' }) + '\n',
      );
      const tools = (await call(2, 'tools/list')).result as { tools: Array<{ name: string }> };
      expect(tools.tools.map((t) => t.name)).toEqual([
        'list_sessions',
        'new_session',
        'send_prompt',
        'wait_session',
        'read_screen',
      ]);
      const listed = (await call(3, 'tools/call', { name: 'list_sessions', arguments: {} }))
        .result as { content: Array<{ text: string }> };
      expect(JSON.parse(listed.content[0]!.text)).toHaveLength(2);
      const failed = (
        await call(4, 'tools/call', {
          name: 'send_prompt',
          arguments: { session: 'nada', text: 'x' },
        })
      ).result as { isError: boolean; content: Array<{ text: string }> };
      expect(failed).toMatchObject({ isError: true, content: [{ text: 'Sessão não encontrada' }] });
      expect((await call(5, 'nada')).error).toMatchObject({ code: -32601 });
    } finally {
      child.kill();
    }
  });

  it('installs a launcher that gives back the exit code of the script', async () => {
    const bin = path.join(dir, 'bin');
    const program = installCli({ sourceScript: SCRIPT, directory: bin, runtime: process.execPath });
    fs.copyFileSync(path.join(dir, DISCOVERY_FILE), path.join(bin, DISCOVERY_FILE));
    const args = ['wait', 'Web', '--timeout', '1'];
    const result =
      process.platform === 'win32'
        ? await exec('cmd.exe', ['/d', '/c', program, ...args])
        : await exec(program, args);
    expect(result.out.trim()).toBe('ACABOU: trabalhando');
    expect(result.code).toBe(2);
  });
});
