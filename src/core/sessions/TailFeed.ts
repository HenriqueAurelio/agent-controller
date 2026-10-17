/** How many lines of each session the overview shows. */
export const TAIL_LINES = 6;
/** The overview hears of new output at most this often. */
export const TAIL_INTERVAL_MS = 1000;

export interface TailFeedOptions {
  sessionIds(): string[];
  /** Grows whenever the session writes something (`SessionManager.outputSeq`). */
  outputSeq(id: string): number;
  tail(id: string, lines: number): Promise<string[]>;
  /** The sessions whose last lines changed, and only them. */
  onTails(tails: Record<string, string[]>): void;
  onError?(err: unknown): void;
  intervalMs?: number;
  lines?: number;
}

/**
 * The last lines of every session, for the overview. Nothing is read while nobody watches; while
 * someone does, one batch a second at most, with only the sessions that wrote something and whose
 * lines are not the ones already sent.
 */
export class TailFeed {
  private timer: ReturnType<typeof setInterval> | null = null;
  /** What was last read of each session: its output counter and the lines sent. */
  private readonly seen = new Map<string, { seq: number; text: string }>();
  private reading = false;
  private disposed = false;

  constructor(private readonly options: TailFeedOptions) {}

  get watching(): boolean {
    return this.timer !== null;
  }

  /**
   * Starts or stops the feed. Starting resolves to the lines of every session, which the batches
   * that follow only update.
   */
  async watch(watching: boolean): Promise<Record<string, string[]>> {
    if (!watching || this.disposed) {
      this.stop();
      return {};
    }
    if (!this.timer) {
      this.timer = setInterval(() => void this.tick(), this.options.intervalMs ?? TAIL_INTERVAL_MS);
      this.timer.unref?.();
    }
    this.seen.clear();
    return this.read(this.options.sessionIds(), true);
  }

  private stop(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
    this.seen.clear();
  }

  private async tick(): Promise<void> {
    // A slow read is not stacked on another: the next tick finds what changed meanwhile.
    if (this.reading || !this.timer) return;
    this.reading = true;
    try {
      const ids = this.options.sessionIds();
      const live = new Set(ids);
      for (const id of this.seen.keys()) if (!live.has(id)) this.seen.delete(id);
      const changed = ids.filter((id) => this.options.outputSeq(id) !== this.seen.get(id)?.seq);
      if (!changed.length) return;
      const tails = await this.read(changed, false);
      if (this.timer && Object.keys(tails).length) this.options.onTails(tails);
    } catch (err) {
      this.options.onError?.(err);
    } finally {
      this.reading = false;
    }
  }

  /** The lines of `ids`; unless `all`, only the ones that differ from what was sent. */
  private async read(ids: string[], all: boolean): Promise<Record<string, string[]>> {
    const lines = this.options.lines ?? TAIL_LINES;
    const result: Record<string, string[]> = {};
    for (const id of ids) {
      const seq = this.options.outputSeq(id);
      const tail = await this.options.tail(id, lines);
      const text = tail.join('\n');
      const before = this.seen.get(id);
      this.seen.set(id, { seq, text });
      if (all || before?.text !== text) result[id] = tail;
    }
    return result;
  }

  dispose(): void {
    this.disposed = true;
    this.stop();
  }
}
