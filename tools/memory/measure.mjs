// Measures the memory of the app itself (main, renderer, GPU and utility processes; not the
// agents running inside it) with 0, 1, 5 and 10 sessions, and with the changes panel open and
// closed again. Compares the result with the ceiling of ADR 0009.
//
//   npm run measure                      sessions run a plain shell
//   npm run measure -- --profile real    real agents, idle (half Claude Code, half Codex)
//   npm run measure -- --exe <path>      measure a packaged app instead of the build in out/
//   npm run measure -- --cwd <folder>    folder of the sessions (default: this repository)
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { _electron } from '@playwright/test';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const CEILING_MB = 450;
const SETTLE_MS = 6000;

const args = process.argv.slice(2);
const option = (name, fallback) => {
  const index = args.indexOf(`--${name}`);
  return index === -1 ? fallback : args[index + 1];
};
const profile = option('profile', 'shell');
const exe = option('exe', process.env.AGENT_CONTROLLER_EXE);
const cwd = path.resolve(option('cwd', ROOT));
const counts = option('sessions', '1,5,10').split(',').map(Number);

const userData = fs.mkdtempSync(path.join(os.tmpdir(), 'ac-measure-'));
const env = Object.fromEntries(
  Object.entries(process.env).filter(([k]) => !/^(ELECTRON_|CLAUDE|AGENTCTL_)/.test(k)),
);
const app = await _electron.launch({
  executablePath: exe || undefined,
  args: [
    ...(exe ? [] : [ROOT]),
    ...(process.platform === 'linux' ? ['--no-sandbox'] : []),
    // Extra Chromium switches, for experiments: --switches "--disable-gpu --foo".
    ...option('switches', '').split(' ').filter(Boolean),
  ],
  env: {
    ...env,
    AGENT_CONTROLLER_USER_DATA: userData,
    AGENT_CONTROLLER_AGENTCTL_DIR: path.join(userData, 'bin'),
    ...(profile === 'shell' ? { AGENT_CONTROLLER_TEST_SHELL: '1' } : {}),
  },
});
const page = await app.firstWindow();
await page.waitForSelector('.sidebar');
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/** Sum over every process of the app, in MB. */
async function measure(label) {
  await sleep(SETTLE_MS);
  const metrics = await app.evaluate(({ app }) =>
    app.getAppMetrics().map((m) => ({
      type: m.type,
      // Kilobytes. Private bytes only exist on Windows.
      workingSet: m.memory.workingSetSize,
      private: m.memory.privateBytes ?? null,
    })),
  );
  const mb = (kb) => Math.round(kb / 1024);
  const byType = {};
  for (const m of metrics) byType[m.type] = (byType[m.type] ?? 0) + m.workingSet;
  const row = {
    label,
    processes: metrics.length,
    workingSetMb: mb(metrics.reduce((sum, m) => sum + m.workingSet, 0)),
    privateMb: metrics.every((m) => m.private !== null)
      ? mb(metrics.reduce((sum, m) => sum + m.private, 0))
      : null,
    byTypeMb: Object.fromEntries(Object.entries(byType).map(([type, kb]) => [type, mb(kb)])),
    mountedTerminals: await page.locator('.terminal-host').count(),
  };
  console.log(
    `${label.padEnd(34)} ${String(row.workingSetMb).padStart(5)} MB working set` +
      (row.privateMb === null ? '' : `  ${String(row.privateMb).padStart(5)} MB private`) +
      `  ${JSON.stringify(row.byTypeMb)}  terminais montados: ${row.mountedTerminals}`,
  );
  return row;
}

let created = 0;
async function addSession() {
  const agent = profile === 'shell' || created % 2 === 0 ? 'claude-code' : 'codex';
  created++;
  const session = await page.evaluate(
    ([cwd, agent, name]) => window.api.invoke('sessions:create', { name, cwd, profile: agent }),
    [cwd, agent, `Sessão ${created}`],
  );
  // A new session is selected, and opening a stopped session starts its agent at the size of its
  // terminal: there is no button for it since the start button left.
  await page.waitForSelector(`.terminal-host.visible[data-session-id="${session.id}"]`);
  await page.waitForFunction(
    (id) =>
      window.api
        .invoke('sessions:list')
        .then(({ sessions }) => sessions.find((s) => s.id === id)?.running === true),
    session.id,
  );
  await sleep(profile === 'shell' ? 500 : 4000);
}

const rows = [];
try {
  rows.push(await measure('app vazio'));
  for (const count of counts) {
    while (created < count) await addSession();
    rows.push(await measure(`${count} ${count === 1 ? 'sessão' : 'sessões'}`));
  }
  await page.keyboard.press('Control+Shift+G');
  await page.waitForSelector('.changes-panel');
  await sleep(3000);
  rows.push(await measure(`${created} sessões + painel de diff`));
  await page.getByRole('button', { name: 'Fechar o painel de mudanças' }).click();
  await page.waitForSelector('.changes-panel', { state: 'detached' });
  rows.push(await measure(`${created} sessões, painel fechado`));
  // Chromium only gives freed memory back when it collects garbage, which it does lazily.
  // Forcing a collection shows what is actually still in use.
  const cdp = await page.context().newCDPSession(page);
  await cdp.send('HeapProfiler.collectGarbage');
  rows.push(await measure(`${created} sessões, fechado (após GC)`));
} finally {
  // Agents still running would stop the app at its "close?" dialog.
  await page
    .evaluate(async () => {
      const { sessions } = await window.api.invoke('sessions:list');
      await Promise.all(sessions.map((s) => window.api.invoke('sessions:stop', s.id)));
    })
    .catch(() => {});
  const exited = new Promise((resolve) => app.process().once('exit', resolve));
  await app.close().catch(() => {});
  await exited;
  fs.rmSync(userData, { recursive: true, force: true, maxRetries: 10, retryDelay: 300 });
}

const worst = Math.max(...rows.map((r) => r.workingSetMb));
const verdict = worst <= CEILING_MB ? 'dentro do teto' : 'ACIMA do teto';
console.log(`\nPior caso: ${worst} MB (${verdict} de ${CEILING_MB} MB da ADR 0009)`);

const outDir = path.join(ROOT, 'tools', 'memory', 'results');
fs.mkdirSync(outDir, { recursive: true });
const file = path.join(outDir, `${process.platform}-${profile}${exe ? '-packaged' : ''}.json`);
fs.writeFileSync(
  file,
  JSON.stringify(
    {
      date: new Date().toISOString(),
      platform: process.platform,
      profile,
      packaged: Boolean(exe),
      ceilingMb: CEILING_MB,
      rows,
    },
    null,
    2,
  ) + '\n',
);
console.log(`Registrado em ${path.relative(ROOT, file)}`);
process.exit(worst <= CEILING_MB ? 0 : 1);
