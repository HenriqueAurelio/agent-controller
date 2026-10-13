// agentctl: called by the agents' hooks. Forwards what it received to the app, tagged with the
// session it belongs to.
//
//   agentctl <source> [payload]
//
// The payload comes as the last argument (Codex `notify`) or on stdin (hooks).
// It never prints, never fails and never takes long: a closed app means a silent exit 0.
'use strict';

const net = require('net');

const HARD_LIMIT_MS = 900;
const STDIN_LIMIT_MS = 400;
const MAX_PAYLOAD = 200 * 1024;

const finish = () => process.exit(0);
process.on('uncaughtException', finish);
process.on('unhandledRejection', finish);
setTimeout(finish, HARD_LIMIT_MS);

const session = process.env.AGENTCTL_SESSION_ID;
const socketPath = process.env.AGENTCTL_SOCKET;
const [source = 'unknown', ...rest] = process.argv.slice(2);

function send(text) {
  let payload = null;
  if (text) {
    try {
      payload = JSON.parse(text);
    } catch {
      payload = { raw: text.slice(0, MAX_PAYLOAD) };
    }
  }
  const socket = net.connect(socketPath);
  socket.on('error', finish);
  socket.on('close', finish);
  socket.on('connect', () => {
    socket.end(JSON.stringify({ v: 1, session, source, payload }) + '\n');
  });
}

if (!session || !socketPath) {
  finish();
} else if (rest.length > 0) {
  send(rest[rest.length - 1]);
} else if (process.stdin.isTTY) {
  send('');
} else {
  let input = '';
  let sent = false;
  const flush = () => {
    if (sent) return;
    sent = true;
    send(input);
  };
  process.stdin.setEncoding('utf8');
  process.stdin.on('data', (chunk) => {
    if (input.length < MAX_PAYLOAD) input += chunk;
  });
  process.stdin.on('end', flush);
  process.stdin.on('error', flush);
  setTimeout(flush, STDIN_LIMIT_MS);
}
