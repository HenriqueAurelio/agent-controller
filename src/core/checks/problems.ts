// Reads the errors and warnings a check prints, while it prints them. The output of a tool is not
// kept whole (only its end is): each line goes through the readers as it arrives, and what they
// recognise is kept, up to a limit. One reader per tool, chosen by the command; a generic one that
// understands `file:line:column: message` is the fallback for any tool the app does not know.
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { PROBLEMS_LIMIT, stripAnsi, type Problem } from '@shared/checks';
import { findLocations } from '@shared/locations';

/** A problem before it is tied to a check and to the folder it ran in. */
export interface RawProblem {
  file: string;
  line: number;
  column?: number;
  severity: 'error' | 'warning';
  message: string;
}

type Emit = (problem: RawProblem) => void;

/** One tool's reading of its own output, a line at a time. */
interface LineReader {
  line(text: string): void;
}

export const MESSAGE_LIMIT = 300;
/** A line this long is minified output or a dump: it is not read, and its buffer is cut. */
const LINE_BUFFER = 4000;

const clip = (text: string) =>
  text.length > MESSAGE_LIMIT ? `${text.slice(0, MESSAGE_LIMIT - 1)}…` : text;

const num = (value: string | undefined) => (value === undefined ? undefined : Number(value));

const isWarning = (text: string) => /^\s*(?:\[?warn(?:ing)?\b|.*\bwarning\b)/i.test(text);

/** tsc: `file(12,5): error TS2322: ...`, or the pretty form `file:12:5 - error TS2322: ...`. */
function tscReader(emit: Emit): LineReader {
  const plain = /^(.+?)\((\d+),(\d+)\):\s+(error|warning)\s+(TS\d+):\s*(.*)$/;
  const pretty = /^(.+?):(\d+):(\d+)\s+-\s+(error|warning)\s+(TS\d+):\s*(.*)$/;
  return {
    line(text) {
      const m = plain.exec(text) ?? pretty.exec(text);
      if (!m) return;
      emit({
        file: m[1]!.trim(),
        line: Number(m[2]),
        column: num(m[3]),
        severity: m[4] === 'warning' ? 'warning' : 'error',
        message: clip(`${m[5]}: ${m[6]}`),
      });
    },
  };
}

/** eslint: the `stylish` format (a file line, then indented `12:5  error  message  rule`). */
function eslintReader(emit: Emit): LineReader {
  const issue = /^\s+(\d+):(\d+)\s+(error|warning)\s+(.*?)(?:\s{2,}([@\w/.-]+))?\s*$/;
  let header: string | null = null;
  return {
    line(text) {
      if (text.trim() === '') {
        header = null;
        return;
      }
      if (!/^\s/.test(text)) {
        // A file name has a folder or an extension in it; the summary lines do not.
        header = /[\\/]|\.\w+$/.test(text.trim()) && !/\s{2,}|^✖/.test(text) ? text.trim() : null;
        return;
      }
      const m = issue.exec(text);
      if (!m || !header) return;
      emit({
        file: header,
        line: Number(m[1]),
        column: num(m[2]),
        severity: m[3] === 'warning' ? 'warning' : 'error',
        message: clip(m[5] ? `${m[4]} (${m[5]})` : m[4]!),
      });
    },
  };
}

const STACK_SKIP = /node_modules|node:internal|^node:/;

/**
 * vitest and jest: a failure has a title and, in its stack, the first line inside the project is
 * where it happened. The rest of the stack is the framework's own.
 */
function testReader(emit: Emit): LineReader {
  let title: string | null = null;
  let error: string | null = null;
  return {
    line(text) {
      const failure =
        /^\s*(?:FAIL|✗|×)\s+(.*)$/.exec(text) ?? /^\s*●\s+(.*?)(?:\s+\(\d+\s*ms\))?\s*$/.exec(text);
      if (failure) {
        const name = failure[1]!.trim();
        // `FAIL src/a.test.ts` (jest) is a file; the test comes with the `●` line after it.
        const parts = name.split(/\s+[>›]\s+/);
        if (parts.length > 1 || text.includes('●')) {
          title = clip(
            text.includes('●') ? name : parts.length > 1 ? parts.slice(1).join(' > ') : name,
          );
          error = null;
        }
        return;
      }
      if (title === null) return;
      if (error === null) {
        const e = /^\s*((?:[A-Z]\w*)?Error\b.*)$/.exec(text);
        if (e) error = e[1]!.trim();
      }
      const stack = /^\s*(?:❯|at\s)/.test(text) ? findLocations(text) : [];
      const where = stack.find((l) => l.line !== undefined && !STACK_SKIP.test(l.path));
      if (!where) return;
      emit({
        file: where.path,
        line: where.line!,
        column: where.column,
        severity: 'error',
        message: clip(error ? `${title}: ${error}` : title),
      });
      title = null;
      error = null;
    },
  };
}

/** cargo: `error[E0308]: mismatched types`, then ` --> src/main.rs:2:5`. */
function cargoReader(emit: Emit): LineReader {
  let head: { severity: 'error' | 'warning'; message: string } | null = null;
  return {
    line(text) {
      const h = /^(error|warning)(?:\[(\w+)\])?:\s+(.*)$/.exec(text);
      if (h) {
        head = {
          severity: h[1] === 'warning' ? 'warning' : 'error',
          message: clip(h[2] ? `${h[2]}: ${h[3]}` : h[3]!),
        };
        return;
      }
      const at = /^\s*-->\s+(.+?):(\d+):(\d+)\s*$/.exec(text);
      if (!at || !head) return;
      emit({ file: at[1]!, line: Number(at[2]), column: num(at[3]), ...head });
      head = null;
    },
  };
}

/** Any `file:line:column: message` (eslint unix, ruff, go vet, pytest, gcc...). */
function genericReader(emit: Emit): LineReader {
  return {
    line(text) {
      if (text.length > 1000) return;
      const where = findLocations(text).find((l) => l.line !== undefined);
      // The place comes first: a stack frame or a prose mention is not a problem of its own.
      if (!where || text.slice(0, where.start).trim() !== '') return;
      const message = text
        .slice(where.end)
        .replace(/^[\s:,"'()-]*(?:line\s+\d+[\s:,-]*)?/i, '')
        .trim();
      if (!message) return;
      // The severity says it already: the word is not repeated in the message.
      const plain = message.replace(/^(?:warning|warn|error)\b[:\s-]*/i, '') || message;
      emit({
        file: where.path,
        line: where.line!,
        column: where.column,
        severity: isWarning(message) ? 'warning' : 'error',
        message: clip(plain),
      });
    },
  };
}

interface Tool {
  /** Words in the command that say which tool runs. */
  command: RegExp;
  reader(emit: Emit): LineReader;
}

const TOOLS: Tool[] = [
  { command: /\b(?:vue-)?tsc\b/i, reader: tscReader },
  { command: /\beslint\b/i, reader: eslintReader },
  { command: /\b(?:vitest|jest)\b/i, reader: testReader },
  { command: /\bcargo\b/i, reader: cargoReader },
];

/**
 * The readers for a command. A script name (`npm run lint`) says nothing of the tool behind it,
 * so then all of them listen: each one only reacts to the shape of its own output.
 */
function readersFor(command: string): Tool[] {
  const named = TOOLS.filter((tool) => tool.command.test(command));
  return named.length > 0 ? named : TOOLS;
}

/** What the folder says of a path the tool printed: where it is, and whether it is a file. */
export function normalizeProblemFile(file: string, cwd: string): string {
  let clean = file.trim().replace(/^["']|["']$/g, '');
  if (/^file:\/\//i.test(clean)) clean = decodeURI(clean.replace(/^file:\/\/\/?/i, ''));
  const absolute = /^(?:[A-Za-z]:[\\/]|[\\/])/.test(clean);
  if (absolute) {
    const relative = path.relative(cwd, clean);
    if (relative && !relative.startsWith('..') && !path.isAbsolute(relative)) clean = relative;
  }
  return clean.replace(/\\/g, '/').replace(/^(?:\.\/)+/, '');
}

export interface ProblemReaderOptions {
  command: string;
  /** The label and id of the check, written on every problem. */
  source: string;
  checkId: string;
  limit?: number;
}

export interface ProblemsFound {
  problems: Problem[];
  /** How many more there were beyond the limit. */
  more: number;
}

class Collector {
  readonly items: RawProblem[] = [];
  more = 0;
  private readonly seen = new Set<string>();
  constructor(private readonly limit: number) {}
  readonly add: Emit = (problem) => {
    const key = `${problem.file}\0${problem.line}\0${problem.column ?? ''}\0${problem.message}`;
    if (this.seen.has(key)) return;
    if (this.items.length >= this.limit) {
      this.more++;
      return;
    }
    this.seen.add(key);
    this.items.push(problem);
  };
}

/**
 * Gets the problems out of the output of one check as it is written. Memory stays flat however
 * much is printed: a partial line, and at most `limit` problems of each reader.
 */
export class ProblemReader {
  private readonly specific: Collector;
  private readonly generic: Collector;
  private readonly readers: LineReader[];
  private readonly fallback: LineReader;
  /** A partial line per channel (stdout, stderr): their chunks do not meet in the middle of one. */
  private readonly partial: string[] = [];
  private fed = false;

  constructor(private readonly options: ProblemReaderOptions) {
    const limit = options.limit ?? PROBLEMS_LIMIT;
    this.specific = new Collector(limit);
    this.generic = new Collector(limit);
    this.readers = readersFor(options.command).map((tool) => tool.reader(this.specific.add));
    this.fallback = genericReader(this.generic.add);
  }

  /** True once any output arrived. */
  get hasInput(): boolean {
    return this.fed;
  }

  push(chunk: string, channel = 0): void {
    if (chunk === '') return;
    this.fed = true;
    const lines = ((this.partial[channel] ?? '') + chunk).split('\n');
    this.partial[channel] = (lines.pop() ?? '').slice(0, LINE_BUFFER);
    for (const line of lines) this.read(line);
  }

  private read(raw: string): void {
    const text = stripAnsi(raw).replace(/\r$/, '');
    for (const reader of this.readers) reader.line(text);
    this.fallback.line(text);
  }

  /**
   * The problems, once the output is over. Those of the specific readers win; when none of them
   * found anything, the generic ones stand, minus the paths that are not files of the folder
   * (a generic match may be any text that looks like a place).
   */
  async finish(
    cwd: string,
    isFile: (absolute: string) => Promise<boolean> = defaultIsFile,
  ): Promise<ProblemsFound> {
    for (const [channel, rest] of this.partial.entries()) {
      if (rest) this.read(rest);
      this.partial[channel] = '';
    }
    const useGeneric = this.specific.items.length === 0;
    const chosen = useGeneric ? this.generic : this.specific;
    const problems: Problem[] = [];
    for (const raw of chosen.items) {
      const file = normalizeProblemFile(raw.file, cwd);
      if (!file) continue;
      if (useGeneric && !(await isFile(path.resolve(cwd, file)))) continue;
      problems.push({
        file,
        line: raw.line,
        ...(raw.column !== undefined && { column: raw.column }),
        severity: raw.severity,
        message: raw.message,
        source: this.options.source,
        checkId: this.options.checkId,
      });
    }
    return { problems, more: chosen.more };
  }
}

async function defaultIsFile(absolute: string): Promise<boolean> {
  try {
    return (await fs.stat(absolute)).isFile();
  } catch {
    return false;
  }
}
