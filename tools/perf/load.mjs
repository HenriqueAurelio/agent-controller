// Measures how the app copes with sessions that are all drawing at once, as agents at work do.
// Each session runs tools/perf/tui-load.cjs in its shell. Then, in two phases:
//
//   1. CPU, with nothing else going on: the share of one core each process of the app used (not
//      the sessions' own processes), and how much of the main process was its JavaScript.
//   2. Responsiveness: how late the timers of the main process fire (it is the one that answers
//      the interface), how long the interface waits for an answer from it, and how long its
//      frames take. These probes cost CPU themselves, which is why they run apart.
//
//   npm run build && npm run measure:load
//   npm run measure:load -- --sessions 8 --seconds 20 --out result.json
//   npm run measure:load -- --burst        each session also reprints 2000 lines every 3 s
//   npm run measure:load -- --no-load      sessions open and idle: the app at rest
//   npm run measure:load -- --quiet-view   one more session, idle, is the one in sight
//   npm run measure:load -- --app <folder> another build (its package.json and out/)
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
const sessions = Number(option('sessions', '6'));
const seconds = Number(option('seconds', '15'));
const out = option('out', null);
const label = option('label', 'carga');
const burst = args.includes('--burst');
const noLoad = args.includes('--no-load');
const quietView = args.includes('--quiet-view');
// Another build to open, for a before × after: a folder with its package.json and out/.
const appDir = path.resolve(option('app', ROOT));

const userData = fs.mkdtempSync(path.join(os.tmpdir(), 'ac-load-'));
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
const round = (v) => Math.round(v * 10) / 10;

async function addSession(n, load = !noLoad) {
  const session = await page.evaluate(
    ([cwd, name]) => window.api.invoke('sessions:create', { name, cwd, profile: 'claude-code' }),
    [ROOT, `Carga ${n}`],
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
  if (!load) return session.id;
  await page.evaluate(
    ([id, command]) => window.api.invoke('terminal:input', id, command),
    [session.id, `node "${FIXTURE}"${burst ? ' --burst' : ''}\r`],
  );
  return session.id;
}

const percentile = (values, p) => {
  if (!values.length) return null;
  const sorted = [...values].sort((a, b) => a - b);
  return round(sorted[Math.min(sorted.length - 1, Math.floor((p / 100) * sorted.length))]);
};
const spread = (values) => ({
  p50: percentile(values, 50),
  p95: percentile(values, 95),
  max: percentile(values, 100),
});

/** CPU seconds used so far by each process of the app, and by the main JavaScript thread. */
const cpuSnapshot = () =>
  app.evaluate(({ app }) => ({
    processes: app.getAppMetrics().map((m) => ({
      pid: m.pid,
      type: m.type,
      seconds: m.cpu.cumulativeCPUUsage,
      workingSetKb: m.memory.workingSetSize,
    })),
    // Only the thread that runs the main's JavaScript; the rest of the process is Chromium's
    // threads, the GPU when it runs inside it, and ConPTY's readers.
    jsThread: process.threadCpuUsage ? process.threadCpuUsage() : null,
  }));

let result;
try {
  const ids = [];
  for (let n = 1; n <= sessions; n++) ids.push(await addSession(n));
  if (quietView) await addSession(sessions + 1, false);
  // Let every session reach its steady drawing.
  await sleep(4000);
  // A load that did not start would measure an idle app.
  const screen = await page.evaluate((id) => window.api.invoke('terminal:screenText', id), ids[0]);
  if (!noLoad && !screen.includes('●')) {
    throw new Error(`A carga não começou na primeira sessão. Tela:\n${screen}`);
  }

  // Experiments: what the dot of a state costs, whatever state the shells are in.
  const forced = option('force-state', null);
  if (forced) {
    await page.$$eval(
      '.state-dot',
      (dots, state) => dots.forEach((dot) => (dot.className = `state-dot state-${state}`)),
      forced,
    );
  }
  const css = option('css', null);
  if (css) await page.addStyleTag({ content: css });
  if (args.includes('--no-animations')) {
    await page.addStyleTag({ content: '*, *::before, *::after { animation: none !important; }' });
  }
  const states = await page.$$eval('.session-item', (items) =>
    items.map((item) => item.getAttribute('data-state')),
  );

  // Phase 1: CPU, untouched.
  const before = await cpuSnapshot();
  const startedAt = Date.now();
  await sleep(seconds * 1000);
  const after = await cpuSnapshot();
  const elapsed = (Date.now() - startedAt) / 1000;
  const cpuByType = {};
  let cpuTotal = 0;
  for (const m of after.processes) {
    const start = before.processes.find((b) => b.pid === m.pid)?.seconds ?? 0;
    const share = ((m.seconds - start) / elapsed) * 100;
    cpuByType[m.type] = (cpuByType[m.type] ?? 0) + share;
    cpuTotal += share;
  }
  const jsSeconds =
    before.jsThread && after.jsThread
      ? (after.jsThread.user -
          before.jsThread.user +
          after.jsThread.system -
          before.jsThread.system) /
        1e6
      : null;

  // Phase 2: responsiveness.
  await app.evaluate(() => {
    // Event loop utilisation reads 0 in Electron's main process, whose loop is driven by
    // Chromium: the lag of a 10 ms timer shows the same thing, how long the main takes to answer.
    const lags = [];
    let expected = performance.now() + 10;
    globalThis.__loadLags = lags;
    globalThis.__loadTimer = setInterval(() => {
      const now = performance.now();
      lags.push(Math.max(0, now - expected));
      expected = now + 10;
    }, 10);
  });
  const { ipc, frames } = await page.evaluate(
    async (ms) => {
      const ipc = [];
      const frames = [];
      const end = performance.now() + ms;
      let last = performance.now();
      let drawing = true;
      const frame = (now) => {
        frames.push(now - last);
        last = now;
        if (drawing) requestAnimationFrame(frame);
      };
      requestAnimationFrame(frame);
      while (performance.now() < end) {
        const start = performance.now();
        await window.api.invoke('sessions:list');
        ipc.push(performance.now() - start);
        await new Promise((resolve) => setTimeout(resolve, 50));
      }
      drawing = false;
      return { ipc, frames };
    },
    Math.min(seconds, 10) * 1000,
  );
  const lags = await app.evaluate(() => {
    clearInterval(globalThis.__loadTimer);
    return globalThis.__loadLags;
  });

  result = {
    label,
    date: new Date().toISOString(),
    platform: process.platform,
    sessions,
    seconds,
    burst,
    noLoad,
    quietView,
    states,
    cpuPercentByType: Object.fromEntries(Object.entries(cpuByType).map(([k, v]) => [k, round(v)])),
    cpuPercentTotal: round(cpuTotal),
    mainJsThreadCpuPercent: jsSeconds === null ? null : round((jsSeconds / elapsed) * 100),
    workingSetMb: Math.round(after.processes.reduce((sum, m) => sum + m.workingSetKb, 0) / 1024),
    mainTimerLagMs: spread(lags),
    ipcRoundTripMs: spread(ipc),
    frameMs: spread(frames),
  };
  console.log(JSON.stringify(result, null, 2));
  if (out) fs.writeFileSync(out, JSON.stringify(result, null, 2) + '\n');
} finally {
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
