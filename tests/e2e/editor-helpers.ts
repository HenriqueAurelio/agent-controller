// What the tests and the evidences of "Open in editor" share: a `code` that only records what it
// was asked to open (a .cmd shim on Windows, like the real one), and a way to read that record.
import fs from 'node:fs';
import path from 'node:path';
import { expect } from '@playwright/test';
import { ROOT, tempDir } from './harness';

export const FAKE_EDITOR = path.join(ROOT, 'tests', 'fixtures', 'fake-editor.cjs');

export interface FakeEditor {
  /** Goes in front of the PATH of the app. */
  binDir: string;
  /** The file the arguments of every call are appended to, one JSON array per line. */
  log: string;
  /** The environment to launch the app with. */
  env: Record<string, string>;
}

export function makeFakeCode(): FakeEditor {
  const binDir = tempDir('ac-e2e-bin-');
  const log = path.join(binDir, 'calls.log');
  if (process.platform === 'win32') {
    fs.writeFileSync(
      path.join(binDir, 'code.cmd'),
      `@echo off\r\nnode "${FAKE_EDITOR}" "${log}" %*\r\n`,
    );
  } else {
    const shim = path.join(binDir, 'code');
    fs.writeFileSync(shim, `#!/bin/sh\nexec node "${FAKE_EDITOR}" "${log}" "$@"\n`);
    fs.chmodSync(shim, 0o755);
  }
  // The name of the variable is `Path` on Windows: a second spelling would be a second variable.
  const key = Object.keys(process.env).find((k) => k.toLowerCase() === 'path') ?? 'PATH';
  return { binDir, log, env: { [key]: `${binDir}${path.delimiter}${process.env[key] ?? ''}` } };
}

/** The calls recorded so far, once there are at least `count` of them. */
export async function calls(log: string, count: number): Promise<string[][]> {
  let lines: string[][] = [];
  await expect
    .poll(
      () => {
        lines = fs.existsSync(log)
          ? fs
              .readFileSync(log, 'utf8')
              .split('\n')
              .filter(Boolean)
              .map((line) => JSON.parse(line) as string[])
          : [];
        return lines.length;
      },
      { timeout: 20_000 },
    )
    .toBeGreaterThanOrEqual(count);
  return lines;
}
