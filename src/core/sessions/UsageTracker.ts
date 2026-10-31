import { EventEmitter } from 'node:events';
import type { SessionUsage } from '@shared/session';
import type { UsageReader } from '../agents/usage';
import { TranscriptTail } from './TranscriptTail';

/** While an agent works, its conversation file is read this often. */
export const USAGE_POLL_MS = 5000;

interface Tracked {
  tail: TranscriptTail;
  reader: UsageReader;
  last: SessionUsage | null;
  timer: ReturnType<typeof setInterval> | null;
}

interface UsageEvents {
  usage: [id: string, usage: SessionUsage];
}

/**
 * Follows the conversation file of each session and reports tokens and context when they
 * change. Reads only what was appended since the last time, on demand (`poke`, after a hook)
 * and every few seconds while the agent works.
 */
export class UsageTracker extends EventEmitter<UsageEvents> {
  private readonly tracked = new Map<string, Tracked>();

  /** The agent named its conversation file. A new file replaces the old one and its numbers. */
  track(id: string, file: string, reader: UsageReader): void {
    const current = this.tracked.get(id);
    if (current?.tail.path === file) return;
    this.stop(id);
    this.tracked.set(id, {
      tail: new TranscriptTail(file, (line) => reader.line(line)),
      reader,
      last: null,
      timer: null,
    });
    void this.poke(id);
  }

  /** Reads what is new in the session's file now. */
  async poke(id: string): Promise<void> {
    const entry = this.tracked.get(id);
    if (!entry) return;
    if (!(await entry.tail.read())) return;
    if (this.tracked.get(id) !== entry) return;
    const usage = entry.reader.snapshot();
    if (!usage || same(usage, entry.last)) return;
    entry.last = usage;
    this.emit('usage', id, usage);
  }

  /** Reads on a timer while the agent works; a turn that ends reads one last time. */
  setWorking(id: string, working: boolean): void {
    const entry = this.tracked.get(id);
    if (!entry) return;
    if (working && !entry.timer) {
      entry.timer = setInterval(() => void this.poke(id), USAGE_POLL_MS);
    } else if (!working && entry.timer) {
      clearInterval(entry.timer);
      entry.timer = null;
      void this.poke(id);
    }
  }

  usageOf(id: string): SessionUsage | undefined {
    return this.tracked.get(id)?.last ?? undefined;
  }

  stop(id: string): void {
    const entry = this.tracked.get(id);
    if (entry?.timer) clearInterval(entry.timer);
    this.tracked.delete(id);
  }

  dispose(): void {
    for (const id of [...this.tracked.keys()]) this.stop(id);
  }
}

function same(a: SessionUsage, b: SessionUsage | null): boolean {
  return (
    !!b &&
    a.inputTokens === b.inputTokens &&
    a.cacheReadTokens === b.cacheReadTokens &&
    a.outputTokens === b.outputTokens &&
    a.contextTokens === b.contextTokens &&
    a.contextWindow === b.contextWindow &&
    a.model === b.model &&
    a.planUsedPct === b.planUsedPct
  );
}
