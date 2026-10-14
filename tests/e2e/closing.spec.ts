// Opening the app while it is still closing: ending the sessions takes a few seconds, and the
// process outlives its hidden window for that long.
import { execFileSync, spawn } from 'node:child_process';
import path from 'node:path';
import { expect, test } from '@playwright/test';
import { createSession, launch, removeDir, ROOT, tempDir } from './harness';

let userData: string;
let folder: string;

test.beforeEach(() => {
  userData = tempDir('ac-e2e-data-');
  folder = tempDir('ac-e2e-fechar-');
});
test.afterEach(() => {
  killInstancesOf(userData);
  for (const dir of [userData, folder]) removeDir(dir);
});

interface Proc {
  pid: number;
  ppid: number;
  args: string;
}

function processes(): Proc[] {
  if (process.platform === 'win32') {
    const out = execFileSync(
      'powershell.exe',
      [
        '-NoProfile',
        '-Command',
        "Get-CimInstance Win32_Process | ForEach-Object { '{0} {1} {2}' -f $_.ProcessId, $_.ParentProcessId, $_.CommandLine }",
      ],
      { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 },
    );
    return parse(out);
  }
  return parse(execFileSync('ps', ['-eo', 'pid=,ppid=,args='], { encoding: 'utf8' }));
}

function parse(out: string): Proc[] {
  return out
    .split(/\r?\n/)
    .map((line) => /^\s*(\d+)\s+(\d+)\s+(.*)$/.exec(line))
    .filter((m): m is RegExpExecArray => m !== null)
    .map((m) => ({ pid: Number(m[1]), ppid: Number(m[2]), args: m[3]! }));
}

/** The main process of an instance of the app on this profile: the parent of its utility process. */
function instanceOf(dir: string, other = 0): number | null {
  const utility = processes().find(
    (p) =>
      p.args.includes('--type=utility') && p.args.includes(path.basename(dir)) && p.ppid !== other,
  );
  return utility?.ppid ?? null;
}

function killInstancesOf(dir: string): void {
  const main = instanceOf(dir);
  if (main === null) return;
  try {
    if (process.platform === 'win32') {
      execFileSync('taskkill', ['/PID', String(main), '/T', '/F'], { stdio: 'ignore' });
    } else {
      for (const p of processes())
        if (p.pid === main || p.ppid === main) process.kill(p.pid, 'SIGKILL');
    }
  } catch {
    // Already gone.
  }
}

/** Starts the app the way a user does, outside the test driver. */
function openAgain(): void {
  const packaged = process.env.AGENT_CONTROLLER_EXE;
  const electron =
    packaged ||
    path.join(
      ROOT,
      'node_modules',
      'electron',
      'dist',
      process.platform === 'win32' ? 'electron.exe' : 'electron',
    );
  const args = [
    ...(packaged ? [] : [ROOT]),
    ...(process.platform === 'linux' ? ['--no-sandbox'] : []),
  ];
  spawn(electron, args, {
    env: {
      ...process.env,
      AGENT_CONTROLLER_USER_DATA: userData,
      AGENT_CONTROLLER_AGENTCTL_DIR: path.join(userData, 'bin'),
      AGENT_CONTROLLER_TEST_SHELL: '1',
    },
    stdio: 'ignore',
    detached: process.platform !== 'win32',
  }).unref();
}

test('opened again while closing, the app comes back once it is gone', async () => {
  test.setTimeout(120_000);
  const { app, page } = await launch(userData);
  // A running session holds the closing for a few seconds (ADR 0006).
  await createSession(page, 'Viva', folder);
  const old = await app.evaluate(() => process.pid);
  const gone = new Promise<void>((resolve) => app.process().once('exit', () => resolve()));
  void app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0]!.close());
  await expect
    .poll(() => app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0]!.isVisible()))
    .toBe(false);

  openAgain();
  // The closing window does not come back, only to vanish with its process.
  const shown = await app
    .evaluate(async ({ BrowserWindow }) => {
      await new Promise((resolve) => setTimeout(resolve, 2000));
      return BrowserWindow.getAllWindows().some((w) => !w.isDestroyed() && w.isVisible());
    })
    .catch(() => false);
  expect(shown).toBe(false);

  // The app opens again, on the same profile, after the old one left.
  await gone;
  await expect.poll(() => instanceOf(userData, old), { timeout: 60_000 }).not.toBeNull();
});
