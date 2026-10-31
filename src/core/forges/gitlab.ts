// Reads merge requests from GitLab through the `glab` command line tool. `glab api` brings the
// login, renews it when it expires and knows the company's own servers: the app keeps no token
// and never sees one.
import { spawn } from 'node:child_process';
import type { JobState, PipelineJob, PipelineState, PullRequestView } from '@shared/pulls';
import { eachRepo, ForgeError, type FailedJob, type ForgeClient, type ForgePulls } from './forge';
import { ANSI, tailLines } from './log';

type Json = Record<string, unknown>;

/** How the client reaches a GitLab server. */
export interface GitLabTransport {
  /** A GraphQL query: the body of the answer. */
  graphql(host: string, query: string, variables: Json): Promise<unknown>;
  /** A path of the REST API (`projects/…`): the text of the answer. */
  rest(host: string, path: string): Promise<string>;
  /** The server glab uses when none is named. */
  defaultHost(): Promise<string>;
}

const TIMEOUT_MS = 30_000;
/** A job's log can be megabytes; past this, only its end is worth keeping. */
const MAX_OUTPUT = 16 * 1024 * 1024;

interface Run {
  code: number | null;
  out: string;
  err: string;
}

function runGlab(args: string[], input?: string): Promise<Run> {
  return new Promise((resolve, reject) => {
    let child;
    try {
      child = spawn('glab', args, {
        windowsHide: true,
        // No question on the terminal, no colors, no look for a new version on every call.
        env: { ...process.env, NO_PROMPT: '1', NO_COLOR: '1', GLAB_CHECK_UPDATE: 'false' },
      });
    } catch (error) {
      reject(new ForgeError('noCli', String(error)));
      return;
    }
    const chunks: Buffer[] = [];
    let size = 0;
    let err = '';
    const timer = setTimeout(() => {
      const failure = new ForgeError('error', `glab: no answer in ${TIMEOUT_MS / 1000} s`);
      failure.timedOut = true;
      reject(failure);
      child.kill();
    }, TIMEOUT_MS);
    child.stdout.on('data', (chunk: Buffer) => {
      chunks.push(chunk);
      size += chunk.length;
      while (size > MAX_OUTPUT && chunks.length > 1) size -= chunks.shift()!.length;
    });
    child.stderr.on('data', (chunk: Buffer) => {
      if (err.length < 4000) err += chunk.toString('utf8');
    });
    child.on('error', (error: NodeJS.ErrnoException) => {
      clearTimeout(timer);
      reject(new ForgeError(error.code === 'ENOENT' ? 'noCli' : 'error', error.message));
    });
    child.on('close', (code) => {
      clearTimeout(timer);
      resolve({ code, out: Buffer.concat(chunks).toString('utf8'), err: err.trim() });
    });
    child.stdin.on('error', () => {});
    child.stdin.end(input ?? '');
  });
}

/** What glab wrote when it failed, as an error of the right kind. */
function glabError(host: string, run: Run): ForgeError {
  const message = run.err.replace(/\s+/g, ' ').trim() || `glab exited with ${run.code}`;
  if (/\b401\b|unauthori[sz]ed|auth login|not logged|no token/i.test(message)) {
    return new ForgeError('loggedOut', message, host);
  }
  const error = new ForgeError('error', message, host);
  error.timedOut = /\b50[24]\b|timed? ?out/i.test(message);
  return error;
}

/** `glab api`, which carries the login of each server. */
export const glabTransport: GitLabTransport = {
  async graphql(host, query, variables) {
    const run = await runGlab(
      ['api', 'graphql', '--hostname', host, '--input', '-'],
      JSON.stringify({ query, variables }),
    );
    // An answer with errors may come with a failed exit and still say what is wrong.
    try {
      const body = JSON.parse(run.out) as unknown;
      if (body && typeof body === 'object' && ('data' in body || 'errors' in body)) return body;
    } catch {
      // Not JSON: what glab wrote on stderr tells.
    }
    throw glabError(host, run);
  },
  async rest(host, path) {
    const run = await runGlab(['api', path, '--hostname', host]);
    if (run.code !== 0) throw glabError(host, run);
    return run.out;
  },
  async defaultHost() {
    const run = await runGlab(['config', 'get', 'host']).catch(() => null);
    return run?.code === 0 && run.out.trim() ? run.out.trim() : 'gitlab.com';
  },
};

