/**
 * Fires once when the output goes quiet for `windowMs` after a period of activity. It is the
 * fallback signal: a long silent build looks exactly like an agent waiting for an answer.
 */
export class SilenceDetector {
  private timer: ReturnType<typeof setTimeout> | null = null;
  private lastActivity = 0;
  private armed = false;

  constructor(
    private windowMs: number,
    private readonly onSilence: (at: number) => void,
    private readonly now: () => number = Date.now,
  ) {}

  setWindow(windowMs: number): void {
    this.windowMs = windowMs;
    this.cancel();
    if (this.armed) this.schedule(this.windowMs);
  }

  /** Call for every chunk of output. */
  activity(): void {
    this.lastActivity = this.now();
    this.armed = true;
    // The timer is not re-created per chunk: when it fires it checks how long ago the last
    // output was and sleeps for the remainder.
    if (!this.timer) this.schedule(this.windowMs);
  }

  private schedule(ms: number): void {
    if (this.windowMs <= 0) return;
    this.timer = setTimeout(() => {
      this.timer = null;
      if (!this.armed) return;
      const quietFor = this.now() - this.lastActivity;
      if (quietFor >= this.windowMs) {
        this.armed = false;
        this.onSilence(this.now());
      } else {
        this.schedule(this.windowMs - quietFor);
      }
    }, ms);
  }

  private cancel(): void {
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
  }

  dispose(): void {
    this.cancel();
    this.armed = false;
  }
}
