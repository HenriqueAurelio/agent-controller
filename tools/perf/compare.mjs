// Runs the scenarios of load.mjs against two builds and prints a before × after table, each
// number the mean of a few runs.
//
//   node tools/perf/compare.mjs --before <folder> [--after <folder>] [--runs 2] [--out file.json]
//
// <folder> holds a build: its package.json and out/ (the default for --after is this repository).
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '../..');
const args = process.argv.slice(2);
const option = (name, fallback) => {
  const index = args.indexOf(`--${name}`);
  return index === -1 ? fallback : args[index + 1];
};
const before = option('before', null);
if (!before) throw new Error('Informe o build de antes com --before <pasta>.');
const after = option('after', ROOT);
const runs = Number(option('runs', '2'));
const sessions = option('sessions', '6');
const seconds = option('seconds', '12');

const SCENARIOS = [
  { name: 'parado', flags: ['--no-load'] },
  { name: 'carga no fundo', flags: ['--quiet-view'] },
  { name: 'carga visível', flags: [] },
  { name: 'rajada', flags: ['--burst'] },
];

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'ac-compare-'));
const measure = (app, flags) => {
  const file = path.join(tmp, 'run.json');
  execFileSync(
    process.execPath,
    [
      path.join(HERE, 'load.mjs'),
      '--app',
      app,
      '--sessions',
      sessions,
      '--seconds',
      seconds,
      '--out',
      file,
      ...flags,
    ],
    { stdio: ['ignore', 'ignore', 'inherit'] },
  );
  return JSON.parse(fs.readFileSync(file, 'utf8'));
};
const mean = (values) => values.reduce((sum, v) => sum + v, 0) / values.length;
const summary = (results) => ({
  cpuTotal: mean(results.map((r) => r.cpuPercentTotal)),
  cpuMainJs: mean(results.map((r) => r.mainJsThreadCpuPercent ?? 0)),
  cpuRenderer: mean(results.map((r) => r.cpuPercentByType.Tab ?? 0)),
  memoryMb: mean(results.map((r) => r.workingSetMb)),
  ipcP95: mean(results.map((r) => r.ipcRoundTripMs.p95)),
  frameP95: mean(results.map((r) => r.frameMs.p95)),
});

const table = [];
for (const scenario of SCENARIOS) {
  const row = { scenario: scenario.name };
  for (const [side, app] of [
    ['antes', before],
    ['depois', after],
  ]) {
    const results = [];
    for (let i = 0; i < runs; i++) results.push(measure(app, scenario.flags));
    row[side] = summary(results);
    console.error(`${scenario.name} / ${side}: ${JSON.stringify(row[side])}`);
  }
  table.push(row);
}
fs.rmSync(tmp, { recursive: true, force: true });

const f = (v) => (Math.round(v * 10) / 10).toString().replace('.', ',');
const lines = [
  `${sessions} sessões, ${seconds} s por medição, média de ${runs} rodadas. CPU em % de um núcleo.`,
  '',
  '| Cenário | CPU total | JS do main | Interface | Memória (MB) | IPC p95 (ms) | Quadro p95 (ms) |',
  '|---|---|---|---|---|---|---|',
  ...table.map(
    ({ scenario, antes: a, depois: d }) =>
      `| ${scenario} | ${f(a.cpuTotal)} → **${f(d.cpuTotal)}** | ${f(a.cpuMainJs)} → ${f(d.cpuMainJs)} | ` +
      `${f(a.cpuRenderer)} → ${f(d.cpuRenderer)} | ${Math.round(a.memoryMb)} → ${Math.round(d.memoryMb)} | ` +
      `${f(a.ipcP95)} → ${f(d.ipcP95)} | ${f(a.frameP95)} → ${f(d.frameP95)} |`,
  ),
];
console.log(lines.join('\n'));
const out = option('out', null);
if (out) fs.writeFileSync(out, JSON.stringify({ sessions, seconds, runs, table }, null, 2) + '\n');
