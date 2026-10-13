import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

export const FIXTURES = path.resolve(__dirname, '../fixtures');
export const AGENTCTL_SCRIPT = path.resolve(__dirname, '../../resources/agentctl/agentctl.cjs');

export function tempDir(prefix = 'agent-controller-'): string {
  // realpath: macOS and some CI images hand out a symlinked temp folder.
  return fs.realpathSync.native(fs.mkdtempSync(path.join(os.tmpdir(), prefix)));
}

export function removeDir(dir: string): void {
  fs.rmSync(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
}

export async function waitFor<T>(
  check: () => T | Promise<T>,
  { timeout = 10000, interval = 25, message = 'condição não atingida' } = {},
): Promise<NonNullable<T>> {
  const deadline = Date.now() + timeout;
  for (;;) {
    const value = await check();
    if (value) return value as NonNullable<T>;
    if (Date.now() > deadline) throw new Error(`waitFor: ${message}`);
    await new Promise((resolve) => setTimeout(resolve, interval));
  }
}

export const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));
