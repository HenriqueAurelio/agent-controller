import { SerializeAddon } from '@xterm/addon-serialize';
import { Terminal } from '@xterm/headless';

export interface ScreenHistoryOptions {
  cols: number;
  rows: number;
  scrollback: number;
}

/**
 * The session's terminal, kept in the main process without a screen. It is what lets the visual
 * terminal be unmounted and later rebuilt with the same content, colours and cursor.
 */
export class ScreenHistory {
  private readonly terminal: Terminal;
  private readonly serializer = new SerializeAddon();
  /** Characters written but not parsed yet; feeds the backpressure. */
  pending = 0;

  constructor(options: ScreenHistoryOptions) {
    this.terminal = new Terminal({
      cols: options.cols,
      rows: options.rows,
      scrollback: options.scrollback,
      allowProposedApi: true,
    });
    this.terminal.loadAddon(this.serializer as never);
  }

  get cols(): number {
    return this.terminal.cols;
  }

  get rows(): number {
    return this.terminal.rows;
  }

  /**
   * Answers the terminal owes the program (cursor position, device attributes). Agents ask
   * these on startup and stall without a reply.
   */
  onReply(listener: (data: string) => void): void {
    this.terminal.onData(listener);
  }

  write(data: string, onParsed?: () => void): void {
    this.pending += data.length;
    this.terminal.write(data, () => {
      this.pending -= data.length;
      onParsed?.();
    });
  }

  /** Resolves once everything written so far has been parsed. */
  flush(): Promise<void> {
    return new Promise((resolve) => this.terminal.write('', resolve));
  }

  resize(cols: number, rows: number): void {
    const c = Math.max(2, Math.floor(cols));
    const r = Math.max(1, Math.floor(rows));
    if (c !== this.terminal.cols || r !== this.terminal.rows) this.terminal.resize(c, r);
  }

  setScrollback(lines: number): void {
    this.terminal.options.scrollback = lines;
  }

  /** Escape sequences that reproduce the screen, the scrollback and the cursor. */
  serialize(): string {
    return this.serializer.serialize();
  }

  /** Plain text of the visible screen, for tests and diagnostics. */
  screenText(): string {
    const buffer = this.terminal.buffer.active;
    const lines: string[] = [];
    for (let y = 0; y < this.terminal.rows; y++) {
      lines.push(buffer.getLine(buffer.viewportY + y)?.translateToString(true) ?? '');
    }
    while (lines.length && lines[lines.length - 1] === '') lines.pop();
    return lines.join('\n');
  }

  cursor(): { x: number; y: number } {
    const buffer = this.terminal.buffer.active;
    return { x: buffer.cursorX, y: buffer.cursorY };
  }

  dispose(): void {
    this.terminal.dispose();
  }
}
