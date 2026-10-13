import fs from 'node:fs';
import path from 'node:path';

/**
 * `fast`: the GPU work runs inside the main process, which saves about 40 MB (ADR 0009).
 * `safe`: the GPU keeps a process of its own and hardware acceleration is off, so a broken or
 * missing video driver cannot take the app down.
 */
export type GpuMode = 'fast' | 'safe';

interface GuardState {
  /** A start in fast mode that has not been confirmed healthy yet. */
  pending?: boolean;
  /** Fast mode failed with this app version; stay safe until the version changes. */
  safeForVersion?: string;
}

const FILE = 'gpu-guard.json';

function read(file: string): GuardState {
  try {
    const data: unknown = JSON.parse(fs.readFileSync(file, 'utf8'));
    return data && typeof data === 'object' ? (data as GuardState) : {};
  } catch {
    return {};
  }
}

function write(file: string, state: GuardState): void {
  try {
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, JSON.stringify(state));
  } catch {
    // Without the marker the guard simply cannot protect the next start.
  }
}

/**
 * Decides how to start, and leaves a marker saying a fast start is under way. If the app dies
 * before `confirmHealthy` is called (the GPU crashed the main process, the window never came
 * up), the marker is still there on the next start, and that start is safe.
 */
export function chooseGpuMode(directory: string, appVersion: string): GpuMode {
  const file = path.join(directory, FILE);
  const state = read(file);
  if (state.pending || state.safeForVersion === appVersion) {
    write(file, { safeForVersion: appVersion });
    return 'safe';
  }
  write(file, { pending: true });
  return 'fast';
}

/** The window came up and stayed up: the fast mode works on this machine. */
export function confirmHealthy(directory: string): void {
  const file = path.join(directory, FILE);
  if (read(file).pending) write(file, {});
}

/** The GPU failed while the app was running: do not try the fast mode again on this version. */
export function reportGpuFailure(directory: string, appVersion: string): void {
  write(path.join(directory, FILE), { safeForVersion: appVersion });
}
