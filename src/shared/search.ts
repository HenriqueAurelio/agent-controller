// Searching the text of the project of a session, from the panel, and sending what was found to
// the agent.

export interface SearchQuery {
  text: string;
  caseSensitive: boolean;
  wholeWord: boolean;
  regex: boolean;
  /** Paths or globs to look in (`src/**`); empty: everywhere. */
  include: string[];
  /** Paths or globs to leave out (`*.test.ts`). */
  exclude: string[];
  /** Only the files the session changed. */
  changedOnly: boolean;
}

export interface SearchMatch {
  /** Relative to the root of the panel, with forward slashes. */
  file: string;
  line: number;
  column: number;
  text: string;
}

export interface SearchResult {
  matches: SearchMatch[];
  /** Stopped at the limit: there are more. */
  truncated: boolean;
}

export const SEARCH_RESULTS_LIMIT = 2000;
export const SEARCH_TEXT_LIMIT = 500;
/** A line of a match is cut here: a minified file has lines of megabytes. */
export const SEARCH_LINE_LIMIT = 300;

/** Keywords that declare a name, in the languages the projects of the users are in. */
const DECLARATIONS = [
  'function',
  'class',
  'interface',
  'type',
  'enum',
  'const',
  'let',
  'var',
  'def',
  'fn',
  'func',
  'struct',
  'trait',
  'module',
  'namespace',
];

/** A name the editor can look for: letters, digits, `_` and `$`. */
export const IDENTIFIER = /^[A-Za-z_$][\w$]{0,99}$/;

/**
 * The search that finds where a name is declared: a keyword followed by it (`function total`,
 * `class Pedido`, `def total`), or a method (`total(` at the start of a line, after spaces).
 */
export function definitionQuery(name: string): SearchQuery {
  const word = name.replace(/\$/g, '\\$');
  return {
    text: String.raw`\b(?:export\s+)?(?:default\s+)?(?:async\s+)?(?:${DECLARATIONS.join('|')})\s+${word}\b|^\s*(?:(?:public|private|protected|static|async|get|set)\s+)*${word}\s*\(.*\)\s*[:{]`,
    caseSensitive: true,
    wholeWord: false,
    regex: true,
    include: [],
    exclude: [],
    changedOnly: false,
  };
}

/** The results as the agent reads them: `file:line: text`, one per line. */
export function searchText(matches: readonly SearchMatch[]): string {
  return matches.map((m) => `${m.file}:${m.line}: ${m.text.trim()}`).join('\n');
}
