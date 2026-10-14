import fs from 'node:fs';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { chooseGpuMode, confirmHealthy, reportGpuFailure } from '@core/store/gpuGuard';
import { removeDir, tempDir } from './helpers';

let dir: string;
beforeEach(() => (dir = tempDir()));
afterEach(() => removeDir(dir));

describe('gpuGuard', () => {
  it('starts fast, and keeps starting fast while each start is confirmed healthy', () => {
    expect(chooseGpuMode(dir, '1.0.0')).toBe('fast');
    confirmHealthy(dir);
    expect(chooseGpuMode(dir, '1.0.0')).toBe('fast');
    confirmHealthy(dir);
    expect(chooseGpuMode(dir, '1.0.0')).toBe('fast');
  });

  it('a start that never became healthy makes the next ones safe', () => {
    expect(chooseGpuMode(dir, '1.0.0')).toBe('fast');
    // The app crashed here: no confirmation.
    expect(chooseGpuMode(dir, '1.0.0')).toBe('safe');
    confirmHealthy(dir);
    expect(chooseGpuMode(dir, '1.0.0')).toBe('safe');
  });

  it('a GPU failure while running makes the next starts safe', () => {
    expect(chooseGpuMode(dir, '1.0.0')).toBe('fast');
    confirmHealthy(dir);
    reportGpuFailure(dir, '1.0.0');
    expect(chooseGpuMode(dir, '1.0.0')).toBe('safe');
  });

  it('a new app version gets another chance at the fast mode', () => {
    chooseGpuMode(dir, '1.0.0');
    expect(chooseGpuMode(dir, '1.0.0')).toBe('safe');
    expect(chooseGpuMode(dir, '1.1.0')).toBe('fast');
  });

  it('a corrupted marker does not stop the app from starting', () => {
    fs.writeFileSync(path.join(dir, 'gpu-guard.json'), '{ lixo');
    expect(chooseGpuMode(dir, '1.0.0')).toBe('fast');
  });

  it('works when the data folder does not exist yet', () => {
    expect(chooseGpuMode(path.join(dir, 'ainda', 'nao', 'existe'), '1.0.0')).toBe('fast');
  });
});
