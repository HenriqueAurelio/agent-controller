// Starts a child that starts a grandchild, prints their pids and then idles.
'use strict';
const { spawn } = require('child_process');
const depth = Number(process.argv[2] || 0);
if (depth < 2) {
  const child = spawn(process.execPath, [__filename, String(depth + 1)], {
    stdio: ['ignore', 'pipe', 'inherit'],
  });
  child.stdout.on('data', (d) => process.stdout.write(d));
}
process.stdout.write(`PID${depth}=${process.pid}\n`);
setInterval(() => {}, 1000);
