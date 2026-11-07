// aurelium: controls the running Aurelium from a terminal, a script or an agent (ADR 0034).
//
//   aurelium list | status <session> | new <folder> [--name N] [--agent A] [--prompt T]
//   aurelium send <session> <text> | wait <session> [--timeout S] | read <session> [--lines N]
//   aurelium mcp      (the same, as tools of an MCP server on stdin and stdout)
//
// It finds the app through aurelium.json, beside this script, which the app rewrites on every
// start. The words it prints come from there too, in the language of the app.
// Exit codes: 0 done, 1 error, 2 `wait` ran out of time.
'use strict';

const fs = require('fs');
const net = require('net');
const path = require('path');

const DISCOVERY = path.join(__dirname, 'aurelium.json');

function discovery() {
  try {
    const data = JSON.parse(fs.readFileSync(DISCOVERY, 'utf8'));
    if (data && data.v === 1 && typeof data.socket === 'string') return data;
  } catch {
    // Read below as "the app is not open".
  }
  return null;
}

function say(key, params) {
  const found = discovery();
  let text = (found && found.messages && found.messages[key]) || key;
  for (const [name, value] of Object.entries(params || {})) {
    text = text.split(`{${name}}`).join(String(value));
  }
  return text;
}

class ControlError extends Error {}

/** One request, one answer. Never ends its side first: the app answers on the same connection. */
function request(op, args) {
  return new Promise((resolve, reject) => {
    const found = discovery();
    if (!found) return reject(new ControlError(say('cli.notRunning')));
    const socket = net.connect(found.socket);
    let text = '';
    let settled = false;
    const finish = (fn, value) => {
      if (settled) return;
      settled = true;
      socket.destroy();
      fn(value);
    };
    socket.setEncoding('utf8');
    socket.on('error', () => finish(reject, new ControlError(say('cli.notRunning'))));
    socket.on('connect', () => {
      socket.write(JSON.stringify({ v: 1, op, token: found.token, args }) + '\n');
    });
    socket.on('data', (chunk) => {
      text += chunk;
      const end = text.indexOf('\n');
      if (end === -1) return;
      let answer;
      try {
        answer = JSON.parse(text.slice(0, end));
      } catch {
        return finish(reject, new ControlError(say('cli.notRunning')));
      }
      if (answer.ok) finish(resolve, answer.data);
      else {
        const error = answer.error === 'refused' ? say('cli.refused') : String(answer.error);
        finish(reject, new ControlError(error));
      }
    });
    socket.on('close', () => finish(reject, new ControlError(say('cli.notRunning'))));
  });
}

// ---- command line --------------------------------------------------------------------------

function parse(argv) {
  const positional = [];
  const flags = {};
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === '--json') flags.json = true;
    else if (arg.startsWith('--') && arg.includes('=')) {
      const at = arg.indexOf('=');
      flags[arg.slice(2, at)] = arg.slice(at + 1);
    } else if (arg.startsWith('--') && i + 1 < argv.length) flags[arg.slice(2)] = argv[++i];
    else positional.push(arg);
  }
  return { positional, flags };
}

const row = (s) => [s.id, s.name, s.state, s.agent, s.cwd].join('\t');

function readStdin() {
  return new Promise((resolve) => {
    let input = '';
    process.stdin.setEncoding('utf8');
    process.stdin.on('data', (chunk) => (input += chunk));
    process.stdin.on('end', () => resolve(input));
  });
}

async function cli(argv) {
  const { positional, flags } = parse(argv);
  const [command, target, ...rest] = positional;
  const print = (data, plain) =>
    process.stdout.write((flags.json ? JSON.stringify(data) : plain) + '\n');
  switch (command) {
    case 'list': {
      const sessions = await request('list', {});
      print(sessions, sessions.map(row).join('\n'));
      return 0;
    }
    case 'status': {
      const session = await request('status', { session: target });
      print(session, row(session));
      return 0;
    }
    case 'new': {
      const args = { cwd: target ? path.resolve(target) : undefined };
      if (flags.name) args.name = flags.name;
      if (flags.agent) args.agent = flags.agent;
      if (flags.prompt) args.prompt = flags.prompt;
      const session = await request('new', args);
      print(session, session.id);
      return 0;
    }
    case 'send': {
      const text = rest.length === 1 && rest[0] === '-' ? await readStdin() : rest.join(' ');
      const result = await request('send', { session: target, text });
      print(result, say(result.outcome === 'queued' ? 'cli.queued' : 'cli.sent'));
      return 0;
    }
    case 'wait': {
      const result = await request('wait', { session: target, timeout: flags.timeout });
      if (result.timedOut) {
        print(result, say('cli.timedOut', { state: result.session.state }));
        return 2;
      }
      print(result, result.session.state);
      return 0;
    }
    case 'read': {
      const result = await request('read', { session: target, lines: flags.lines });
      print(result, result.text);
      return 0;
    }
    case 'mcp':
      return mcp();
    default:
      process.stdout.write(say('cli.usage') + '\n');
      return command === undefined || command === 'help' || command === '--help' ? 0 : 1;
  }
}

