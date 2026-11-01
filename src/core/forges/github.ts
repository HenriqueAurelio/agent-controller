// Reads pull requests from GitHub with the login of the `gh` command line tool: the app keeps no
// token of its own, and the one `gh` gives stays in this process, never in the renderer.
import { spawn } from 'node:child_process';
import { resolveCli } from './cli';
import type {
  GhAccounts,
  JobState,
  PipelineJob,
  PipelineState,
  PullRequestView,
} from '@shared/pulls';
import { eachRepo, ForgeError, type FailedJob, type ForgeClient, type ForgePulls } from './forge';
import { ANSI, tailLines } from './log';

export { ForgeError, type FailedJob, type ForgeClient, type ForgePulls } from './forge';

type Fetch = typeof fetch;

export interface GitHubClientOptions {
  /** Defaults to `https://api.github.com`; the e2e tests point it at a fake server. */
  apiUrl?: string;
  /** Skips `gh`: the tests give one. */
  token?: string;
  fetch?: Fetch;
  /** Runs `gh auth token`; the tests replace it. */
  runToken?: (account: string) => Promise<string>;
  /** Runs `gh auth status`; the tests replace it. */
  runAccounts?: () => Promise<GhAccounts>;
}

const NO_ACCOUNTS: GhAccounts = { accounts: [], active: '' };

/** The accounts of github.com in what `gh auth status --json hosts` printed. */
export function parseGhStatusJson(output: string): GhAccounts {
  const body = JSON.parse(output) as { hosts?: Record<string, unknown> };
  const list = body.hosts?.['github.com'];
  if (!Array.isArray(list)) return NO_ACCOUNTS;
  const accounts: string[] = [];
  let active = '';
  for (const item of list as { login?: unknown; active?: unknown; state?: unknown }[]) {
    if (typeof item.login !== 'string' || !item.login) continue;
    accounts.push(item.login);
    if (item.active === true) active = item.login;
  }
  return { accounts, active };
}

/** The same, out of the text an older `gh` (without `--json`) prints. */
export function parseGhStatusText(output: string): GhAccounts {
  const accounts: string[] = [];
  let active = '';
  let last = '';
  for (const line of output.split(/\r?\n/)) {
    const login = /Logged in to github\.com (?:account|as) ([\w-]+)/.exec(line);
    if (login) {
      last = login[1]!;
      accounts.push(last);
    } else if (/Active account: true/.test(line) && last) {
      active = last;
    }
  }
  // An older gh still had a single account: that one is the active.
  if (!active && accounts.length === 1) active = accounts[0]!;
  return { accounts, active };
}

function runGh(args: string[]): Promise<{ code: number | null; out: string; err: string } | null> {
  return resolveCli('gh').then(
    (command) =>
      new Promise((resolve) => {
        let out = '';
        let err = '';
        let child;
        try {
          child = spawn(command, args, {
            windowsHide: true,
            env: { ...process.env, GH_PROMPT_DISABLED: '1', NO_COLOR: '1' },
          });
        } catch {
          resolve(null);
          return;
        }
        const timer = setTimeout(() => child.kill(), 15_000);
        child.stdout.on('data', (chunk: Buffer) => (out += chunk.toString('utf8')));
        child.stderr.on('data', (chunk: Buffer) => (err += chunk.toString('utf8')));
        child.on('error', () => {
          clearTimeout(timer);
          resolve(null);
        });
        child.on('close', (code) => {
          clearTimeout(timer);
          resolve({ code, out, err });
        });
      }),
  );
}

/** The accounts `gh` has on github.com; none when `gh` is missing or has no login. */
export async function ghAccounts(): Promise<GhAccounts> {
  const json = await runGh(['auth', 'status', '--json', 'hosts', '--hostname', 'github.com']);
  if (json?.code === 0) {
    try {
      return parseGhStatusJson(json.out);
    } catch {
      // Not JSON: an older gh; the text below.
    }
  }
  const text = await runGh(['auth', 'status', '--hostname', 'github.com']);
  // gh writes the status on stderr in older versions, on stdout in newer ones.
  return text ? parseGhStatusText(`${text.out}\n${text.err}`) : NO_ACCOUNTS;
}

/** How much of a repository one query asks for; a busy one gets a smaller second try. */
const PAGE = { pulls: 20, jobs: 30 };
const SMALL_PAGE = { pulls: 8, jobs: 15 };

