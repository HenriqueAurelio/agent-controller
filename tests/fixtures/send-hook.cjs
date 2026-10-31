// Calls agentctl the way a Claude Code hook would, naming a conversation file:
//
//   node send-hook.cjs <event> <transcript.jsonl>
'use strict';
const path = require('path');
const { spawnSync } = require('child_process');

const [event = 'Stop', transcript] = process.argv.slice(2);
const agentctl =
  process.env.FAKE_AGENTCTL ||
  path.join(__dirname, '..', '..', 'resources', 'agentctl', 'agentctl.cjs');

spawnSync(
  process.execPath,
  [
    agentctl,
    'claude-hook',
    JSON.stringify({ hook_event_name: event, transcript_path: transcript }),
  ],
  { stdio: 'ignore', env: { ...process.env, ELECTRON_RUN_AS_NODE: '1' } },
);
process.stdout.write(`hook ${event} enviado\r\n`);
