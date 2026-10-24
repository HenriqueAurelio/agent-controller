import { spawn } from 'node:child_process';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { computeMetrics, MetricsSampler } from '@core/metrics/MetricsSampler';
import {
  createProcessReader,
  descendantsOf,
  parseWindowsRows,
  type ProcessInfo,
  type ProcessTable,
  type WindowsProcessSource,
} from '@core/metrics/processTree';
import { killProcessTree } from '@core/pty/killTree';
import type { SessionMetrics } from '@shared/ipc';
import { FIXTURES, waitFor } from './helpers';

const MB = 1024 * 1024;
const table = (
  rows: [pid: number, ppid: number, memoryMb: number, cpuMs: number][],
): ProcessTable =>
  new Map(
    rows.map(([pid, ppid, mb, cpuTimeMs]) => [
      pid,
      { pid, ppid, memory: mb * MB, cpuTimeMs } as ProcessInfo,
    ]),
  );

describe('process tree', () => {
  const sample = table([
    [1, 0, 1, 0],
    [10, 1, 100, 0],
    [11, 10, 50, 0],
    [12, 11, 25, 0],
    [20, 1, 300, 0],
    [21, 20, 10, 0],
  ]);

  it('lists a process and all its descendants', () => {
    expect(descendantsOf(sample, 10).sort()).toEqual([10, 11, 12]);
    expect(descendantsOf(sample, 12)).toEqual([12]);
    expect(descendantsOf(sample, 999)).toEqual([999]);
  });

  it('does not loop on a cycle left by pid reuse', () => {
    const cyclic = table([
      [5, 6, 1, 0],
      [6, 5, 1, 0],
    ]);
    expect(descendantsOf(cyclic, 5).sort()).toEqual([5, 6]);
  });

  it('parses the rows of the Windows helper', () => {
    const parsed = parseWindowsRows([
      '4,0,1048576,10000000,20000000',
      '120,4,2097152,0,5000',
      'lixo',
      '',
    ]);
    expect([...parsed.values()]).toEqual([
      { pid: 4, ppid: 0, memory: MB, cpuTimeMs: 3000 },
      { pid: 120, ppid: 4, memory: 2 * MB, cpuTimeMs: 0.5 },
    ]);
  });
});

describe('computeMetrics', () => {
  const roots = new Map([
    ['leve', 10],
    ['pesada', 20],
  ]);

  it('sums memory and CPU over the tree of each session', () => {
    const before = table([
      [10, 1, 100, 1000],
      [11, 10, 50, 500],
      [20, 1, 300, 0],
    ]);
    const after = table([
      [10, 1, 110, 1500],
      [11, 10, 60, 1500],
      [20, 1, 320, 4000],
      [21, 20, 80, 1000],
    ]);
    const metrics = computeMetrics(roots, after, { table: before, at: 0 }, 5000);
    expect(metrics.leve).toEqual({ memory: 170 * MB, processes: 2, cpu: 30 });
    // Process 21 started between the samples: all its CPU time counts. 5 s on a 5 s window.
    expect(metrics.pesada).toEqual({ memory: 400 * MB, processes: 2, cpu: 100 });
  });

  it('the first sample has memory but no CPU', () => {
    const metrics = computeMetrics(roots, table([[10, 1, 100, 99999]]), null, 1000);
    expect(metrics.leve).toEqual({ memory: 100 * MB, processes: 1, cpu: 0 });
    expect(metrics.pesada).toEqual({ memory: 0, processes: 0, cpu: 0 });
  });
});

describe('MetricsSampler', () => {
  it('reads the whole table once per sample, whatever the number of sessions', async () => {
    let snapshots = 0;
    let disposed = 0;
    let roots = new Map([
      ['a', 10],
      ['b', 20],
      ['c', 30],
    ]);
    const samples: Record<string, SessionMetrics>[] = [];
    const sampler = new MetricsSampler({
      roots: () => roots,
      onSample: (m) => samples.push(m),
      reader: {
        snapshot: async () => {
          snapshots++;
          return table([
            [10, 1, 1, 0],
            [20, 1, 2, 0],
            [30, 1, 3, 0],
          ]);
        },
        dispose: () => disposed++,
      },
    });
    await sampler.sample();
    await sampler.sample();
    expect(snapshots).toBe(2);
    expect(Object.keys(samples[0]!)).toEqual(['a', 'b', 'c']);

    // No session running: no sampling at all, and the helper is released.
    roots = new Map();
    await sampler.sample();
    expect(snapshots).toBe(2);
    expect(disposed).toBe(1);
  });

  const sources: (WindowsProcessSource | undefined)[] =
    process.platform === 'win32' ? ['native', 'wmi'] : [undefined];

  it.runIf(process.platform === 'win32')(
    'on Windows, the native table and WMI see the same processes',
    async () => {
      const native = createProcessReader({ windowsSource: 'native' });
      const wmi = createProcessReader({ windowsSource: 'wmi' });
      try {
        const [a, b] = await Promise.all([native.snapshot(), wmi.snapshot()]);
        const me = a.get(process.pid);
        expect(me?.ppid).toBe(b.get(process.pid)?.ppid);
        expect(me!.memory).toBeGreaterThan(10 * MB);
        expect(me!.cpuTimeMs).toBeGreaterThan(0);
        // Taken a moment apart, the tables differ only by what started or ended in between.
        const common = [...a.keys()].filter((pid) => b.has(pid)).length;
        expect(common / Math.max(a.size, b.size)).toBeGreaterThan(0.9);
      } finally {
        native.dispose();
        wmi.dispose();
      }
    },
    60000,
  );

  it.each(sources)(
    'measures a real process tree (%s)',
    async (windowsSource) => {
      const child = spawn(process.execPath, [path.join(FIXTURES, 'spawn-tree.cjs')], {
        stdio: ['ignore', 'pipe', 'ignore'],
      });
      let out = '';
      child.stdout.on('data', (d) => (out += d));
      const reader = createProcessReader({ windowsSource });
      try {
        await waitFor(() => (out.match(/PID\d=/g) ?? []).length === 3);
        const snapshot = await reader.snapshot();
        const metrics = computeMetrics(new Map([['s', child.pid!]]), snapshot, null, Date.now());
        expect(metrics.s!.processes).toBe(3);
        // Three idle Node processes: tens of megabytes each, not kilobytes and not gigabytes.
        expect(metrics.s!.memory).toBeGreaterThan(30 * MB);
        expect(metrics.s!.memory).toBeLessThan(1024 * MB);
      } finally {
        reader.dispose();
        await killProcessTree(child.pid!);
      }
    },
    30000,
  );
});
