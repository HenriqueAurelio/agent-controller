// The changed blocks of a file, with a few lines of context, from its two sides. Pure: the text of
// both sides comes from whoever calls, so every base of the panel (last commit, start of the
// session, base of the branch, checkpoints) gives its blocks the same way.
import { createHash } from 'node:crypto';
import type { DiffHunk, HunkLine } from '@shared/git';

/** A side with more lines than this is not split into blocks: the file is opened instead. */
export const HUNK_MAX_LINES = 20_000;
/** Past this many edits the two sides are treated as one block: a rewrite, not a review. */
const MAX_EDIT_DISTANCE = 4_000;

type Op = 'ctx' | 'add' | 'del';

/** Lines of a text, each keeping its `\r`, so writing them back keeps the file's line ends. */
export function splitLines(text: string): string[] {
  if (text === '') return [];
  const lines = text.split('\n');
  // A final newline ends the last line; it does not start an empty one.
  if (lines[lines.length - 1] === '') lines.pop();
  return lines;
}

/**
 * The shortest edit script from `a` to `b` (Myers), as one operation per line. The common start
 * and end are taken out first: an agent's change is usually a few lines in a long file.
 */
export function diffLines(a: readonly string[], b: readonly string[]): Op[] {
  let start = 0;
  while (start < a.length && start < b.length && a[start] === b[start]) start++;
  let endA = a.length;
  let endB = b.length;
  while (endA > start && endB > start && a[endA - 1] === b[endB - 1]) {
    endA--;
    endB--;
  }
  const middle = myers(a.slice(start, endA), b.slice(start, endB));
  return [...Array<Op>(start).fill('ctx'), ...middle, ...Array<Op>(a.length - endA).fill('ctx')];
}

function myers(a: readonly string[], b: readonly string[]): Op[] {
  const n = a.length;
  const m = b.length;
  if (n === 0) return Array<Op>(m).fill('add');
  if (m === 0) return Array<Op>(n).fill('del');
  const max = Math.min(n + m, MAX_EDIT_DISTANCE);
  const offset = max + 1;
  const v = new Int32Array(2 * max + 3);
  const trace: Int32Array[] = [];
  let found = -1;
  for (let d = 0; d <= max && found < 0; d++) {
    trace.push(v.slice());
    for (let k = -d; k <= d; k += 2) {
      let x =
        k === -d || (k !== d && v[offset + k - 1]! < v[offset + k + 1]!)
          ? v[offset + k + 1]!
          : v[offset + k - 1]! + 1;
      let y = x - k;
      while (x < n && y < m && a[x] === b[y]) {
        x++;
        y++;
      }
      v[offset + k] = x;
      if (x >= n && y >= m) {
        found = d;
        break;
      }
    }
  }
  // Too far apart: everything old goes, everything new comes.
  if (found < 0) return [...Array<Op>(n).fill('del'), ...Array<Op>(m).fill('add')];

  const ops: Op[] = [];
  let x = n;
  let y = m;
  for (let d = found; d > 0; d--) {
    const prev = trace[d]!;
    const k = x - y;
    const down = k === -d || (k !== d && prev[offset + k - 1]! < prev[offset + k + 1]!);
    const prevK = down ? k + 1 : k - 1;
    const prevX = prev[offset + prevK]!;
    const prevY = prevX - prevK;
    while (x > prevX && y > prevY) {
      ops.push('ctx');
      x--;
      y--;
    }
    ops.push(down ? 'add' : 'del');
    if (down) y--;
    else x--;
  }
  while (x > 0 && y > 0) {
    ops.push('ctx');
    x--;
    y--;
  }
  return ops.reverse();
}

/** The blocks of changed lines, each with `context` lines around it; close blocks are merged. */
export function buildHunks(
  file: string,
  original: readonly string[],
  modified: readonly string[],
  context = 3,
): DiffHunk[] {
  const ops = diffLines(original, modified);
  // Each operation with its line on each side (1-based; the side it is not on keeps the next).
  const rows: { op: Op; oldNo: number; newNo: number; text: string }[] = [];
  let oldNo = 1;
  let newNo = 1;
  for (const op of ops) {
    if (op === 'ctx') rows.push({ op, oldNo: oldNo++, newNo: newNo++, text: modified[newNo - 2]! });
    else if (op === 'del') rows.push({ op, oldNo: oldNo++, newNo, text: original[oldNo - 2]! });
    else rows.push({ op, oldNo, newNo: newNo++, text: modified[newNo - 2]! });
  }

  const ranges: [number, number][] = [];
  for (let i = 0; i < rows.length; i++) {
    if (rows[i]!.op === 'ctx') continue;
    const from = Math.max(0, i - context);
    let to = i;
    while (to + 1 < rows.length && rows[to + 1]!.op !== 'ctx') to++;
    const end = Math.min(rows.length - 1, to + context);
    const last = ranges[ranges.length - 1];
    if (last && from <= last[1] + 1) last[1] = end;
    else ranges.push([from, end]);
    i = to;
  }

  return ranges.map(([from, to]) => {
    const slice = rows.slice(from, to + 1);
    const lines: HunkLine[] = slice.map((r) => ({
      kind: r.op,
      text: r.text.endsWith('\r') ? r.text.slice(0, -1) : r.text,
      ...(r.op !== 'add' && { oldNo: r.oldNo }),
      ...(r.op !== 'del' && { newNo: r.newNo }),
    }));
    const oldLines = slice.filter((r) => r.op !== 'add').length;
    const newLines = slice.filter((r) => r.op !== 'del').length;
    const oldStart = slice[0]!.oldNo;
    const newStart = slice[0]!.newNo;
    const id = createHash('sha1')
      .update(file)
      .update('\0')
      .update(slice.map((r) => `${r.op}${r.text}`).join('\n'))
      .digest('hex')
      .slice(0, 16);
    return { id, oldStart, oldLines, newStart, newLines, lines };
  });
}

/**
 * The file with one block put back as it was: its lines on the new side are replaced by the
 * lines it had. Null when the file no longer has those lines there: it changed since.
 */
export function revertHunk(
  modified: readonly string[],
  hunk: { newStart: number; before: readonly string[]; after: readonly string[] },
): string[] | null {
  const at = hunk.newStart - 1;
  const current = modified.slice(at, at + hunk.after.length).map(stripCr);
  if (current.length !== hunk.after.length || current.some((l, i) => l !== hunk.after[i])) {
    return null;
  }
  // The restored lines take the line ending the file uses around them.
  const crlf = modified.some((l) => l.endsWith('\r'));
  return [
    ...modified.slice(0, at),
    ...hunk.before.map((l) => (crlf ? `${l}\r` : l)),
    ...modified.slice(at + hunk.after.length),
  ];
}

const stripCr = (line: string) => (line.endsWith('\r') ? line.slice(0, -1) : line);
