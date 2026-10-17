import { FitAddon } from '@xterm/addon-fit';
import { WebglAddon } from '@xterm/addon-webgl';
import { Terminal, type ITheme } from '@xterm/xterm';
import type { Preferences, ThemeName } from '@shared/prefs';
import type { TerminalSize } from '@shared/session';
import { registerTerminalLinks } from './terminalLinks';

const THEMES: Record<ThemeName, ITheme> = {
  dark: {
    background: '#16181d',
    foreground: '#d7dae0',
    cursor: '#d7dae0',
    selectionBackground: '#3a4660',
  },
  light: {
    background: '#ffffff',
    foreground: '#24292f',
    cursor: '#24292f',
    selectionBackground: '#b6d4fb',
    black: '#24292f',
    white: '#6e7781',
    brightWhite: '#8c959f',
    yellow: '#9a6700',
    brightYellow: '#7d4e00',
    green: '#1a7f37',
    brightGreen: '#116329',
    cyan: '#1b7c83',
    brightCyan: '#3192aa',
    blue: '#0969da',
    brightBlue: '#218bff',
    magenta: '#8250df',
    brightMagenta: '#a475f9',
    red: '#cf222e',
    brightRed: '#a40e26',
  },
};

const RESIZE_DEBOUNCE_MS = 80;

/**
 * One xterm.js instance and its element, living outside React. It is created when a session's
 * terminal is mounted and destroyed when it is unmounted; the content comes back from the
 * history kept in the main process.
 */
export class TerminalHost {
  readonly element = document.createElement('div');
  readonly term: Terminal;
  private readonly fit = new FitAddon();
  private readonly observer: ResizeObserver;
  private readonly unsubscribe: (() => void)[] = [];
  private queue: string[] | null = [];
  private resizeTimer: number | undefined;
  private lastSent: TerminalSize | null = null;
  private visible = false;
  private disposed = false;
  /** How long the last mount took, from creation to the content being on screen. */
  mountMs = 0;

  constructor(
    readonly sessionId: string,
    prefs: Preferences,
    private readonly isWindows: boolean,
  ) {
    this.element.className = 'terminal-host';
    this.element.dataset.sessionId = sessionId;
    this.term = new Terminal({
      allowProposedApi: true,
      cursorBlink: true,
      fontFamily: prefs.fontFamily,
      fontSize: prefs.fontSize,
      scrollback: prefs.scrollback,
      theme: THEMES[prefs.theme],
      // ConPTY already wraps and repaints; letting xterm reflow as well garbles the screen.
      windowsPty: isWindows ? { backend: 'conpty' } : undefined,
    });
    this.term.loadAddon(this.fit);
    // Paths and addresses are links with Ctrl. The side terminal of a session shares its folder.
    const links = registerTerminalLinks(this.term, this.element, {
      sessionId: sessionId.replace(/:aux$/, ''),
      openUrl: (url) => void window.api.invoke('shell:openExternal', url),
    });
    this.unsubscribe.push(
      links.dispose,
      // What was a missing file a moment ago may exist now.
      window.api.on('git:changed', (id) => {
        if (id === sessionId.replace(/:aux$/, '')) links.checker.clear();
      }),
    );
    this.term.attachCustomKeyEventHandler((event) => this.handleKey(event));
    this.term.onData((data) => void window.api.invoke('terminal:input', sessionId, data));
    this.term.onResize(() => {
      this.markSize();
      this.scheduleResize();
    });
    this.element.addEventListener('contextmenu', (event) => {
      event.preventDefault();
      if (this.term.hasSelection()) this.copySelection();
      else void this.paste();
    });
    this.observer = new ResizeObserver(() => this.refit());
    this.unsubscribe.push(
      window.api.on('terminal:data', (id, data) => {
        if (id === sessionId) this.write(data);
      }),
      window.api.on('terminal:reset', (id) => {
        if (id !== sessionId) return;
        this.term.reset();
        // The new process may have been started at another size.
        this.lastSent = null;
        this.scheduleResize();
      }),
    );
  }

