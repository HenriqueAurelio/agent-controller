// Pull requests of the repositories the user watches, as the panel and the notices see them.
// GitHub for now; GitLab and Bitbucket come in through other adapters of the same shape.

export type PipelineState = 'success' | 'failure' | 'pending' | 'none';
export type JobState = 'success' | 'failure' | 'pending' | 'skipped';

export interface PipelineJob {
  name: string;
  state: JobState;
  /** Where the job is on the site of the service. */
  url: string | null;
}

export interface PullRequestView {
  /** `owner/repo#12`: unique across every watched repository. */
  key: string;
  repo: string;
  number: number;
  title: string;
  url: string;
  author: string;
  /** Opened by the account the app reads with. */
  mine: boolean;
  draft: boolean;
  branch: string;
  base: string;
  /** ISO 8601. */
  createdAt: string;
  updatedAt: string;
  /** What the reviews say so far; null when the repository asks for none. */
  review: 'approved' | 'changes' | 'required' | null;
  /** Who was asked to review and has not yet. */
  reviewers: string[];
  /** The account the app reads with is among them. */
  reviewRequested: boolean;
  /** Comments and reviews, all together. */
  comments: number;
  /** Who left the latest comment or review. */
  lastCommentBy: string | null;
  pipeline: { state: PipelineState; sha: string; jobs: PipelineJob[] };
}

/**
 * `noCli`: the service's command line tool is not installed; `loggedOut`: it is, with no login;
 * `error`: the service could not be reached or answered with an error.
 */
export type PullsStatus = 'idle' | 'ok' | 'noCli' | 'loggedOut' | 'error';

export interface PullsState {
  status: PullsStatus;
  /** For `error`, as the user reads it. */
  error?: string;
  /** The account the app reads with. */
  login: string | null;
  repos: string[];
  /** Repositories that could not be read (not found, no access), with the reason. */
  repoErrors: Record<string, string>;
  /** Open pull requests, the latest update first. */
  pulls: PullRequestView[];
  /** Epoch milliseconds of the latest successful look. */
  checkedAt: number | null;
  loading: boolean;
}

export interface PullsSettings {
  /** `owner/name` of each repository watched. */
  repos: string[];
  /** The account of `gh` to read with; empty for the one that is active. */
  account: string;
  notifyFailed: boolean;
  notifyComments: boolean;
  notifyReview: boolean;
}

export const PULLS_REPOS_LIMIT = 40;
/** How often the services are asked again. */
export const PULLS_INTERVAL_MS = 60_000;
/** The id of the prompt that sends a failed pipeline to an agent. */
export const FIX_PIPELINE_PROMPT_ID = 'fix-pipeline';
/** `{pipeline}` is cut here: the end of the log of each failed job, a few of them. */
export const PIPELINE_TEXT_LIMIT = 20_000;

export const DEFAULT_PULLS_SETTINGS: PullsSettings = {
  repos: [],
  account: '',
  notifyFailed: true,
  notifyComments: true,
  notifyReview: true,
};

const PART = /^[A-Za-z0-9_.-]{1,100}$/;
const ACCOUNT = /^[A-Za-z0-9-]{1,39}$/;

/**
 * `owner/name` out of what someone may paste: the name itself, the address of the page, or the
 * address used to clone it. Null for anything else.
 */
export function normalizeRepo(value: string): string | null {
  const text = value
    .trim()
    .replace(/^git@github\.com:/i, '')
    .replace(/^(?:https?:\/\/)?(?:www\.)?github\.com\//i, '')
    .replace(/[?#].*$/, '')
    .replace(/\/+$/, '')
    .replace(/\.git$/i, '');
  const [owner, name, ...rest] = text.split('/');
  // A link to a page inside the repository (`/pull/3`, `/tree/main`) still names it.
  if (!owner || !name || (rest.length > 0 && !/github\.com/i.test(value))) return null;
  return PART.test(owner) && PART.test(name) && name !== '.' && name !== '..'
    ? `${owner}/${name}`
    : null;
}

/** Repositories separated by commas, spaces or lines, as pasted; what could not be read apart. */
export function parseRepoList(text: string): { repos: string[]; invalid: string[] } {
  const repos: string[] = [];
  const invalid: string[] = [];
  const seen = new Set<string>();
  for (const piece of text.split(/[\s,;]+/)) {
    if (!piece) continue;
    const repo = normalizeRepo(piece);
    if (!repo) {
      invalid.push(piece);
      continue;
    }
    const key = repo.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    repos.push(repo);
  }
  return { repos, invalid };
}

export function sanitizePullsSettings(value: unknown): PullsSettings {
  const v = (value && typeof value === 'object' ? value : {}) as Record<string, unknown>;
  const list = Array.isArray(v.repos) ? v.repos.filter((r) => typeof r === 'string') : [];
  const flag = (name: keyof PullsSettings) =>
    typeof v[name] === 'boolean' ? (v[name] as boolean) : (DEFAULT_PULLS_SETTINGS[name] as boolean);
  const account = typeof v.account === 'string' ? v.account.trim() : '';
  return {
    repos: parseRepoList(list.join(',')).repos.slice(0, PULLS_REPOS_LIMIT),
    account: ACCOUNT.test(account) ? account : '',
    notifyFailed: flag('notifyFailed'),
    notifyComments: flag('notifyComments'),
    notifyReview: flag('notifyReview'),
  };
}

export const EMPTY_PULLS_STATE: PullsState = {
  status: 'idle',
  login: null,
  repos: [],
  repoErrors: {},
  pulls: [],
  checkedAt: null,
  loading: false,
};
