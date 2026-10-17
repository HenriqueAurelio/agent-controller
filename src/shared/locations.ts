// Reads the places a line of program output points to: `file:line`, tsc's `file(line,col)`,
// Python's `File "x.py", line N`, bare paths and web addresses. It is pure text work, shared by
// the terminal links and by whatever else needs to turn output into places (the problems list).

/** A path found in a line, with where it is. `start` and `end` are string offsets (end excluded). */
export interface LocationMatch {
  start: number;
  end: number;
  /** As written in the line, without the position suffix. */
  path: string;
  /** 1-based, when the line says one. */
  line?: number;
  column?: number;
}

/** A web address found in a line. */
export interface UrlMatch {
  start: number;
  end: number;
  /** Ready to open: `localhost:3000` gets its `http://`. */
  url: string;
}

/** Lines longer than this are not scanned: minified output would only burn time. */
export const MAX_SCANNED_LINE = 2000;
/** A line with more candidates than this keeps the first ones. */
export const MAX_MATCHES_PER_LINE = 20;

const NAME = String.raw`[\p{L}\p{N}_.@~+\-]`;
// A drive (`C:\` or `C:/`), a root, `./` or `../`, then names joined by separators of either kind.
const PATH = String.raw`(?:[A-Za-z]:[\\/]|[\\/]|\.{1,2}[\\/])?${NAME}+(?:[\\/]+${NAME}+)*`;
const POSITION = String.raw`(?::(\d+)(?::(\d+))?|\((\d+)(?:,\s*(\d+))?\)|["']?,\s*line\s+(\d+))`;

/** Not in the middle of a word or of a longer path. */
const LOCATION = new RegExp(String.raw`(?<![\p{L}\p{N}_.@~+\-\\/])(${PATH})${POSITION}?`, 'gu');

const URL_RE = /\bhttps?:\/\/[^\s<>"'`\\^{}|]+/giu;
const LOCAL_RE =
  /(?<![\w.@/-])(?:localhost|127\.0\.0\.1|0\.0\.0\.0|\[::1\]):\d{2,5}(?:\/[^\s<>"'`\\^{}|]*)?/giu;

/** Punctuation that ends a sentence, not an address. */
const SENTENCE_END = '.,;:!?\'"]';

function trimUrl(raw: string): string {
  let url = raw;
  for (;;) {
    const last = url.charAt(url.length - 1);
    if (!last) return url;
    const unbalanced = last === ')' && url.split(')').length > url.split('(').length;
    if (!unbalanced && !SENTENCE_END.includes(last)) return url;
    url = url.slice(0, -1);
  }
}

/** Web addresses, in the order they appear. */
export function findUrls(text: string): UrlMatch[] {
  if (text.length > MAX_SCANNED_LINE) return [];
  const found: UrlMatch[] = [];
  for (const re of [URL_RE, LOCAL_RE]) {
    re.lastIndex = 0;
    for (let m = re.exec(text); m; m = re.exec(text)) {
      const raw = trimUrl(m[0]);
      if (raw.length === 0) continue;
      const start = m.index;
      const end = start + raw.length;
      if (found.some((f) => start < f.end && end > f.start)) continue;
      found.push({ start, end, url: /^https?:/i.test(raw) ? raw : `http://${raw}` });
    }
  }
  return found.sort((a, b) => a.start - b.start).slice(0, MAX_MATCHES_PER_LINE);
}

/** Looks like a file: it has a folder in it, or an extension. Plain words and numbers do not. */
function looksLikeFile(candidate: string): boolean {
  if (/[\\/]/.test(candidate)) return /[\p{L}\p{N}]/u.test(candidate);
  // `README.md`, `main.go`; not `1.5`, `e.g` or `v2.0.1`.
  if (/^\p{L}\.\p{L}$/u.test(candidate)) return false;
  return /^[\p{L}_@~+-][\p{L}\p{N}_@~+-]*(?:\.[\p{L}\p{N}_@~+-]+)*\.[\p{L}][\p{L}\p{N}_]{0,9}$/u.test(
    candidate,
  );
}

function numberOf(value: string | undefined): number | undefined {
  if (value === undefined) return undefined;
  const n = Number(value);
  return Number.isSafeInteger(n) && n > 0 ? n : undefined;
}

/**
 * The paths in one line, with the position they name. They are only candidates: the text says
 * nothing of whether the file exists, which is for the caller to confirm. Web addresses are not
 * paths and are skipped (see `findUrls`).
 */
export function findLocations(text: string): LocationMatch[] {
  if (text.length > MAX_SCANNED_LINE) return [];
  const urls = findUrls(text);
  const found: LocationMatch[] = [];
  LOCATION.lastIndex = 0;
  for (
    let m = LOCATION.exec(text);
    m && found.length < MAX_MATCHES_PER_LINE;
    m = LOCATION.exec(text)
  ) {
    // A sentence's full stop is not part of the name: "see src/x.ts."
    const path = m[1]!.replace(/\.+$/, '');
    const hasSuffix = m[0].length > m[1]!.length;
    // The position only belongs to the path when nothing was trimmed from it.
    const trimmed = path.length !== m[1]!.length;
    if (!path || (trimmed && hasSuffix) || !looksLikeFile(path)) continue;
    const start = m.index;
    const end = start + (trimmed ? path.length : m[0].length);
    if (urls.some((u) => start < u.end && end > u.start)) continue;
    const line = hasSuffix && !trimmed ? numberOf(m[2] ?? m[4] ?? m[6]) : undefined;
    const column = line === undefined ? undefined : numberOf(m[3] ?? m[5]);
    found.push({
      start,
      end,
      path,
      ...(line !== undefined && { line }),
      ...(column !== undefined && { column }),
    });
  }
  return found;
}

/** A path as the main process answers for it: inside the folder, and the kind of thing it is. */
export interface LocatedPath {
  /** Relative to the session folder, with forward slashes, as the panel names files. */
  path: string;
  isFile: boolean;
}