  /** Opens the terminal inside `parent` and fills it with the session's history. */
  async mount(parent: HTMLElement): Promise<void> {
    const started = performance.now();
    parent.appendChild(this.element);
    this.term.open(this.element);
    this.loadWebgl();
    this.safeFit();
    this.markSize();
    this.observer.observe(this.element);
    const size = { cols: this.term.cols, rows: this.term.rows };
    this.lastSent = size;
    const snapshot = await window.api.invoke('terminal:attach', this.sessionId, size);
    if (this.disposed) return;
    // Output that arrived while waiting was queued: it comes after the snapshot.
    const queued = this.queue ?? [];
    this.queue = null;
    await new Promise<void>((resolve) => this.term.write(snapshot.data, resolve));
    for (const data of queued) this.write(data);
    this.mountMs = performance.now() - started;
  }

  private loadWebgl(): void {
    try {
      const webgl = new WebglAddon();
      // If the GPU context is lost, xterm falls back to its DOM renderer.
      webgl.onContextLoss(() => webgl.dispose());
      this.term.loadAddon(webgl);
    } catch {
      // No WebGL (remote desktop, some VMs): the DOM renderer is used.
    }
  }

  private write(data: string): void {
    if (this.queue) {
      this.queue.push(data);
      return;
    }
    // Acknowledge only once drawn: this is what the main process' backpressure counts.
    this.term.write(
      data,
      () => void window.api.invoke('terminal:ack', this.sessionId, data.length),
    );
  }

  private safeFit(): void {
    if (this.element.clientWidth < 20 || this.element.clientHeight < 20) return;
    try {
      this.fit.fit();
    } catch {
      // Not laid out yet.
    }
  }

  private refit(): void {
    if (this.visible) this.safeFit();
  }

  /** The size in cells, where the tests (and anyone debugging) can read it. */
  private markSize(): void {
    this.element.dataset.cols = String(this.term.cols);
    this.element.dataset.rows = String(this.term.rows);
  }

  private scheduleResize(): void {
    window.clearTimeout(this.resizeTimer);
    this.resizeTimer = window.setTimeout(() => {
      const size = { cols: this.term.cols, rows: this.term.rows };
      if (this.lastSent?.cols === size.cols && this.lastSent.rows === size.rows) return;
      this.lastSent = size;
      void window.api.invoke('terminal:resize', this.sessionId, size);
    }, RESIZE_DEBOUNCE_MS);
  }

  get size(): TerminalSize {
    return { cols: this.term.cols, rows: this.term.rows };
  }

  setVisible(visible: boolean): void {
    if (this.visible === visible) return;
    this.visible = visible;
    this.element.classList.toggle('visible', visible);
    void window.api.invoke('terminal:setVisible', this.sessionId, visible);
    if (visible) {
      this.safeFit();
      this.term.refresh(0, this.term.rows - 1);
    }
  }

  focus(): void {
    this.term.focus();
  }

  applyPreferences(prefs: Preferences): void {
    this.term.options.fontFamily = prefs.fontFamily;
    this.term.options.fontSize = prefs.fontSize;
    this.term.options.scrollback = prefs.scrollback;
    this.term.options.theme = THEMES[prefs.theme];
    this.refit();
  }

  private copySelection(): void {
    const text = this.term.getSelection();
    if (!text) return;
    void window.api.invoke('clipboard:write', text);
    this.term.clearSelection();
  }

  private async paste(): Promise<void> {
    const text = await window.api.invoke('clipboard:read');
    // term.paste handles bracketed paste and line endings of multi-line text.
    if (text) this.term.paste(text);
  }

  /** Returns false for keys xterm must not send to the program. */
  private handleKey(event: KeyboardEvent): boolean {
    if (event.type !== 'keydown') return true;
    const key = event.key.toLowerCase();
    const ctrl = event.ctrlKey && !event.altKey && !event.metaKey;
    const copy =
      ctrl && key === 'c' && (event.shiftKey || (this.isWindows && this.term.hasSelection()));
    const paste =
      (ctrl && key === 'v' && (event.shiftKey || this.isWindows)) ||
      (event.shiftKey && !event.ctrlKey && key === 'insert');
    if (copy) {
      event.preventDefault();
      this.copySelection();
      return false;
    }
    if (paste) {
      event.preventDefault();
      void this.paste();
      return false;
    }
    return true;
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    window.clearTimeout(this.resizeTimer);
    this.observer.disconnect();
    for (const off of this.unsubscribe) off();
    void window.api.invoke('terminal:detach', this.sessionId);
    this.term.dispose();
    this.element.remove();
  }
}
