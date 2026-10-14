// Opens the built app with a throwaway profile, creates one real session and prints its state
// and screen for a few seconds. No prompt is sent.
// usage: node tools/debug-session.mjs <claude-code|codex> [folder]
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { _electron } from '@playwright/test';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const profile = process.argv[2] ?? 'claude-code';
const cwd = path.resolve(process.argv[3] ?? root);
const userData = fs.mkdtempSync(path.join(os.tmpdir(), 'ac-debug-'));
const env = Object.fromEntries(
  Object.entries(process.env).filter(([k]) => !/^(ELECTRON_|CLAUDE|AGENTCTL_)/.test(k)),
);
const exe = process.env.AGENT_CONTROLLER_EXE || undefined;
const app = await _electron.launch({
  executablePath: exe,
  args: exe ? [] : [root],
  env: {
    ...env,
    AGENT_CONTROLLER_USER_DATA: userData,
    AGENT_CONTROLLER_AGENTCTL_DIR: path.join(userData, 'bin'),
  },
});
app.process().stderr.on('data', (d) => process.stdout.write(`[main:err] ${d}`));
const page = await app.firstWindow();
page.on('pageerror', (e) => console.log(`[renderer:error] ${e.message}`));
await page.waitForSelector('.sidebar');
console.log(
  'agentes:',
  JSON.stringify(await page.evaluate(() => window.api.invoke('agents:detect', true))),
);
const session = await page.evaluate(
  ([cwd, profile]) => window.api.invoke('sessions:create', { name: 'debug', cwd, profile }),
  [cwd, profile],
);
await page.waitForTimeout(500);
await page.evaluate(
  (id) => window.api.invoke('sessions:start', id, { cols: 110, rows: 40 }),
  session.id,
);
for (let i = 0; i < 4; i++) {
  await page.waitForTimeout(2000);
  const list = await page.evaluate(() => window.api.invoke('sessions:list'));
  console.log('estado:', JSON.stringify(list.sessions[0].status), 'hooks:', list.sessions[0].hooks);
}
console.log(
  'tela:\n' +
    (await page.evaluate((id) => window.api.invoke('terminal:screenText', id), session.id)),
);
for (const file of fs.readdirSync(path.join(userData, 'bin'))) {
  console.log(`--- ${file}`);
  if (!file.endsWith('.cjs'))
    console.log(fs.readFileSync(path.join(userData, 'bin', file), 'utf8'));
}
if (process.argv[4]) await page.screenshot({ path: process.argv[4] });
await page.evaluate((id) => window.api.invoke('sessions:stop', id), session.id);
await page.waitForTimeout(1500);
await app.close().catch(() => {});
fs.rmSync(userData, { recursive: true, force: true, maxRetries: 10, retryDelay: 300 });
