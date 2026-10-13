// A stand-in for an agent: sets window titles like Claude Code does and calls agentctl the way
// its hooks would. Driven by lines on stdin: work | perm | cancel | spam <n> | exit <code>.
'use strict';
const { spawnSync } = require('child_process');
const readline = require('readline');

const title = (t) => process.stdout.write(`\x1b]0;${t}\x07`);
const hook = (payload) =>
  spawnSync(process.execPath, [process.env.FAKE_AGENTCTL, 'claude-hook'], {
    input: JSON.stringify(payload),
    env: { ...process.env, ELECTRON_RUN_AS_NODE: '1' },
  });
const spin = (ms, then) => {
  const frames = ['◐', '◑'];
  let i = 0;
  const timer = setInterval(() => title(`${frames[i++ % 2]} tarefa`), 40);
  setTimeout(() => {
    clearInterval(timer);
    then();
  }, ms);
};

hook({ hook_event_name: 'SessionStart' });
title('✳ Fake Agent');
process.stdout.write('pronto> ');

readline.createInterface({ input: process.stdin }).on('line', (line) => {
  const [command, arg] = line.trim().split(/\s+/);
  if (command === 'work') {
    spin(600, () => {
      process.stdout.write('feito\r\n');
      hook({ hook_event_name: 'Stop' });
      title('✳ Fake Agent');
    });
  } else if (command === 'perm') {
    spin(250, () => {
      hook({ hook_event_name: 'PermissionRequest', tool_name: 'Bash' });
      title('✳ Fake Agent');
    });
  } else if (command === 'cancel') {
    spin(250, () => title('✳ Fake Agent'));
  } else if (command === 'spam') {
    const row = 'x'.repeat(200) + '\r\n';
    for (let i = 0; i < Number(arg || 1000); i++) process.stdout.write(row);
    process.stdout.write('fim-do-spam\r\n');
  } else if (command === 'exit') {
    process.exit(Number(arg || 0));
  }
});
