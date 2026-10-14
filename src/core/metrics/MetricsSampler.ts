import type { SessionMetrics } from '@shared/ipc';
import {
  createProcessReader,
  descendantsOf,
  type ProcessReader,
  type ProcessTable,
} from './processTree';

export interface MetricsSamplerOptions {
  /** Root pid of each running session. */
  roots: () => Map<string, number>;
  onSample: (metrics: Record<string, SessionMetrics>) => void;
  intervalMs?: number;
  reader?: ProcessReader;
  now?: () => number;
}

/** Sums CPU and memory over the process tree of each session from two snapshots of the table. */
export function computeMetrics(
  roots: Map<string, number>,
  table: ProcessTable,
  previous: { table: ProcessTable; at: number } | null,
  at: number,
): Record<string, SessionMetrics> {
  const out: Record<string, SessionMetrics> = {};
  const elapsed = previous ? at - previous.at : 0;
  for (const [id, root] of roots) {
    let memory = 0;
    let cpuMs = 0;
    let processes = 0;
    for (const pid of descendantsOf(table, root)) {
      const info = table.get(pid);
      if (!info) continue;
      processes++;
      memory += info.memory;
      const before = previous?.table.get(pid);
      // A pid that was not there before started in between; its whole time counts.
      if (previous) cpuMs += Math.max(0, info.cpuTimeMs - (before?.cpuTimeMs ?? 0));
    }
    out[id] = { memory, processes, cpu: elapsed > 0 ? (cpuMs / elapsed) * 100 : 0 };
  }
  return out;
}

/**
 * Samples the whole process table once per interval, for all sessions at once, and only while
 * some session is running.
 */
export class MetricsSampler {
  private timer: ReturnType<typeof setInterval> | null = null;
  private reader: ProcessReader | null = null;
  private previous: { table: ProcessTable; at: number } | null = null;
  private busy = false;
  private readonly now: () => number;

  constructor(private readonly options: MetricsSamplerOptions) {
    this.now = options.now ?? Date.now;
  }

  start(): void {
    if (this.timer) return;
    this.timer = setInterval(() => void this.sample(), this.options.intervalMs ?? 5000);
    this.timer.unref?.();
  }

  async sample(): Promise<void> {
    if (this.busy) return;
    const roots = this.options.roots();
    if (roots.size === 0) {
      // Nothing to measure: let go of the helper process.
      this.reader?.dispose();
      this.reader = null;
      this.previous = null;
      return;
    }
    this.busy = true;
    try {
      this.reader ??= this.options.reader ?? createProcessReader();
      const table = await this.reader.snapshot();
      const at = this.now();
      if (table.size > 0) {
        this.options.onSample(computeMetrics(roots, table, this.previous, at));
        this.previous = { table, at };
      }
    } finally {
      this.busy = false;
    }
  }

  stop(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
    this.reader?.dispose();
    this.reader = null;
    this.previous = null;
  }
}