/** `gh auth token`, for one account or the active one. */
export async function ghToken(account: string): Promise<string> {
  const command = await resolveCli('gh');
  return new Promise((resolve, reject) => {
    const args = ['auth', 'token', ...(account ? ['--user', account] : [])];
    let out = '';
    let err = '';
    let child;
    try {
      child = spawn(command, args, {
        windowsHide: true,
        env: { ...process.env, GH_PROMPT_DISABLED: '1' },
      });
    } catch (error) {
      reject(new ForgeError('noCli', String(error)));
      return;
    }
    child.stdout.on('data', (chunk: Buffer) => (out += chunk.toString('utf8')));
    child.stderr.on('data', (chunk: Buffer) => {
      if (err.length < 4000) err += chunk.toString('utf8');
    });
    child.on('error', (error: NodeJS.ErrnoException) =>
      reject(new ForgeError(error.code === 'ENOENT' ? 'noCli' : 'error', error.message)),
    );
    child.on('close', (code) => {
      const token = out.trim();
      if (code === 0 && token) resolve(token);
      else reject(new ForgeError('loggedOut', err.trim() || `gh exited with ${code}`));
    });
  });
}

const quote = (value: string) => JSON.stringify(value);

/**
 * The open pull requests of repositories, each under an alias. The app asks one repository per
 * query: a busy one that times out (GitHub answers 504) does not take the others with it.
 */
export function pullsQuery(repos: readonly string[], page = PAGE): string {
  const parts = repos.map((repo, index) => {
    const [owner, name] = repo.split('/');
    return `r${index}: repository(owner: ${quote(owner!)}, name: ${quote(name!)}) {
    nameWithOwner
    pullRequests(states: OPEN, first: ${page.pulls}, orderBy: {field: UPDATED_AT, direction: DESC}) {
      nodes {
        number title url isDraft createdAt updatedAt headRefName baseRefName reviewDecision
        author { login }
        reviewRequests(first: 10) { nodes { requestedReviewer { ... on User { login } ... on Team { name } } } }
        comments(last: 1) { totalCount nodes { author { login } } }
        reviews(last: 1) { totalCount nodes { author { login } } }
        commits(last: 1) { nodes { commit { oid statusCheckRollup { state contexts(first: ${page.jobs}) { nodes {
          __typename
          ... on CheckRun { name status conclusion detailsUrl databaseId }
          ... on StatusContext { context state targetUrl }
        } } } } } }
      }
    }
  }`;
  });
  return `query { viewer { login }\n${parts.join('\n')}\n}`;
}

type Json = Record<string, unknown>;
const obj = (value: unknown): Json => (value && typeof value === 'object' ? (value as Json) : {});
const text = (value: unknown): string => (typeof value === 'string' ? value : '');
const nodes = (value: unknown): Json[] =>
  Array.isArray(obj(value).nodes) ? (obj(value).nodes as unknown[]).map(obj) : [];

function checkRunState(status: string, conclusion: string): JobState {
  if (status !== 'COMPLETED') return 'pending';
  if (conclusion === 'SUCCESS' || conclusion === 'NEUTRAL') return 'success';
  if (conclusion === 'SKIPPED' || conclusion === 'STALE') return 'skipped';
  return 'failure';
}

function statusState(state: string): JobState {
  if (state === 'SUCCESS') return 'success';
  if (state === 'PENDING' || state === 'EXPECTED') return 'pending';
  return 'failure';
}

function pipelineState(rollup: string, jobs: readonly PipelineJob[]): PipelineState {
  if (!rollup && jobs.length === 0) return 'none';
  if (rollup === 'SUCCESS') return 'success';
  if (rollup === 'FAILURE' || rollup === 'ERROR') return 'failure';
  if (rollup === 'PENDING' || rollup === 'EXPECTED') return 'pending';
  if (jobs.some((j) => j.state === 'failure')) return 'failure';
  if (jobs.some((j) => j.state === 'pending')) return 'pending';
  return 'success';
}

