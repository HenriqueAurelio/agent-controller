import { SerializeAddon } from '@xterm/addon-serialize';
import { Terminal } from '@xterm/headless';

/** How far up `tail` looks for lines worth showing, in rows. */
const TAIL_SCAN_ROWS = 400;
/** A longer line is cut: a glance has no room for it. */
export const TAIL_LINE_LIMIT = 300;

// Box drawing (U+2500 to U+257F) and the ASCII bar TUIs frame their text with, at the edges of a
// row.
const EDGE = /^[\s─-╿|]+|[\s─-╿|]+$/gu;
// Rules, spinners and frames have no letter nor digit in them.
const READABLE = /[\p{L}\p{N}]/u;

/** A row of the terminal as a glance shows it; empty when nothing in it reads as text. */
export function tailLine(row: string): string {
  const text = row.replace(EDGE, '').replace(/\s{3,}/g, '  ');
  if (!READABLE.test(text)) return '';
  const chars = [...text];
  return chars.length > TAIL_LINE_LIMIT ? `${chars.slice(0, TAIL_LINE_LIMIT - 1).join('')}…` : text;
}

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

  /**
   * The last `count` lines of the output, as plain text for a glance: a line the terminal wrapped
   * is one line again, and what a TUI draws around its text (borders, rules, empty rows) is left
   * out. Only the end of the buffer is read, so the cost does not grow with the scrollback.
   */
  tail(count: number): string[] {
    const wanted = Math.max(0, Math.floor(count));
    const buffer = this.terminal.buffer.active;
    const lines: string[] = [];
    let y = buffer.length - 1;
    // The empty rows at the bottom of the screen do not count against how far it looks.
    const stop = Math.max(0, y - this.terminal.rows - TAIL_SCAN_ROWS);
    while (y >= stop && lines.length < wanted) {
      // A wrapped row continues the one above it: walk up to where the line starts.
      let start = y;
      while (start > 0 && buffer.getLine(start)?.isWrapped) start--;
      let text = '';
      for (let row = start; row <= y; row++) {
        text += buffer.getLine(row)?.translateToString(row === y) ?? '';
      }
      const clean = tailLine(text);
      if (clean) lines.push(clean);
      y = start - 1;
    }
    return lines.reverse();
  }

  cursor(): { x: number; y: number } {
    const buffer = this.terminal.buffer.active;
    return { x: buffer.cursorX, y: buffer.cursorY };
  }

  dispose(): void {
    this.terminal.dispose();
  }
}
