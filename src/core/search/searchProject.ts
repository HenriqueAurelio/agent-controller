// Searches the text of a folder: `git grep` inside a repository (it skips what .gitignore
// covers and binary files, and takes untracked files too), and a plain walk over the files the
// quick-open box lists outside one. One process per search, with a deadline; nothing stays.
import fs from 'node:fs';
import path from 'node:path';
import { UserError } from '@shared/i18n';
import {
  SEARCH_LINE_LIMIT,
  SEARCH_RESULTS_LIMIT,
  type SearchMatch,
  type SearchQuery,
  type SearchResult,
} from '@shared/search';
import { buildFileIndex } from '../git/FileIndex';
import { runTool } from '../tools/ToolRunner';

const SEARCH_TIMEOUT_MS = 30_000;
/** Outside git, files larger than this are not read: they are rarely what is looked for. */
const WALK_FILE_LIMIT = 1024 * 1024;

const cut = (text: string) =>
  text.length > SEARCH_LINE_LIMIT ? `${text.slice(0, SEARCH_LINE_LIMIT)}…` : text;

/** The pattern as JavaScript reads it, for the walk outside git. */
export function queryRegex(query: SearchQuery): RegExp {
  const source = query.regex ? query.text : query.text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const word = query.wholeWord ? `\\b(?:${source})\\b` : source;
  try {
    return new RegExp(word, query.caseSensitive ? '' : 'i');
  } catch {
    throw new UserError('error.search.badRegex');
  }
}

/** A pathspec of git for an include or exclude pattern. */
function pathspec(pattern: string, exclude: boolean): string {
  const clean = pattern.trim().replace(/\\/g, '/').replace(/^\.\//, '');
  return `:(${exclude ? 'exclude,' : ''}glob)${clean.includes('/') || clean.includes('**') ? clean : `**/${clean}`}`;
}

/** `file\0line\0column\0text` lines of `git grep -z -n --column`. */
export function parseGitGrep(output: string, limit = SEARCH_RESULTS_LIMIT): SearchResult {
  const matches: SearchMatch[] = [];
  for (const line of output.split('\n')) {
    if (!line) continue;
    const [file, lineNo, column, ...rest] = line.split('\0');
    if (!file || !lineNo || rest.length === 0) continue;
    if (matches.length >= limit) return { matches, truncated: true };
    matches.push({
      file,
      line: Number(lineNo),
      column: Number(column) || 1,
      text: cut(rest.join('\0').replace(/\r$/, '')),
    });
  }
  return { matches, truncated: false };
}

async function gitGrep(
  root: string,
  query: SearchQuery,
  changed: readonly string[],
  // Perl's patterns read like JavaScript's (\d, \s); a git built without PCRE falls back to -E.
  flavor: '-P' | '-E' = '-P',
): Promise<SearchResult> {
  const args = ['-c', 'core.quotepath=off', 'grep', '-z', '-n', '--column', '-I', '--untracked'];
  if (!query.caseSensitive) args.push('-i');
  if (query.wholeWord) args.push('-w');
  args.push(query.regex ? flavor : '-F', '-e', query.text, '--');
  if (query.changedOnly) args.push(...changed.map((file) => `:(literal)${file}`));
  else args.push(...query.include.map((p) => pathspec(p, false)));
  args.push(...query.exclude.map((p) => pathspec(p, true)));
  if (query.changedOnly && changed.length === 0) return { matches: [], truncated: false };
  let seen = 0;
  const controller = new AbortController();
  const result = await runTool({
    file: 'git',
    args,
    cwd: root,
    env: { ...process.env, GIT_TERMINAL_PROMPT: '0' },
    timeoutMs: SEARCH_TIMEOUT_MS,
    maxOutputChars: 4 * 1024 * 1024,
    signal: controller.signal,
    // Past the limit there is nothing more to read: the search stops there.
    onData: (chunk, channel) => {
      if (channel !== 0) return;
      seen += chunk.split('\n').length - 1;
      if (seen > SEARCH_RESULTS_LIMIT) controller.abort();
    },
  });
  if (result.timedOut) throw new UserError('error.search.timeout');
  // 1 is "nothing found"; 128 and up, a bad pattern or a problem of git.
  if (!result.cancelled && result.exitCode !== 0 && result.exitCode !== 1) {
    if (query.regex && flavor === '-P' && /pcre|perl/i.test(result.stderr)) {
      return gitGrep(root, query, changed, '-E');
    }
    if (/regex|regexp|invalid/i.test(result.stderr)) throw new UserError('error.search.badRegex');
    throw new UserError('error.search.failed', { output: result.stderr.trim().slice(-500) });
  }
  return parseGitGrep(result.stdout);
}

async function walk(root: string, query: SearchQuery): Promise<SearchResult> {
  const regex = queryRegex(query);
  const index = await buildFileIndex(root, { showHidden: false });
  const matches: SearchMatch[] = [];
  const includes = query.include.map(globTest);
  const excludes = query.exclude.map(globTest);
  for (const file of index.files) {
    if (includes.length && !includes.some((t) => t(file))) continue;
    if (excludes.some((t) => t(file))) continue;
    const absolute = path.join(root, file);
    const stat = await fs.promises.stat(absolute).catch(() => null);
    if (!stat || stat.size > WALK_FILE_LIMIT) continue;
    const text = await fs.promises.readFile(absolute, 'utf8').catch(() => '');
    if (text.includes('\0')) continue;
    const lines = text.split('\n');
    for (let i = 0; i < lines.length; i++) {
      const found = regex.exec(lines[i]!);
      if (!found) continue;
      if (matches.length >= SEARCH_RESULTS_LIMIT) return { matches, truncated: true };
      matches.push({
        file,
        line: i + 1,
        column: found.index + 1,
        text: cut(lines[i]!.replace(/\r$/, '')),
      });
    }
  }
  return { matches, truncated: false };
}

/** A glob of the include and exclude fields as a test of a path. */
function globTest(pattern: string): (file: string) => boolean {
  const clean = pattern.trim().replace(/\\/g, '/').replace(/^\.\//, '');
  const source = clean
    .replace(/[.+^${}()|[\]\\]/g, '\\$&')
    .replace(/\*\*\//g, '(?:.*/)?')
    .replace(/\*\*/g, '.*')
    .replace(/\*/g, '[^/]*')
    .replace(/\?/g, '[^/]');
  const regex = new RegExp(clean.includes('/') ? `^${source}$` : `(?:^|/)${source}$`);
  return (file) => regex.test(file);
}

/** Searches `root`; `inGit` picks git grep, `changed` are the files the session changed. */
export async function searchProject(
  root: string,
  query: SearchQuery,
  options: { inGit: boolean; changed: readonly string[] },
): Promise<SearchResult> {
  if (!query.text) return { matches: [], truncated: false };
  // The pattern is checked here, so a bad one says so in words and not as git's output.
  if (query.regex) queryRegex(query);
  if (options.inGit) return gitGrep(root, query, options.changed);
  if (query.changedOnly) return { matches: [], truncated: false };
  return walk(root, query);
}