/** The answer of `pullsQuery`, read: pure, so the tests can feed it what GitHub sends. */
export function parsePulls(repos: readonly string[], body: unknown): ForgePulls {
  const root = obj(body);
  const data = obj(root.data);
  const login = text(obj(data.viewer).login);
  const me = login.toLowerCase();
  const pulls: PullRequestView[] = [];
  const failed: Record<string, FailedJob[]> = {};
  const repoErrors: Record<string, string> = {};

  for (const error of Array.isArray(root.errors) ? root.errors.map(obj) : []) {
    const alias = Array.isArray(error.path) ? String(error.path[0]) : '';
    const repo = /^r(\d+)$/.test(alias) ? repos[Number(alias.slice(1))] : undefined;
    if (repo) repoErrors[repo] = text(error.message) || 'error';
  }

  repos.forEach((wanted, index) => {
    const node = data[`r${index}`];
    if (!node) {
      repoErrors[wanted] ??= 'not found';
      return;
    }
    const repo = text(obj(node).nameWithOwner) || wanted;
    for (const pr of nodes(obj(node).pullRequests)) {
      const number = Number(pr.number);
      const key = `${repo}#${number}`;
      const author = text(obj(pr.author).login);
      const reviewers = nodes(pr.reviewRequests)
        .map((r) => obj(r.requestedReviewer))
        .map((r) => text(r.login) || text(r.name))
        .filter(Boolean);
      const comments = obj(pr.comments);
      const reviews = obj(pr.reviews);
      const lastComment = text(obj(nodes(comments)[0]?.author).login);
      const lastReview = text(obj(nodes(reviews)[0]?.author).login);
      const commit = obj(nodes(pr.commits)[0]?.commit);
      const rollup = obj(commit.statusCheckRollup);
      const jobs: PipelineJob[] = [];
      const failedJobs: FailedJob[] = [];
      for (const context of nodes(rollup.contexts)) {
        if (context.__typename === 'CheckRun') {
          const state = checkRunState(text(context.status), text(context.conclusion));
          const url = text(context.detailsUrl) || null;
          jobs.push({ name: text(context.name), state, url });
          if (state === 'failure') {
            const id = Number(context.databaseId);
            // A workflow of another repository (an organization's shared checks) keeps its log
            // where this account may not read it.
            const own = url?.toLowerCase().includes(`/${repo.toLowerCase()}/actions/`) ?? false;
            failedJobs.push({
              name: text(context.name),
              url,
              logId: own && Number.isSafeInteger(id) ? id : null,
            });
          }
        } else if (context.__typename === 'StatusContext') {
          const state = statusState(text(context.state));
          const url = text(context.targetUrl) || null;
          jobs.push({ name: text(context.context), state, url });
          if (state === 'failure')
            failedJobs.push({ name: text(context.context), url, logId: null });
        }
      }
      const decision = text(pr.reviewDecision);
      pulls.push({
        key,
        forge: 'github',
        repo,
        number,
        title: text(pr.title),
        url: text(pr.url),
        author,
        mine: !!me && author.toLowerCase() === me,
        draft: pr.isDraft === true,
        branch: text(pr.headRefName),
        base: text(pr.baseRefName),
        createdAt: text(pr.createdAt),
        updatedAt: text(pr.updatedAt),
        review:
          decision === 'APPROVED'
            ? 'approved'
            : decision === 'CHANGES_REQUESTED'
              ? 'changes'
              : decision === 'REVIEW_REQUIRED'
                ? 'required'
                : null,
        reviewers,
        reviewRequested: !!me && reviewers.some((r) => r.toLowerCase() === me),
        comments: (Number(comments.totalCount) || 0) + (Number(reviews.totalCount) || 0),
        // Which of the two came last is not in the answer; a review is the likelier news.
        lastCommentBy: lastReview || lastComment || null,
        pipeline: { state: pipelineState(text(rollup.state), jobs), sha: text(commit.oid), jobs },
      });
      if (failedJobs.length > 0) failed[key] = failedJobs;
    }
  });

  pulls.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  return { login, pulls, failed, repoErrors };
}

// The time GitHub writes at the start of every line.
const STAMP = /^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(?:\.\d+)?Z ?/;

/**
 * The end of a job's log, which is where it says why it failed. It stops at the last error
 * GitHub marked: what comes after is the cleanup of the job. Lines of progress dots and lines
 * repeated one after the other would only take the place of the ones that matter.
 */
