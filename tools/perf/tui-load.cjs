// Draws like an agent at work: a TUI that erases its last frame and paints a new one with
// colours and a spinner, 20 times a second, and now and then lets a line scroll into the
// history. Used by `npm run measure:load`; it never ends on its own.
//
// With `--burst`, every 3 s it also clears the screen and prints the whole "conversation" again,
// 2000 lines, the way Claude Code redraws its transcript after a resize or a compaction.
'use strict';

const FPS = Number(process.env.LOAD_FPS || 20);
const LINES = Number(process.env.LOAD_LINES || 30);
const SPINNER = ['⠋', '⠙', '⠹', '⠸', '⠼', '⠴', '⠦', '⠧', '⠇', '⠏'];
const WORDS =
  'lendo arquivo src/core/sessions/SessionManager.ts aplicando edição testes passaram'.split(' ');

let frame = 0;
let drawn = 0;

function line(i) {
  const words = [];
  for (let w = 0; w < 12; w++) words.push(WORDS[(i * 7 + w + frame) % WORDS.length]);
  const colour = 31 + ((i + frame) % 6);
  return `\x1b[${colour}m●\x1b[0m \x1b[1m${String(i).padStart(2)}\x1b[22m ${words.join(' ')}`;
}

function draw() {
  frame++;
  let out = '';
  // Back to the start of the previous frame, clearing it, the way Ink does.
  for (let i = 0; i < drawn; i++) out += '\x1b[2K\x1b[1A';
  if (drawn) out += '\x1b[2K\r';
  // One line in five frames is "finished" and stays above the live area.
  if (frame % 5 === 0) out += `\x1b[90m✓ passo ${frame / 5} concluído\x1b[0m\r\n`;
  for (let i = 0; i < LINES; i++) out += line(i) + '\r\n';
  out += `\x1b[33m${SPINNER[frame % SPINNER.length]}\x1b[0m Pensando… (${frame} quadros)`;
  drawn = LINES;
  process.stdout.write(out);
}

function burst() {
  let out = '\x1b[2J\x1b[3J\x1b[H';
  for (let i = 0; i < 2000; i++) out += line(i % 100) + '\r\n';
  drawn = 0;
  process.stdout.write(out);
}

setInterval(draw, 1000 / FPS);
if (process.argv.includes('--burst')) setInterval(burst, 3000);
