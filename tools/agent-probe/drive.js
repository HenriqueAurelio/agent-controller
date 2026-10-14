// Drives an interactive CLI inside a PTY: scripted keystrokes, screen snapshots, OSC/BEL detection.
// usage: node drive.js <plan.json>
const fs = require('fs');
const pty = require('node-pty');
const { Terminal } = require('@xterm/headless');
const plan = JSON.parse(fs.readFileSync(process.argv[2], 'utf8'));
const cols = 110, rows = 40;
const term = new Terminal({ cols, rows, allowProposedApi: true, scrollback: 2000 });
const t0 = Date.now();
const el = () => ((Date.now() - t0) / 1000).toFixed(1).padStart(5) + 's';
let raw = '';
const baseEnv = Object.fromEntries(Object.entries(process.env).filter(([k]) => !(plan.unsetPrefix && k.toUpperCase().startsWith(plan.unsetPrefix))));
const p = pty.spawn(plan.cmd, plan.args, { name: 'xterm-256color', cols, rows, cwd: plan.cwd, env: { ...baseEnv, ...plan.env } });
p.onData(d => {
  raw += d; term.write(d);
  for (const m of d.matchAll(/\x1b\]([0-9]+);([^\x07\x1b]*)(\x07|\x1b\x5c)/g))
    if (m[1] === '0' || m[1] === '2') {
      // collapse spinner frames: report only transitions of (spinning?, title text)
      const spin = /[⠀-⣿]/.test(m[2]);
      const key = (spin ? 'SPIN ' : 'IDLE ') + m[2].replace(/[⠀-⣿]\s*/g, '').trim();
      if (key !== global.lastTitle) { global.lastTitle = key; console.log(`[${el()}] TITLE ${key}`); }
    } else if (!['10', '11', '12', '4', '8'].includes(m[1])) console.log(`[${el()}] OSC ${m[1]}: ${m[2].slice(0, 160)}`);
  const bare = d.replace(/\x1b\][^\x07\x1b]*(\x07|\x1b\x5c)/g, '');
  if (bare.includes('\x07')) console.log(`[${el()}] BEL`);
  // answer terminal queries so the TUI does not stall
  if (d.includes('\x1b[6n')) p.write('\x1b[1;1R');
  if (d.includes('\x1b[c')) p.write('\x1b[?62;c');
});
const screen = () => {
  const b = term.buffer.active, out = [];
  for (let i = 0; i < b.length; i++) { const l = b.getLine(i).translateToString(true); out.push(l); }
  return out.join('\n').replace(/\n{3,}/g, '\n\n').trim();
};
for (const s of plan.steps) setTimeout(() => {
  if (s.send !== undefined) { console.log(`[${el()}] >>> send ${JSON.stringify(s.send)}`); p.write(s.send); }
  if (s.snap) console.log(`[${el()}] ===== SCREEN (${s.snap}) =====\n${screen()}\n=====`);
}, s.at);
// rules: react to screen content once each: {when, send, delay, snap}
const fired = new Set();
setInterval(() => {
  const s = screen();
  (plan.rules || []).forEach((r, i) => {
    if (fired.has(i) || !s.includes(r.when)) return;
    fired.add(i);
    console.log(`[${el()}] RULE matched ${JSON.stringify(r.when)}`);
    setTimeout(() => {
      if (r.snap) console.log(`[${el()}] ===== SCREEN (${r.snap}) =====\n${screen()}\n=====`);
      if (r.send !== undefined) { console.log(`[${el()}] >>> send ${JSON.stringify(r.send)}`); p.write(r.send); }
    }, r.delay || 300);
  });
}, 400);
p.onExit(e => { console.log(`[${el()}] exit code=${e.exitCode}`); fs.writeFileSync(plan.raw || 'raw.bin', raw); process.exit(0); });
setTimeout(() => { fs.writeFileSync(plan.raw || 'raw.bin', raw); try { p.kill(); } catch {} setTimeout(() => process.exit(0), 500); }, plan.killAt);
