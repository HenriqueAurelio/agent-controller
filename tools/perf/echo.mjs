// Measures how long a key takes to come back as an echo on the terminal in sight: from the
// keystroke sent by the renderer to the output carrying it arriving there.
//
//   npm run measure:echo -- [--samples 60] [--load 3] [--app <folder>] [--out result.json]
//
// --load N  N more sessions drawing a busy agent screen, so the echo competes with other output.
// --app     another build to open, for a before × after: a folder with its package.json and out/.
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
const samples = Number(option('samples', '60'));
const load = Number(option('load', '0'));
const out = option('out', null);
const appDir = path.resolve(option('app', ROOT));

const userData = fs.mkdtempSync(path.join(os.tmpdir(), 'ac-echo-'));
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
  for (let n = 1; n <= load; n++) {
    const id = await addSession(`Carga ${n}`);
    await page.evaluate(
      ([sid, command]) => window.api.invoke('terminal:input', sid, command),
      [id, `node "${FIXTURE}"\r`],
    );
  }
  const id = await addSession('Eco');
  await sleep(1500);
  const times = await page.evaluate(
    async ([sid, count]) => {
      const result = [];
      for (let i = 0; i < count; i++) {
        const key = String.fromCharCode(97 + (i % 26));
        const started = performance.now();
        await new Promise((resolve) => {
          const off = window.api.on('terminal:data', (from, data) => {
            if (from !== sid || !data.includes(key)) return;
            off();
            resolve();
          });
          void window.api.invoke('terminal:input', sid, key);
        });
        result.push(performance.now() - started);
        // Typing speed of a person, so every key starts from a quiet terminal.
        await new Promise((resolve) => setTimeout(resolve, 80));
        // Keep the prompt line short.
        if (i % 20 === 19) await window.api.invoke('terminal:input', sid, '\u0015');
      }
      return result;
    },
    [id, samples],
  );
  const result = {
    date: new Date().toISOString(),
    platform: process.platform,
    samples,
    load,
    echoMs: { p50: percentile(times, 50), p95: percentile(times, 95), max: percentile(times, 100) },
  };
  console.log(JSON.stringify(result, null, 2));
  if (out) fs.writeFileSync(out, JSON.stringify(result, null, 2) + '\n');
} finally {
  const exited = new Promise((resolve) => app.process().once('exit', resolve));
  await app.close().catch(() => {});
  await exited;
  fs.rmSync(userData, { recursive: true, force: true });
}
