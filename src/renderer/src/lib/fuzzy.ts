// Fuzzy matching of file names, in the way of the quick-open boxes of editors: the letters of the
// query must appear in order, and a match scores more when it lands on the start of a word
// (after `/`, `_`, `-`, `.` or a space), on a capital of a camelCase name, next to the previous
// letter, and in the name of the file rather than in its folders.

export interface FuzzyMatch {
  score: number;
  /** Indexes in the text of the letters that matched, for highlighting. */
  positions: number[];
}

const WORD_START = 8;
const CAMEL = 7;
const CONSECUTIVE = 5;
const IN_NAME = 3;
const GAP = 0.5;
const MAX_LENGTH = 1024;
const MAX_QUERY = 32;

// The tables of the scoring, reused by every call: a search runs it for each of tens of thousands
// of paths per key, and allocating them each time was most of its cost.
const best = new Float64Array(MAX_QUERY * MAX_LENGTH);
const back = new Int32Array(MAX_QUERY * MAX_LENGTH);

const isSeparator = (char: string) =>
  char === '/' || char === '_' || char === '-' || char === '.' || char === ' ';
const isUpper = (char: string) => char !== char.toLowerCase();
const isLower = (char: string) => char !== char.toUpperCase();

/** How much a letter matched at `index` is worth for where it is, whatever came before it. */
function bonus(text: string, index: number, nameStart: number): number {
  let value = index >= nameStart ? IN_NAME : 0;
  if (index === 0 || isSeparator(text[index - 1]!)) value += WORD_START;
  else if (isUpper(text[index]!) && isLower(text[index - 1]!)) value += CAMEL;
  return value;
}

/** Null when the letters of `query` do not appear, in order, in `text`. */
export function fuzzyMatch(query: string, text: string): FuzzyMatch | null {
  const wanted = query.toLowerCase().replace(/\s+/g, '').slice(0, MAX_QUERY);
  const n = wanted.length;
  if (n === 0) return { score: 0, positions: [] };
  if (text.length > MAX_LENGTH || text.length < n) return null;
  const lower = text.toLowerCase();

  // A cheap check first: most of the files fail it, and the scoring below is not cheap.
  let from = 0;
  for (const char of wanted) {
    from = lower.indexOf(char, from) + 1;
    if (from === 0) return null;
  }

  const m = text.length;
  const nameStart = text.lastIndexOf('/') + 1;
  // best[i * m + j]: the best score with letter i of the query matched at position j of the text.
  best.fill(-Infinity, 0, n * m);
  back.fill(-1, 0, n * m);
  for (let i = 0; i < n; i++) {
    const row = i * m;
    // The best way to have matched the letters before this one, at a position before `j`,
    // minus the cost of the letters skipped since.
    let carry = -Infinity;
    let carryAt = -1;
    for (let j = 0; j < m; j++) {
      if (i > 0 && j > 0) {
        const previous = best[row - m + j - 1]!;
        carry = carry - GAP;
        if (previous > carry) {
          carry = previous;
          carryAt = j - 1;
        }
      }
      if (lower[j] !== wanted[i]) continue;
      const own = bonus(text, j, nameStart) + 1;
      if (i === 0) {
        best[row + j] = own - j * 0.02;
        continue;
      }
      if (carry === -Infinity) continue;
      let score = carry + own;
      if (carryAt === j - 1) score += CONSECUTIVE;
      best[row + j] = score;
      back[row + j] = carryAt;
    }
  }

  const lastRow = (n - 1) * m;
  let end = -1;
  let top = -Infinity;
  for (let j = 0; j < m; j++) {
    if (best[lastRow + j]! > top) {
      top = best[lastRow + j]!;
      end = j;
    }
  }
  if (end < 0) return null;
  const positions: number[] = new Array<number>(n);
  let at = end;
  for (let i = n - 1; i >= 0; i--) {
    positions[i] = at;
    at = back[i * m + at]!;
  }
  // Between two equal matches the shorter path is the likelier one.
  return { score: top - m * 0.01, positions };
}

export interface RankedFile {
  path: string;
  score: number;
  positions: number[];
}

/** The best `limit` files for `query`, best first. */
export function rankFiles(files: readonly string[], query: string, limit: number): RankedFile[] {
  const ranked: RankedFile[] = [];
  for (const path of files) {
    const match = fuzzyMatch(query, path);
    if (match) ranked.push({ path, score: match.score, positions: match.positions });
  }
  ranked.sort((a, b) => b.score - a.score || a.path.length - b.path.length);
  return ranked.slice(0, limit);
}

export interface FileQuery {
  /** What names the file. */
  name: string;
  line?: number;
  column?: number;
}

/** `name`, `name:42` and `name:42:7`. A colon with no number after it is dropped. */
export function parseFileQuery(text: string): FileQuery {
  const match = /^(.*?)(?::(\d+)(?::(\d+))?)?:?$/.exec(text.trim());
  const name = match?.[1] ?? text.trim();
  const line = match?.[2] ? Number(match[2]) : undefined;
  const column = match?.[3] ? Number(match[3]) : undefined;
  return {
    name,
    ...(line && line > 0 ? { line } : {}),
    ...(line && line > 0 && column && column > 0 ? { column } : {}),
  };
}
