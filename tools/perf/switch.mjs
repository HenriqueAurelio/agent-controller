// Measures going back to a session that kept working out of sight: from the click on it in the
// list to its terminal drawn with what it wrote meanwhile.
//
//   node tools/perf/switch.mjs [--switches 20] [--app <folder>] [--no-resync] [--out result.json]
//
// --no-resync  for a build from before terminals out of sight were parked: being shown is all
//              it takes there.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { _electron } from '@playwright/test';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const FIXTURE = path.join(ROOT, 'tools', 'perf', 'tui-load.cjs').replaceAll('\\', '/');

const args = process.argv.slice(2);
const option = (name, fallback) => {
  const index = args.indexOf(`--${name}`);
  return index === -1 ? fallback : args[index + 1];
};
const switches = Number(option('switches', '20'));
const out = option('out', null);
const appDir = path.resolve(option('app', ROOT));
const resync = !args.includes('--no-resync');

const userData = fs.mkdtempSync(path.join(os.tmpdir(), 'ac-switch-'));
const env = Object.fromEntries(
  Object.entries(process.env).filter(([k]) => !/^(ELECTRON_|CLAUDE|AGENTCTL_)/.test(k)),
);
const app = await _electron.launch({
  args: [appDir, ...(process.platform === 'linux' ? ['--no-sandbox'] : [])],
  env: {
    ...env,
    AGENT_CONTROLLER_USER_DATA: userData,
    AGENT_CONTROLLER_AGENTCTL_DIR: path.join(userData, 'bin'),
    AGENT_CONTROLLER_TEST_SHELL: '1',
  },
});
const page = await app.firstWindow();
await page.waitForSelector('.sidebar');
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function addSession(name) {
  const session = await page.evaluate(
    ([cwd, n]) => window.api.invoke('sessions:create', { name: n, cwd, profile: 'claude-code' }),
    [ROOT, name],
  );
  await page.waitForSelector(`.terminal-host.visible[data-session-id="${session.id}"]`);
  await page.waitForFunction(
    (id) =>
      window.api
        .invoke('sessions:list')
        .then(({ sessions }) => sessions.find((s) => s.id === id)?.running === true),
    session.id,
  );
  await sleep(500);
  return session.id;
}

const percentile = (values, p) => {
  const sorted = [...values].sort((a, b) => a - b);
  const value = sorted[Math.min(sorted.length - 1, Math.floor((p / 100) * sorted.length))];
  return Math.round(value * 10) / 10;
};

try {
  // Two sessions drawing a busy agent screen; the list switches between them.
  const ids = [];
  for (const name of ['Carga A', 'Carga B']) {
    const id = await addSession(name);
    await page.evaluate(
      ([sid, command]) => window.api.invoke('terminal:input', sid, command),
      [id, `node "${FIXTURE}"\r`],
    );
    ids.push(id);
  }
  await sleep(2000);
  const times = [];
  for (let i = 0; i < switches; i++) {
    const id = ids[i % 2];
    // Long enough out of sight to have missed output.
    await sleep(600);
    const ms = await page.evaluate(
      async ([sid, waitResync]) => {
        const host = document.querySelector(`.terminal-host[data-session-id="${sid}"]`);
        const before = host?.dataset.resyncs;
        const started = performance.now();
        document.querySelector(`.session-item[data-session-id="${sid}"]`).click();
        // Shown, caught up if it had to (a new resync time), and two frames drawn.
        for (;;) {
          await new Promise((resolve) => requestAnimationFrame(resolve));
          const shown = host?.classList.contains('visible');
          const resynced = !waitResync || host?.dataset.resyncs !== before;
          if (shown && resynced) break;
          if (performance.now() - started > 2000) break;
        }
        await new Promise((resolve) => requestAnimationFrame(resolve));
        return performance.now() - started;
      },
      [id, resync],
    );
    times.push(ms);
  }
  const result = {
    date: new Date().toISOString(),
    platform: process.platform,
    switches,
    switchMs: {
      p50: percentile(times, 50),
      p95: percentile(times, 95),
      max: percentile(times, 100),
    },
  };
  console.log(JSON.stringify(result, null, 2));
  if (out) fs.writeFileSync(out, JSON.stringify(result, null, 2) + '\n');
} finally {
  const exited = new Promise((resolve) => app.process().once('exit', resolve));
  await app.close().catch(() => {});
  await exited;
  fs.rmSync(userData, { recursive: true, force: true });
}