// ---- MCP -----------------------------------------------------------------------------------

const session = { type: 'string', description: 'Session id, or its name when only one has it' };
const TOOLS = [
  {
    name: 'list_sessions',
    description: 'Lists the sessions open in Aurelium: id, name, state, agent and folder.',
    inputSchema: { type: 'object', properties: {} },
    run: () => request('list', {}),
  },
  {
    name: 'new_session',
    description:
      'Opens a new agent session in a folder, optionally sending it a first prompt. Returns the session.',
    inputSchema: {
      type: 'object',
      properties: {
        cwd: { type: 'string', description: 'Absolute path of an existing folder' },
        name: { type: 'string' },
        agent: { type: 'string', enum: ['claude-code', 'codex'] },
        prompt: { type: 'string', description: 'First prompt, sent once the agent is ready' },
      },
      required: ['cwd'],
    },
    run: (args) => request('new', args),
  },
  {
    name: 'send_prompt',
    description:
      'Sends a prompt to a session. A busy agent gets it when its turn ends (outcome "queued").',
    inputSchema: {
      type: 'object',
      properties: { session, text: { type: 'string' } },
      required: ['session', 'text'],
    },
    run: (args) => request('send', args),
  },
  {
    name: 'wait_session',
    description:
      'Waits until the agent of a session finishes its turn, stops or asks for something; timedOut says it did not.',
    inputSchema: {
      type: 'object',
      properties: {
        session,
        timeout: { type: 'number', description: 'Seconds, 300 when not given, at most 3600' },
      },
      required: ['session'],
    },
    run: (args) => request('wait', { timeout: 300, ...args }),
  },
  {
    name: 'read_screen',
    description: 'The last lines on the terminal of a session, as text.',
    inputSchema: {
      type: 'object',
      properties: { session, lines: { type: 'number', description: '40 when not given' } },
      required: ['session'],
    },
    run: (args) => request('read', args),
  },
];

function mcp() {
  const found = discovery();
  const version = (found && found.version) || '0.0.0';
  const reply = (id, result) =>
    process.stdout.write(JSON.stringify({ jsonrpc: '2.0', id, result }) + '\n');
  const fail = (id, code, message) =>
    process.stdout.write(JSON.stringify({ jsonrpc: '2.0', id, error: { code, message } }) + '\n');

  const handle = async (message) => {
    const { id, method, params } = message;
    if (id === undefined || id === null) return; // A notification: nothing to answer.
    switch (method) {
      case 'initialize':
        return reply(id, {
          protocolVersion: (params && params.protocolVersion) || '2025-06-18',
          capabilities: { tools: {} },
          serverInfo: { name: 'aurelium', version },
        });
      case 'ping':
        return reply(id, {});
      case 'tools/list':
        return reply(id, {
          tools: TOOLS.map(({ name, description, inputSchema }) => ({
            name,
            description,
            inputSchema,
          })),
        });
      case 'tools/call': {
        const tool = TOOLS.find((t) => t.name === (params && params.name));
        if (!tool) return fail(id, -32602, `unknown tool: ${params && params.name}`);
        try {
          const data = await tool.run((params && params.arguments) || {});
          return reply(id, { content: [{ type: 'text', text: JSON.stringify(data, null, 2) }] });
        } catch (err) {
          return reply(id, { content: [{ type: 'text', text: err.message }], isError: true });
        }
      }
      default:
        return fail(id, -32601, `method not found: ${method}`);
    }
  };

  return new Promise((resolve) => {
    let buffer = '';
    process.stdin.setEncoding('utf8');
    process.stdin.on('data', (chunk) => {
      buffer += chunk;
      let end;
      while ((end = buffer.indexOf('\n')) !== -1) {
        const line = buffer.slice(0, end).trim();
        buffer = buffer.slice(end + 1);
        if (!line) continue;
        let message;
        try {
          message = JSON.parse(line);
        } catch {
          fail(null, -32700, 'parse error');
          continue;
        }
        void handle(message);
      }
    });
    process.stdin.on('end', () => resolve(0));
  });
}

cli(process.argv.slice(2)).then(
  (code) => {
    process.exitCode = code;
  },
  (err) => {
    process.stderr.write(`${err instanceof ControlError ? err.message : String(err)}\n`);
    process.exitCode = 1;
  },
);
