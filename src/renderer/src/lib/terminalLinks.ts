import type { IBufferLine, ILink, IDisposable, Terminal } from '@xterm/xterm';
import { findLocations, findUrls, type LocatedPath } from '@shared/locations';

/** A place in a file a click asked for, which the app turns into the editor on that line. */
export interface OpenLocationDetail {
  sessionId: string;
  path: string;
  line?: number;
  column?: number;
}

const OPEN_EVENT = 'agent-controller:open-location';

/** Asks the app to show a file at a line. The terminals and the checks dialog say it this way. */
export function requestOpenLocation(detail: OpenLocationDetail): void {
  window.dispatchEvent(new CustomEvent<OpenLocationDetail>(OPEN_EVENT, { detail }));
}

/** Listens for `requestOpenLocation`; returns how to stop. */
export function onOpenLocation(listener: (detail: OpenLocationDetail) => void): () => void {
  const handler = (event: Event) => listener((event as CustomEvent<OpenLocationDetail>).detail);
  window.addEventListener(OPEN_EVENT, handler);
  return () => window.removeEventListener(OPEN_EVENT, handler);
}

/** How long an answer of the main process about a path is trusted: files come and go. */
const CACHE_MS = 8000;
const CACHE_LIMIT = 500;

/** Asks which paths exist in the folder of the session, and remembers the answers for a while. */
export class PathChecker {
  private readonly cache = new Map<string, { at: number; value: LocatedPath | null }>();

  constructor(private readonly sessionId: string) {}

  /** The files among `candidates`, in the same order (`null` for what is not one). */
  async check(candidates: string[]): Promise<(LocatedPath | null)[]> {
    const now = Date.now();
    const unknown = [
      ...new Set(
        candidates.filter((c) => {
          const known = this.cache.get(c);
          return !known || now - known.at > CACHE_MS;
        }),
      ),
    ];
    if (unknown.length > 0) {
      const answers = await window.api.invoke('files:locate', this.sessionId, unknown);
      if (this.cache.size > CACHE_LIMIT) this.cache.clear();
      unknown.forEach((c, i) => this.cache.set(c, { at: now, value: answers[i] ?? null }));
    }
    return candidates.map((c) => this.cache.get(c)?.value ?? null);
  }

  /** Forget everything: the folder changed. */
  clear(): void {
    this.cache.clear();
  }
}

interface Cell {
  x: number;
  y: number;
}

/**
 * The text of the whole logical line the row belongs to (rows the terminal wrapped are joined),
 * and for each character of it the cell it was drawn in, so offsets become screen positions.
 */
export function logicalLine(term: Terminal, row: number): { text: string; cells: Cell[] } {
  const buffer = term.buffer.active;
  let first = row - 1;
  while (first > 0 && buffer.getLine(first)?.isWrapped) first--;
  let text = '';
  const cells: Cell[] = [];
  const probe = buffer.getNullCell();
  for (let index = first; ; index++) {
    const line: IBufferLine | undefined = buffer.getLine(index);
    if (!line || (index > first && !line.isWrapped)) break;
    for (let x = 0; x < line.length; x++) {
      const cell = line.getCell(x, probe);
      if (!cell || cell.getWidth() === 0) continue;
      const chars = cell.getChars() || ' ';
      for (let k = 0; k < chars.length; k++) cells.push({ x: x + 1, y: index + 1 });
      text += chars;
    }
    // The empty tail of the last row is not part of the line.
    if (!buffer.getLine(index + 1)?.isWrapped) break;
  }
  return { text: text.replace(/\s+$/, ''), cells };
}

export interface LinkOptions {
  /** The session whose folder the paths are relative to. */
  sessionId: string;
  /** The app's way of opening a web address. */
  openUrl(url: string): void;
  /** Ctrl+Shift+click on a path: the external editor, instead of the panel. */
  openInEditor(path: string, line?: number, column?: number): void;
}

/**
 * Makes the paths and web addresses printed in a terminal clickable with Ctrl. Without Ctrl a link
 * has no underline and no pointer, and a click does nothing, so selecting text with the mouse is
 * left alone. (The terminal looks for links once per row the mouse enters, so whether Ctrl is
 * down has to be read when the link is drawn and clicked, not when it is found.)
 */
