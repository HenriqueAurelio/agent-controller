import { execFile } from 'node:child_process';
import fs from 'node:fs';
import { descendantsOf, snapshotProcesses, type ProcessTable } from '../metrics/processTree';

/** A zombie still answers to signal 0; on Linux its state in /proc tells it apart. */
function isZombie(pid: number): boolean {
  if (process.platform !== 'linux') return false;
  try {
    const stat = fs.readFileSync(`/proc/${pid}/stat`, 'utf8');
    const state = stat.slice(stat.lastIndexOf(')') + 2, stat.lastIndexOf(')') + 3);
    return state === 'Z' || state === 'X';
  } catch {
    return true; // Gone between the two checks.
  }
}

export function isAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code !== 'EPERM') return false;
  }
  return !isZombie(pid);
}

function taskkill(pid: number): Promise<void> {
  return new Promise((resolve) => {
    execFile('taskkill', ['/PID', String(pid), '/T', '/F'], { windowsHide: true }, () => resolve());
  });
}

function signal(pid: number, sig: NodeJS.Signals): void {
  try {
    process.kill(pid, sig);
  } catch {
    // Already gone.
  }
}

const delay = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

/**
 * Forcefully ends `pid` and everything it started. The descendants are listed before anything is
 * killed: once a parent dies, its children are re-parented and the tree can no longer be walked.
 */
export async function killProcessTree(
  pid: number,
  options: { table?: ProcessTable; termGraceMs?: number } = {},
): Promise<void> {
  const table = options.table ?? (await snapshotProcesses().catch(() => new Map()));
  const tree = descendantsOf(table, pid);
  if (!tree.includes(pid)) tree.unshift(pid);

  if (process.platform === 'win32') {
    await taskkill(pid);
    // Whatever escaped taskkill's parent-child walk.
    await Promise.all(tree.filter((p) => p !== pid && isAlive(p)).map((p) => taskkill(p)));
    return;
  }

  // node-pty starts the child as a session leader, so its pid is also the process group id.
  signal(-pid, 'SIGTERM');
  for (const p of tree) signal(p, 'SIGTERM');
  const deadline = Date.now() + (options.termGraceMs ?? 800);
  while (Date.now() < deadline && tree.some(isAlive)) await delay(50);
  signal(-pid, 'SIGKILL');
  for (const p of tree) if (isAlive(p)) signal(p, 'SIGKILL');
}
