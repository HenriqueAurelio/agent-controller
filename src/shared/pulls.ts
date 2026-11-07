// Pull requests (merge requests, on GitLab) of the repositories the user watches, as the panel
// and the notices see them. Each service has an adapter of the same shape in src/core/forges.

/** The service a repository lives on. */
export type Forge = 'github' | 'gitlab';

export type PipelineState = 'success' | 'failure' | 'pending' | 'none';
export type JobState = 'success' | 'failure' | 'pending' | 'skipped';

export interface PipelineJob {
  name: string;
  state: JobState;
  /** Where the job is on the site of the service. */
  url: string | null;
}

export interface PullRequestView {
  /** `owner/repo#12`, or `host/group/project!12`: unique across every watched repository. */
  key: string;
  forge: Forge;
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

/** A service that could not be read in the latest look, while the others may have been. */
/** The accounts logged in to `gh` on github.com, to pick the one that reads the repositories. */
export interface GhAccounts {
  accounts: string[];
  /** The one `gh` uses when none is named; empty when unknown. */
  active: string;
}

/** The repositories of one service the accounts can see, or why they could not be listed. */
export interface AvailableRepos {
  repos: string[];
  problem?: ForgeProblem;
}

export const FORGES: readonly Forge[] = ['github', 'gitlab'];

export interface ForgeProblem {
  forge: Forge;
  status: 'noCli' | 'loggedOut' | 'error';
  /** For `error`, as the user reads it. */
  error?: string;
  /** The GitLab server without a login. */
  host?: string;
}

export interface PullsState {
  /** `ok` when at least one service answered; otherwise what went wrong with the first. */
  status: PullsStatus;
  /** For `error`, as the user reads it. */
  error?: string;
  /** The account the app reads with, on each service. */
  logins: Partial<Record<Forge, string>>;
  problems: ForgeProblem[];
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
  /** Each repository watched: `owner/name` on GitHub, `host/group/project` on GitLab. */
  repos: string[];
  /** The account of `gh` to read with; empty for the one that is active. */
  account: string;
  notifyFailed: boolean;
  notifyComments: boolean;
  notifyReview: boolean;
  /** The keys of my pull requests whose failed pipeline goes to the agent by itself. */
  guarded?: string[];
}

/** An open issue of a repository, to become a card of the task board. */
export interface ForgeIssue {
  number: number;
  title: string;
  body: string;
  url: string;
  author: string;
  labels: string[];
}

/** The issues of the repository of a folder: which repository that is, and its open issues. */
export interface IssueList {
  /** As the watched list names it; null when the folder has no remote of GitHub or GitLab. */
  repo: string | null;
  issues: ForgeIssue[];
  /** Why they could not be read, as the user reads it. */
  error?: string;
}

/** Open issues read at once. */
export const ISSUES_LIMIT = 50;

/** The pull request as `{pr}` reads: reference, title, branches and link. */
export const pullSummary = (pull: PullRequestView): string =>
  `${pullRef(pull)}: ${pull.title}\n${pull.branch} → ${pull.base}\n${pull.url}`;

/** How many failed pipelines in a row the guard sends to the agent before it stops. */
export const GUARD_ATTEMPTS = 3;
export const GUARDED_LIMIT = 40;

/**
 * `watching`: nothing to do; `sent`: the latest failure went to the agent; `noSession`: it failed
 * and no session is on its branch; `gaveUp`: it failed again after the last attempt.
 */
export type GuardStatus = 'watching' | 'sent' | 'noSession' | 'gaveUp';

export interface GuardEntry {
  /** Failures sent in a row since the pipeline last passed. */
  attempts: number;
  status: GuardStatus;
  /** The session the latest failure went to. */
  session?: string;
}

/** The guard of each guarded pull request, by its key. */
export type GuardState = Record<string, GuardEntry>;

export const PULLS_REPOS_LIMIT = 40;
/** How often the services are asked again. */
export const PULLS_INTERVAL_MS = 60_000;
/** The id of the prompt that sends a failed pipeline to an agent. */
export const FIX_PIPELINE_PROMPT_ID = 'fix-pipeline';
/** The factory prompt the guard sends with the open comments of a review: `{revisao}`. */
export const FIX_PULL_REVIEW_PROMPT_ID = 'fix-pull-review';
/** `{pipeline}` is cut here: the end of the log of each failed job, a few of them. */
export const PIPELINE_TEXT_LIMIT = 20_000;

export const DEFAULT_PULLS_SETTINGS: PullsSettings = {
  repos: [],
  account: '',
  notifyFailed: true,
  notifyComments: true,
  notifyReview: true,
  guarded: [],
};

const PART = /^[A-Za-z0-9_.-]{1,100}$/;
const ACCOUNT = /^[A-Za-z0-9-]{1,39}$/;
const HOST = /^[a-z0-9-]+(?:\.[a-z0-9-]+)+$/i;
/** Groups inside groups: GitLab allows twenty levels. */
const GITLAB_DEPTH = 21;

const validPart = (part: string) => PART.test(part) && part !== '.' && part !== '..';

/**
 * The service of a watched repository. Names of GitHub accounts have no dots, so a first part
 * with one is the server of a GitLab: `gitlab.com/group/project` or the company's own.
 */
export function forgeOf(repo: string): Forge {
  return repo.split('/')[0]!.includes('.') ? 'gitlab' : 'github';
}

/** `owner/repo#12` or `group/project!12`, as each service writes it. */
export function pullRef(pull: Pick<PullRequestView, 'forge' | 'repo' | 'number'>): string {
  return `${pull.repo}${pull.forge === 'gitlab' ? '!' : '#'}${pull.number}`;
}

/**
 * The repository out of what someone may paste: the name itself, the address of the page, or the
 * address used to clone it. `owner/name` for GitHub; `host/group/project` for GitLab, whose
 * groups nest. Null for anything else.
 */
export function normalizeRepo(value: string): string | null {
  const raw = value.trim();
  // git@host:path and ssh://git@host/path, the addresses of a clone by ssh.
  const ssh = /^(?:ssh:\/\/)?git@([^:/]+)[:/](.+)$/i.exec(raw);
  const web = ssh ? null : /^(?:https?:\/\/)?(?:www\.)?([^/]+)\/(.+)$/i.exec(raw);
  const host = ssh?.[1] ?? (web && web[1]!.includes('.') ? web[1]! : null);
  const path = (ssh ? ssh[2]! : host ? web![2]! : raw)
    .replace(/[?#].*$/, '')
    .replace(/\/+$/, '')
    .replace(/\.git$/i, '');
  if (host && !HOST.test(host)) return null;

  if (!host || host.toLowerCase() === 'github.com') {
    const [owner, name, ...rest] = path.split('/');
    // A link to a page inside the repository (`/pull/3`, `/tree/main`) still names it.
    if (!owner || !name || (rest.length > 0 && !host)) return null;
    return validPart(owner) && validPart(name) ? `${owner}/${name}` : null;
  }
  // GitLab puts the pages of a project after `/-/` (`/-/merge_requests/3`).
  const parts = path.split('/-/')[0]!.split('/');
  if (parts.length < 2 || parts.length > GITLAB_DEPTH || !parts.every(validPart)) return null;
  return `${host.toLowerCase()}/${parts.join('/')}`;
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
    guarded: Array.isArray(v.guarded)
      ? [
          ...new Set(
            v.guarded.filter(
              (key): key is string =>
                typeof key === 'string' && key.length <= 300 && /[#!]\d+$/.test(key),
            ),
          ),
        ].slice(0, GUARDED_LIMIT)
      : [],
  };
}

export const EMPTY_PULLS_STATE: PullsState = {
  status: 'idle',
  logins: {},
  problems: [],
  repos: [],
  repoErrors: {},
  pulls: [],
  checkedAt: null,
  loading: false,
};
