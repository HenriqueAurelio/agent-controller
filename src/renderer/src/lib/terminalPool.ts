import type { Preferences } from '@shared/prefs';
import { TerminalHost } from './terminalHost';

/** The visible terminal plus the two most recently used. Everything else is unmounted. */
export const MAX_MOUNTED = 3;

/**
 * Keeps a fixed number of visual terminals alive, whatever the number of sessions. Going back
 * to an unmounted session rebuilds its terminal from the history in the main process.
 */
export class TerminalPool {
  private readonly hosts = new Map<string, TerminalHost>();
  /** Most recently shown last. */
  private recent: string[] = [];
  private current: string | null = null;

  constructor(
    private readonly container: HTMLElement,
    private prefs: Preferences,
    private readonly isWindows: boolean,
  ) {}

  get(sessionId: string): TerminalHost | undefined {
    return this.hosts.get(sessionId);
  }

  get size(): number {
    return this.hosts.size;
  }

  show(sessionId: string | null): TerminalHost | null {
    if (this.current && this.current !== sessionId) this.hosts.get(this.current)?.setVisible(false);
    this.current = sessionId;
    if (!sessionId) return null;

    this.recent = [...this.recent.filter((id) => id !== sessionId), sessionId];
    let host = this.hosts.get(sessionId);
    if (host) {
      host.setVisible(true);
    } else {
      host = new TerminalHost(sessionId, this.prefs, this.isWindows);
      this.hosts.set(sessionId, host);
      host.setVisible(true);
      const created = host;
      void created.mount(this.container).then(() => {
        created.element.dataset.mountMs = created.mountMs.toFixed(0);
      });
    }
    this.evict();
    return host;
  }

  private evict(): void {
    while (this.hosts.size > MAX_MOUNTED) {
      const victim = this.recent.find((id) => id !== this.current && this.hosts.has(id));
      if (!victim) return;
      this.drop(victim);
    }
  }

  /** Unmounts the terminal of a session (evicted, or the session was removed). */
  drop(sessionId: string): void {
    this.hosts.get(sessionId)?.dispose();
    this.hosts.delete(sessionId);
    this.recent = this.recent.filter((id) => id !== sessionId);
    if (this.current === sessionId) this.current = null;
  }

  /** Drops the terminals of sessions that no longer exist. */
  retain(sessionIds: Set<string>): void {
    for (const id of [...this.hosts.keys()]) if (!sessionIds.has(id)) this.drop(id);
  }

  applyPreferences(prefs: Preferences): void {
    this.prefs = prefs;
    for (const host of this.hosts.values()) host.applyPreferences(prefs);
  }

  dispose(): void {
    for (const id of [...this.hosts.keys()]) this.drop(id);
  }
}
