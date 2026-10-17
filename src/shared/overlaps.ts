// Sessions in different copies of the same repository that change the same files: what the
// list and the changes panel warn about, before the branches are merged.

/** What the list shows of a session: how many of its files other sessions also changed. */
export interface OverlapSummary {
  /** Files of the session that another session also changed. */
  files: number;
  /** Of those, the ones where the changed lines cross: a likely conflict at the merge. */
  likely: number;
  /** The other sessions, in the order of the list. */
  sessionIds: string[];
}

/** A file of the session that other sessions also changed. */
export interface OverlapFile {
  /** Relative to the root of the repository, as the changes panel lists it. */
  path: string;
  /** The changed lines cross those of at least one of the other sessions. */
  likely: boolean;
  others: OverlapOther[];
}

export interface OverlapOther {
  sessionId: string;
  /** The same file as the other session spells it (on Windows the case may differ). */
  path: string;
  likely: boolean;
}

export interface OverlapSettings {
  enabled: boolean;
  /** Stopped sessions count too: their copy still holds the work of their agent. */
  includeStopped: boolean;
  /** Patterns of files the warning leaves out (`*` within a folder, `**` across them). */
  ignored: string[];
}

export const DEFAULT_OVERLAP_IGNORED: readonly string[] = [
  'package-lock.json',
  'npm-shrinkwrap.json',
  'pnpm-lock.yaml',
  'yarn.lock',
  'bun.lockb',
  'bun.lock',
  'Cargo.lock',
  'poetry.lock',
  'uv.lock',
  'Pipfile.lock',
  'composer.lock',
  'Gemfile.lock',
  'go.sum',
];

export const DEFAULT_OVERLAP_SETTINGS: OverlapSettings = {
  enabled: true,
  includeStopped: true,
  ignored: [...DEFAULT_OVERLAP_IGNORED],
};

export const OVERLAP_IGNORED_LIMIT = 200;
const PATTERN_LIMIT = 300;

export function sanitizeOverlapSettings(value: unknown): OverlapSettings {
  const v = (value && typeof value === 'object' ? value : {}) as Partial<OverlapSettings>;
  const ignored: string[] = [];
  const given = Array.isArray(v.ignored) ? v.ignored : DEFAULT_OVERLAP_SETTINGS.ignored;
  for (const item of given) {
    if (typeof item !== 'string') continue;
    const pattern = item.trim().replaceAll('\\', '/');
    if (pattern && pattern.length <= PATTERN_LIMIT && !ignored.includes(pattern)) {
      ignored.push(pattern);
    }
  }
  return {
    enabled: v.enabled !== false,
    includeStopped: v.includeStopped !== false,
    ignored: ignored.slice(0, OVERLAP_IGNORED_LIMIT),
  };
}

/** `*` is any run of characters but a separator, `**` any run at all, `?` one character. */
function globToRegExp(pattern: string): RegExp {
  let source = '';
  for (let i = 0; i < pattern.length; i++) {
    const c = pattern[i]!;
    if (c === '*' && pattern[i + 1] === '*') {
      source += '.*';
      i++;
    } else if (c === '*') source += '[^/]*';
    else if (c === '?') source += '[^/]';
    else source += c.replace(/[.+^${}()|[\]\\]/g, '\\$&');
  }
  return new RegExp(`^${source}$`, 'i');
}

/**
 * Whether the warning leaves a file out. A pattern with a `/` is matched against the whole path,
 * one without against the name, wherever the file is: `package-lock.json` covers every one.
 */
export function overlapIgnoredMatcher(patterns: readonly string[]): (file: string) => boolean {
  const compiled = patterns.map((pattern) => ({
    whole: pattern.includes('/'),
    test: globToRegExp(pattern.replace(/^\//, '')),
  }));
  return (file) => {
    const name = file.slice(file.lastIndexOf('/') + 1);
    return compiled.some(({ whole, test }) => test.test(whole ? file : name));
  };
}

export const sameOverlapSummary = (
  a: OverlapSummary | undefined,
  b: OverlapSummary | undefined,
): boolean =>
  a === b ||
  (a !== undefined &&
    b !== undefined &&
    a.files === b.files &&
    a.likely === b.likely &&
    a.sessionIds.join('\0') === b.sessionIds.join('\0'));