/** A GitLab at an address, with a token: only for the tests, which run a fake one. */
export function fetchTransport(apiUrl: string, token: string): GitLabTransport {
  const base = apiUrl.replace(/\/+$/, '');
  const request = async (path: string, init: RequestInit = {}) => {
    const response = await fetch(`${base}${path}`, {
      ...init,
      headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    if (response.status === 401) throw new ForgeError('loggedOut', 'GitLab 401');
    if (!response.ok) throw new ForgeError('error', `GitLab ${response.status}`);
    return response.text();
  };
  return {
    graphql: async (_host, query, variables) =>
      JSON.parse(
        await request('/api/graphql', {
          method: 'POST',
          body: JSON.stringify({ query, variables }),
        }),
      ) as unknown,
    rest: (_host, path) => request(`/api/v4/${path}`),
    defaultHost: async () => 'gitlab.com',
  };
}

/** `gitlab.com/group/sub/project` into the server and the project's path. */
export function splitRepo(repo: string): { host: string; path: string } {
  const slash = repo.indexOf('/');
  return { host: repo.slice(0, slash), path: repo.slice(slash + 1) };
}

const PAGE = { pulls: 20, jobs: 30 };
const SMALL_PAGE = { pulls: 8, jobs: 15 };

/** The open merge requests of one project, the latest update first. */
export const MERGE_REQUESTS_QUERY = `query($path: ID!, $pulls: Int!, $jobs: Int!) {
  currentUser { username }
  project(fullPath: $path) {
    fullPath
    mergeRequests(state: opened, first: $pulls, sort: UPDATED_DESC) { nodes {
      iid title webUrl draft createdAt updatedAt sourceBranch targetBranch diffHeadSha approved
      author { username }
      reviewers { nodes { username mergeRequestInteraction { reviewState } } }
      userNotesCount
      notes(last: 1, filter: ONLY_COMMENTS) { nodes { author { username } } }
      headPipeline { status sha
        jobs(first: $jobs, retried: false) { nodes { ...job } }
        failedJobs: jobs(statuses: [FAILED, CANCELED], retried: false, first: 10) { nodes { ...job } } }
    } }
  }
}
fragment job on CiJob { id name status allowFailure webPath }`;

const obj = (value: unknown): Json => (value && typeof value === 'object' ? (value as Json) : {});
const text = (value: unknown): string => (typeof value === 'string' ? value : '');
const nodes = (value: unknown): Json[] =>
  Array.isArray(obj(value).nodes) ? (obj(value).nodes as unknown[]).map(obj) : [];

function jobState(status: string, allowFailure: boolean): JobState {
  if (status === 'SUCCESS') return 'success';
  // A job allowed to fail does not hold the merge request back.
  if (status === 'FAILED') return allowFailure ? 'skipped' : 'failure';
  if (status === 'CANCELED' || status === 'CANCELING') return 'failure';
  if (status === 'SKIPPED' || status === 'MANUAL') return 'skipped';
  return 'pending';
}

function pipelineState(status: string, jobs: readonly PipelineJob[]): PipelineState {
  if (!status) return 'none';
  if (status === 'SUCCESS') return 'success';
  if (status === 'FAILED' || status === 'CANCELED') return 'failure';
  if (status === 'SKIPPED') return 'none';
  // Waiting for someone to start a manual job: what ran tells.
  if (status === 'MANUAL') {
    if (jobs.some((j) => j.state === 'failure')) return 'failure';
    return jobs.some((j) => j.state === 'pending') ? 'pending' : 'success';
  }
  return 'pending';
}

/** Reviewers who were asked and have not answered yet. */
const WAITING = new Set(['UNREVIEWED', 'REVIEW_STARTED', '']);

/** The answer of `MERGE_REQUESTS_QUERY`, read: pure, so the tests can feed it what GitLab sends. */
export function parseMergeRequests(repo: string, body: unknown): ForgePulls {
  const { host } = splitRepo(repo);
  const root = obj(body);
  const data = obj(root.data);
  const user = data.currentUser;
  if (root.data && user === null) {
    throw new ForgeError('loggedOut', `glab has no login on ${host}`, host);
  }
  const login = text(obj(user).username);
  const me = login.toLowerCase();
  const project = data.project;
  if (!project) {
    const message = Array.isArray(root.errors) ? text(obj(root.errors[0]).message) : '';
    return { login, pulls: [], failed: {}, repoErrors: { [repo]: message || 'not found' } };
  }
  const name = `${host}/${text(obj(project).fullPath) || splitRepo(repo).path}`;
  const pulls: PullRequestView[] = [];
  const failed: Record<string, FailedJob[]> = {};

  for (const mr of nodes(obj(project).mergeRequests)) {
    const number = Number(mr.iid);
    const key = `${name}!${number}`;
    const author = text(obj(mr.author).username);
    const reviewers = nodes(mr.reviewers).map((r) => ({
      name: text(r.username),
      state: text(obj(r.mergeRequestInteraction).reviewState),
    }));
    const waiting = reviewers.filter((r) => r.name && WAITING.has(r.state)).map((r) => r.name);
    const pipeline = obj(mr.headPipeline);
    const jobs: PipelineJob[] = [];
    const failedJobs: FailedJob[] = [];
    // A big pipeline has hundreds of jobs: the failed ones come apart, wherever they are.
    const seen = new Set<string>();
    const all = [...nodes(pipeline.jobs), ...nodes(pipeline.failedJobs)].filter((job) => {
      const id = text(job.id);
      if (id && seen.has(id)) return false;
      seen.add(id);
      return true;
    });
    for (const job of all) {
      const state = jobState(text(job.status), job.allowFailure === true);
      const webPath = text(job.webPath);
      const url = webPath ? `https://${host}${webPath}` : null;
      jobs.push({ name: text(job.name), state, url });
      if (state !== 'failure') continue;
      const id = Number(/(\d+)$/.exec(text(job.id))?.[1]);
      // A merge request from a fork runs its pipeline there, and the log is the fork's.
      const ranIn = /^\/(.+?)\/-\/jobs\//.exec(webPath)?.[1];
      failedJobs.push({
        name: text(job.name),
        url,
        logId: Number.isSafeInteger(id) ? id : null,
        project: ranIn ?? splitRepo(name).path,
      });
    }
    pulls.push({
      key,
      forge: 'gitlab',
      repo: name,
      number,
      title: text(mr.title),
      url: text(mr.webUrl),
      author,
      mine: !!me && author.toLowerCase() === me,
      draft: mr.draft === true,
      branch: text(mr.sourceBranch),
      base: text(mr.targetBranch),
      createdAt: text(mr.createdAt),
      updatedAt: text(mr.updatedAt),
      review: reviewers.some((r) => r.state === 'REQUESTED_CHANGES')
        ? 'changes'
        : mr.approved === true
          ? 'approved'
          : waiting.length > 0
            ? 'required'
            : null,
      reviewers: waiting,
      reviewRequested: !!me && waiting.some((r) => r.toLowerCase() === me),
      comments: Number(mr.userNotesCount) || 0,
      lastCommentBy: text(obj(nodes(mr.notes)[0]?.author).username) || null,
      pipeline: {
        state: pipelineState(text(pipeline.status), jobs),
        sha: text(pipeline.sha) || text(mr.diffHeadSha),
        jobs,
      },
    });
    if (failedJobs.length > 0) failed[key] = failedJobs;
  }
  return { login, pulls, failed, repoErrors: {} };
}

// What the runner writes at the start of every line: the time and the stream (`01O`, `00E+`).
const PREFIX = /^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(?:\.\d+)?Z [0-9a-f]{2}[OE]\+? ?/;
const SECTION = /section_(start|end):\d+:([A-Za-z0-9_.-]+)(?:\[[^\]]*\])?\r?/g;
/** Sections of the runner itself, before and after the job's script: never why it failed. */
const RUNNER_SECTIONS = new Set([
  'prepare_executor',
  'prepare_script',
  'resolve_secrets',
  'get_sources',
  'restore_cache',
  'download_artifacts',
  'archive_cache',
  'archive_cache_on_failure',
  'upload_artifacts_on_success',
  'upload_artifacts_on_failure',
  'cleanup_file_variables',
]);

/**
 * The end of a GitLab job's log. The runner wraps its own steps in sections (preparing, cleaning
 * up, uploading artifacts); only what the job ran stays, through the line that says it failed.
 */
export function gitlabLogTail(log: string, lines?: number): string {
  const kept: string[] = [];
  let section: string | null = null;
  const inRunner = () => section !== null && RUNNER_SECTIONS.has(section);
  for (const raw of log.split('\n')) {
    // Windows runners end lines with \r\n: that \r is not a progress bar's.
    const line = raw.replace(ANSI, '').replace(/\r+$/, '').replace(PREFIX, '');
    let text = '';
    let last = 0;
    for (const match of line.matchAll(SECTION)) {
      if (!inRunner()) text += line.slice(last, match.index);
      section = match[1] === 'start' ? match[2]! : null;
      last = match.index + match[0].length;
    }
    if (!inRunner()) text += line.slice(last);
    // A progress bar rewrites its line: what is left after the last return is what showed.
    const shown = text.slice(text.lastIndexOf('\r') + 1).trimEnd();
    // A line that only opened or closed a section is not part of the log.
    if (shown || (last === 0 && !inRunner())) kept.push(shown);
  }
  let end = kept.length;
  for (let i = kept.length - 1; i >= 0; i--) {
    if (kept[i]!.startsWith('ERROR: Job failed')) {
      end = i + 1;
      break;
    }
  }
  return tailLines(kept.slice(0, end), lines);
}

export class GitLabClient implements ForgeClient {
  constructor(private readonly transport: GitLabTransport = glabTransport) {}

  /** glab has one login per server: there is no account to pick. */
  setAccount(): void {}

  pulls(repos: readonly string[]): Promise<ForgePulls> {
    // Each server logs in apart: one without a login does not hide the projects of the others.
    return eachRepo(repos, (repo) => this.repoPulls(repo), true);
  }

  private async repoPulls(repo: string): Promise<ForgePulls> {
    const { host, path } = splitRepo(repo);
    const ask = (page: typeof PAGE) =>
      this.transport.graphql(host, MERGE_REQUESTS_QUERY, { path, ...page });
    try {
      return parseMergeRequests(repo, await ask(PAGE));
    } catch (err) {
      if (!(err instanceof ForgeError) || !err.timedOut) throw err;
      return parseMergeRequests(repo, await ask(SMALL_PAGE));
    }
  }

  async available(watched: readonly string[]): Promise<string[]> {
    const hosts = new Set([await this.transport.defaultHost()]);
    for (const repo of watched)
      if (repo.split('/')[0]!.includes('.')) hosts.add(splitRepo(repo).host);
    const lists = await Promise.all(
      [...hosts].map(async (host) => {
        const answer = await this.transport
          .rest(
            host,
            'projects?membership=true&archived=false&simple=true&order_by=last_activity_at&per_page=100',
          )
          .catch(() => '[]');
        let list: unknown;
        try {
          list = JSON.parse(answer);
        } catch {
          list = [];
        }
        return (Array.isArray(list) ? list : [])
          .map((p) => text(obj(p).path_with_namespace))
          .filter(Boolean)
          .map((path) => `${host}/${path}`);
      }),
    );
    return lists.flat();
  }

  async jobLog(repo: string, job: FailedJob): Promise<string> {
    if (job.logId === null) return '';
    const { host, path } = splitRepo(repo);
    const project = encodeURIComponent(job.project ?? path);
    const log = await this.transport
      .rest(host, `projects/${project}/jobs/${job.logId}/trace`)
      .catch(() => '');
    return gitlabLogTail(log);
  }
}
