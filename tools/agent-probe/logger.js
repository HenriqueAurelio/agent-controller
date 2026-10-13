// Records how it was called: label, argv, stdin and the session env var.
const fs = require('fs');
const path = require('path');
const out = path.join(__dirname, 'events.log');
let stdin = '';
const done = () => {
  fs.appendFileSync(out, JSON.stringify({
    t: new Date().toISOString(),
    argv: process.argv.slice(2),
    stdin: stdin.slice(0, 1500),
    session: process.env.AGENTCTL_SESSION_ID || null,
  }) + '\n');
  process.exit(0);
};
process.stdin.on('data', d => { stdin += d; });
process.stdin.on('end', done);
setTimeout(done, 800);
