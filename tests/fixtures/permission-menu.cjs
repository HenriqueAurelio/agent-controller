// A stand-in for an agent asking permission: draws a menu like Claude Code's, calls agentctl the
// way its PermissionRequest hook would, and prints the first key it gets.
//
//   node permission-menu.cjs [--sem-sempre] <tool> <target...>
//
// A file named `limpar` in the current folder makes it leave the menu, as an agent that moved on;
// it keeps listening, so a key written after that still shows up.
'use strict';
const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

const args = process.argv.slice(2);
const always = args[0] !== '--sem-sempre';
if (!always) args.shift();
const tool = args[0] || 'Bash';
const target = args.slice(1).join(' ');
const input = /^(Edit|Write|MultiEdit|Read)$/.test(tool)
  ? { file_path: target }
  : target
    ? { command: target }
    : undefined;

const agentctl =
  process.env.FAKE_AGENTCTL ||
  path.join(__dirname, '..', '..', 'resources', 'agentctl', 'agentctl.cjs');
const out = (text) => process.stdout.write(text.replace(/\n/g, '\r\n'));

out(`\n ${tool}\n\n   ${target}\n\n Do you want to proceed?\n ❯ 1. Yes\n`);
if (always) out(`   2. Yes, and don't ask again for ${target.split(' ')[0]} commands\n`);
out(`   ${always ? 3 : 2}. No, and tell Claude what to do differently (esc)\n`);

spawnSync(
  process.execPath,
  [
    agentctl,
    'claude-hook',
    JSON.stringify({
      hook_event_name: 'PermissionRequest',
      tool_name: tool,
      ...(input && { tool_input: input }),
    }),
  ],
  { env: { ...process.env, ELECTRON_RUN_AS_NODE: '1' }, stdio: 'ignore' },
);

const marker = path.join(process.cwd(), 'limpar');
const poll = setInterval(() => {
  if (!fs.existsSync(marker)) return;
  clearInterval(poll);
  out('\x1b[2J\x1b[H o agente seguiu sozinho\n');
}, 50);
const giveUp = setTimeout(() => process.exit(0), 120_000);

if (process.stdin.isTTY) process.stdin.setRawMode(true);
process.stdin.once('data', (data) => {
  const key = data.toString('utf8');
  out(`\n resposta: ${key === '\x1b' ? 'esc' : key}\n`);
  clearInterval(poll);
  clearTimeout(giveUp);
  // Back to the shell (or out of the session) once the answer is seen.
  setTimeout(() => process.exit(0), 100);
});