export function registerTerminalLinks(
  term: Terminal,
  element: HTMLElement,
  options: LinkOptions,
): { checker: PathChecker; dispose(): void } {
  const checker = new PathChecker(options.sessionId);
  let ctrl = false;
  let mouse: { x: number; y: number } | null = null;
  /**
   * Pressing or releasing Ctrl with the mouse already over a link: the terminal decided how to
   * draw it when the mouse got there, so it is told the mouse left and came back.
   */
  const redraw = () => {
    if (!mouse) return;
    const target = document.elementFromPoint(mouse.x, mouse.y);
    if (!target || !element.contains(target)) return;
    const { x: clientX, y: clientY } = mouse;
    for (const el of [term.element, term.element?.querySelector('.xterm-screen')]) {
      el?.dispatchEvent(new MouseEvent('mouseleave'));
    }
    target.dispatchEvent(
      new MouseEvent('mousemove', { clientX, clientY, ctrlKey: ctrl, bubbles: true }),
    );
  };
  const track = (event: KeyboardEvent | MouseEvent) => {
    const before = ctrl;
    ctrl = event.ctrlKey;
    if (event instanceof MouseEvent) {
      // Our own redraw above is not the user's mouse.
      if (event.isTrusted) mouse = { x: event.clientX, y: event.clientY };
    } else if (before !== ctrl) redraw();
  };
  // Capture phase: this runs before the terminal looks for a link under the mouse.
  element.addEventListener('mousemove', track, true);
  element.addEventListener('mousedown', track, true);
  element.addEventListener('mouseleave', () => (mouse = null));
  window.addEventListener('keydown', track);
  window.addEventListener('keyup', track);
  const clearOnBlur = () => {
    ctrl = false;
    redraw();
  };
  window.addEventListener('blur', clearOnBlur);

  const provider: IDisposable = term.registerLinkProvider({
    provideLinks(row, callback) {
      const { text, cells } = logicalLine(term, row);
      const place = (start: number, end: number) => {
        const from = cells[start];
        const to = cells[end - 1];
        return from && to ? { start: { x: from.x, y: from.y }, end: { x: to.x, y: to.y } } : null;
      };
      const links: ILink[] = [];
      /**
       * The terminal copies `decorations` when the mouse reaches the link, and then replaces them
       * with its own, which stop answering once the mouse leaves; the links it keeps for a row
       * would then never be underlined again. So each read gets a fresh answer, and what the
       * terminal assigns is dropped.
       */
      const link = (range: ILink['range'], text: string, activate: ILink['activate']): ILink => ({
        range,
        text,
        activate,
        get decorations() {
          return { underline: ctrl, pointerCursor: ctrl };
        },
        set decorations(_ignored) {},
      });
      const onRow = (range: NonNullable<ReturnType<typeof place>>) =>
        range.start.y <= row && range.end.y >= row;

      for (const url of findUrls(text)) {
        const range = place(url.start, url.end);
        if (range && onRow(range)) {
          links.push(link(range, url.url, (event) => event.ctrlKey && options.openUrl(url.url)));
        }
      }

      const found = findLocations(text).filter((m) => m.path.length <= 1000);
      if (found.length === 0) return callback(links.length > 0 ? links : undefined);
      checker
        .check(found.map((m) => m.path))
        .then((answers) => {
          found.forEach((match, i) => {
            const answer = answers[i];
            const range = place(match.start, match.end);
            if (!answer?.isFile || !range || !onRow(range)) return;
            links.push(
              link(range, text.slice(match.start, match.end), (event) => {
                if (!event.ctrlKey) return;
                if (event.shiftKey) {
                  options.openInEditor(answer.path, match.line, match.column);
                  return;
                }
                requestOpenLocation({
                  sessionId: options.sessionId,
                  path: answer.path,
                  line: match.line,
                  column: match.column,
                });
              }),
            );
          });
          callback(links.length > 0 ? links : undefined);
        })
        .catch(() => callback(links.length > 0 ? links : undefined));
    },
  });

  return {
    checker,
    dispose() {
      provider.dispose();
      element.removeEventListener('mousemove', track, true);
      element.removeEventListener('mousedown', track, true);
      window.removeEventListener('keydown', track);
      window.removeEventListener('keyup', track);
      window.removeEventListener('blur', clearOnBlur);
    },
  };
}