export function logTail(log: string, lines?: number): string {
  let all = log
    .replace(ANSI, '')
    .split(/\r?\n/)
    .map((line) => line.replace(STAMP, '').trimEnd());
  let lastError = -1;
  all.forEach((line, index) => {
    if (line.startsWith('##[error]')) lastError = index;
  });
  if (lastError >= 0) all = all.slice(0, lastError + 1);
  return tailLines(
    all.filter((line) => !/^##\[(end)?group\]/.test(line)),
    lines,
  );
}

export class GitHubClient implements ForgeClient {
  private readonly apiUrl: string;
  private readonly fetch: Fetch;
  private readonly runToken: (account: string) => Promise<string>;
  private readonly runAccounts: () => Promise<GhAccounts>;
  private token: string | null;
  private account = '';

  constructor(options: GitHubClientOptions = {}) {
    this.apiUrl = (options.apiUrl ?? 'https://api.github.com').replace(/\/+$/, '');
    this.fetch = options.fetch ?? fetch;
    this.runToken = options.runToken ?? ghToken;
    this.token = options.token ?? null;
    if (options.token) this.runToken = async () => options.token!;
    // With a token of its own (the tests), `gh` is never asked.
    this.runAccounts =
      options.runAccounts ?? (options.token ? async () => NO_ACCOUNTS : ghAccounts);
  }

  /** The accounts of `gh`, to pick the one that reads the repositories. */
  accounts(): Promise<GhAccounts> {
    return this.runAccounts().catch(() => NO_ACCOUNTS);
  }

  setAccount(account: string): void {
    if (account === this.account) return;
    this.account = account;
    this.token = null;
  }

  async pulls(repos: readonly string[]): Promise<ForgePulls> {
    if (repos.length === 0) return parsePulls([], await this.graphql('query { viewer { login } }'));
    return eachRepo(repos, (repo) => this.repoPulls(repo));
  }

  private async repoPulls(repo: string): Promise<ForgePulls> {
    try {
      return parsePulls([repo], await this.graphql(pullsQuery([repo])));
    } catch (err) {
      if (!(err instanceof ForgeError) || !err.timedOut) throw err;
      return parsePulls([repo], await this.graphql(pullsQuery([repo], SMALL_PAGE)));
    }
  }

  async available(): Promise<string[]> {
    const names: string[] = [];
    let after: string | null = null;
    // Three pages of a hundred: enough to pick from, without a minute of waiting.
    for (let page = 0; page < 3; page++) {
      const body = obj(
        await this.graphql(
          `query($after: String) { viewer { repositories(first: 100, after: $after,
            affiliations: [OWNER, COLLABORATOR, ORGANIZATION_MEMBER],
            orderBy: {field: PUSHED_AT, direction: DESC}) {
              nodes { nameWithOwner } pageInfo { hasNextPage endCursor } } } }`,
          { after },
        ),
      );
      const list = obj(obj(obj(body.data).viewer).repositories);
      for (const node of nodes(list))
        if (text(node.nameWithOwner)) names.push(text(node.nameWithOwner));
      const info = obj(list.pageInfo);
      if (info.hasNextPage !== true) break;
      after = text(info.endCursor);
    }
    return names;
  }

  async jobLog(repo: string, job: FailedJob): Promise<string> {
    if (job.logId === null) return '';
    const response = await this.request(`/repos/${repo}/actions/jobs/${job.logId}/logs`);
    // GitHub answers with a redirect to the file; fetch follows it, without the token.
    if (!response.ok) return '';
    return logTail(await response.text());
  }

  private async graphql(query: string, variables: Json = {}): Promise<unknown> {
    const response = await this.request('/graphql', {
      method: 'POST',
      body: JSON.stringify({ query, variables }),
    });
    if (!response.ok) {
      // An error page of HTML says nothing the status does not.
      const json = response.headers.get('content-type')?.includes('json');
      const detail = json ? `: ${(await response.text()).slice(0, 300)}` : '';
      const error = new ForgeError('error', `GitHub ${response.status}${detail}`);
      error.timedOut = response.status === 502 || response.status === 504;
      throw error;
    }
    const body = obj(await response.json());
    // Errors of single repositories come with data; without any data the whole query failed.
    if (!body.data && Array.isArray(body.errors)) {
      throw new ForgeError('error', text(obj(body.errors[0]).message) || 'GitHub error');
    }
    return body;
  }

  private async request(path: string, init: RequestInit = {}, retried = false): Promise<Response> {
    this.token ??= await this.runToken(this.account);
    let response: Response;
    try {
      response = await this.fetch(`${this.apiUrl}${path}`, {
        ...init,
        headers: {
          authorization: `Bearer ${this.token}`,
          accept: 'application/vnd.github+json',
          'content-type': 'application/json',
          'user-agent': 'aurelium',
        },
        signal: AbortSignal.timeout(30_000),
      });
    } catch (error) {
      const failure = new ForgeError(
        'error',
        error instanceof Error ? error.message : String(error),
      );
      failure.timedOut = error instanceof Error && error.name === 'TimeoutError';
      throw failure;
    }
    if (response.status === 401) {
      // The token of `gh` may have changed (a new login): one more try with the current one.
      this.token = null;
      if (!retried) return this.request(path, init, true);
      throw new ForgeError('loggedOut', 'GitHub 401');
    }
    return response;
  }
}
