import { describe, expect, it, vi } from 'vitest';
import {
  GitHubClient,
  logTail,
  parsePulls,
  pullsQuery,
  type FailedJob,
  type ForgeClient,
  type ForgePulls,
} from '../../src/core/forges/github';
import { pullNotices, PullWatcher, type PullNotice } from '../../src/core/forges/PullWatcher';
import { expandPrompt } from '../../src/core/prompts/expand';
import { factoryPrompts } from '../../src/shared/prompts';
import {
  FIX_PIPELINE_PROMPT_ID,
  normalizeRepo,
  parseRepoList,
  sanitizePullsSettings,
  type PullRequestView,
} from '../../src/shared/pulls';

// What GitHub answers to `pullsQuery`, cut down to the fields the app reads.
const pr = (over: Record<string, unknown> = {}) => ({
  number: 7,
  title: 'Paginar o relatório',
  url: 'https://github.com/acme/api/pull/7',
  isDraft: false,
  createdAt: '2026-10-30T10:00:00Z',
  updatedAt: '2026-10-31T09:00:00Z',
  headRefName: 'paginar',
  baseRefName: 'main',
  reviewDecision: 'REVIEW_REQUIRED',
  author: { login: 'ana' },
  reviewRequests: {
    nodes: [{ requestedReviewer: { login: 'bruno' } }, { requestedReviewer: { name: 'core' } }],
  },
  comments: { totalCount: 2, nodes: [{ author: { login: 'bruno' } }] },
  reviews: { totalCount: 1, nodes: [{ author: { login: 'carla' } }] },
  commits: {
    nodes: [
      {
        commit: {
          oid: 'abc123',
          statusCheckRollup: {
            state: 'FAILURE',
            contexts: {
              nodes: [
                {
                  __typename: 'CheckRun',
                  name: 'test',
                  status: 'COMPLETED',
                  conclusion: 'FAILURE',
                  detailsUrl: 'https://github.com/acme/api/actions/runs/1/job/99',
                  databaseId: 99,
                },
                {
                  __typename: 'CheckRun',
                  name: 'lint',
                  status: 'COMPLETED',
                  conclusion: 'SUCCESS',
                  detailsUrl: 'https://github.com/acme/api/actions/runs/1/job/98',
                  databaseId: 98,
                },
                {
                  __typename: 'CheckRun',
                  name: 'deploy',
                  status: 'COMPLETED',
                  conclusion: 'SKIPPED',
                  detailsUrl: null,
                  databaseId: 97,
                },
                {
                  __typename: 'StatusContext',
                  context: 'sonar',
                  state: 'ERROR',
                  targetUrl: 'https://sonar.example/p/1',
                },
              ],
            },
          },
        },
      },
    ],
  },
  ...over,
});

const answer = (pulls: unknown[], login = 'ana') => ({
  data: {
    viewer: { login },
    r0: { nameWithOwner: 'acme/api', pullRequests: { nodes: pulls } },
    r1: null,
  },
  errors: [
    { path: ['r1'], message: "Could not resolve to a Repository with the name 'acme/gone'." },
  ],
});

const view = (over: Partial<PullRequestView> = {}): PullRequestView => ({
  key: 'acme/api#7',
  repo: 'acme/api',
  number: 7,
  title: 't',
  url: 'u',
  author: 'ana',
  mine: true,
  draft: false,
  branch: 'b',
  base: 'main',
  createdAt: '',
  updatedAt: '',
  review: null,
  reviewers: [],
  reviewRequested: false,
  comments: 0,
  lastCommentBy: null,
  pipeline: { state: 'success', sha: 's1', jobs: [] },
  ...over,
});

describe('the list of repositories', () => {
  it('reads names, page addresses and clone addresses', () => {
    expect(normalizeRepo('acme/api')).toBe('acme/api');
    expect(normalizeRepo('https://github.com/acme/api')).toBe('acme/api');
    expect(normalizeRepo('https://github.com/acme/api/pull/7')).toBe('acme/api');
    expect(normalizeRepo('git@github.com:acme/api.git')).toBe('acme/api');
    expect(normalizeRepo('github.com/acme/api/')).toBe('acme/api');
    expect(normalizeRepo('acme')).toBeNull();
    expect(normalizeRepo('acme/../x')).toBeNull();
    expect(normalizeRepo('a b/c')).toBeNull();
  });

  it('takes what is pasted, separated by commas, spaces or lines, without repeating', () => {
    expect(parseRepoList('acme/api, acme/web\nACME/API ; https://github.com/x/y, nada')).toEqual({
      repos: ['acme/api', 'acme/web', 'x/y'],
      invalid: ['nada'],
    });
  });

  it('keeps settings that make sense and drops the rest', () => {
    expect(
      sanitizePullsSettings({
        repos: ['acme/api', 'acme/api', 'bad'],
        account: 'a b',
        notifyFailed: false,
      }),
    ).toEqual({
      repos: ['acme/api'],
      account: '',
      notifyFailed: false,
      notifyComments: true,
      notifyReview: true,
    });
    expect(sanitizePullsSettings(undefined).repos).toEqual([]);
  });
});

describe('reading GitHub', () => {
  it('asks for every repository in one query, each under its alias', () => {
    const query = pullsQuery(['acme/api', 'acme/web']);
    expect(query).toContain('r0: repository(owner: "acme", name: "api")');
    expect(query).toContain('r1: repository(owner: "acme", name: "web")');
    expect(query).toContain('viewer { login }');
  });

  it('reads the pull requests, their pipeline and who reviews them', () => {
    const result = parsePulls(['acme/api', 'acme/gone'], answer([pr()]));
    expect(result.login).toBe('ana');
    expect(result.repoErrors).toEqual({
      'acme/gone': "Could not resolve to a Repository with the name 'acme/gone'.",
    });
    const [pull] = result.pulls;
    expect(pull).toMatchObject({
      key: 'acme/api#7',
      mine: true,
      review: 'required',
      reviewers: ['bruno', 'core'],
      reviewRequested: false,
      comments: 3,
      lastCommentBy: 'carla',
      pipeline: { state: 'failure', sha: 'abc123' },
    });
    expect(pull!.pipeline.jobs.map((j) => `${j.name}:${j.state}`)).toEqual([
      'test:failure',
      'lint:success',
      'deploy:skipped',
      'sonar:failure',
    ]);
    // Only a job of Actions has a log the app can read.
    expect(result.failed['acme/api#7']).toEqual([
      { name: 'test', url: 'https://github.com/acme/api/actions/runs/1/job/99', logId: 99 },
      { name: 'sonar', url: 'https://sonar.example/p/1', logId: null },
    ]);
  });

  it('knows a pull request of someone else that asks for my review', () => {
    const result = parsePulls(['acme/api'], answer([pr()], 'Bruno'));
    expect(result.pulls[0]).toMatchObject({ mine: false, reviewRequested: true });
  });

  it('tells a pipeline still running and one with no checks at all', () => {
    const running = pr({
      commits: {
        nodes: [
          {
            commit: { oid: 'x', statusCheckRollup: { state: 'PENDING', contexts: { nodes: [] } } },
          },
        ],
      },
    });
    const none = pr({
      number: 8,
      commits: { nodes: [{ commit: { oid: 'y', statusCheckRollup: null } }] },
    });
    const [a, b] = parsePulls(['acme/api'], answer([running, none])).pulls;
    expect(a!.pipeline.state).toBe('pending');
    expect(b!.pipeline.state).toBe('none');
  });

  it('keeps the end of a log, without the time stamps and the colors', () => {
    const log = Array.from(
      { length: 200 },
      (_, i) => `2026-10-31T09:00:0${i % 10}.1234567Z line ${i}`,
    )
      .concat([
        '2026-10-31T09:00:00Z \x1b[31m##[error]Process completed with exit code 1.\x1b[0m',
        '',
        '',
      ])
      .join('\r\n');
    const tail = logTail(log, 3).split('\n');
    expect(tail).toEqual(['line 198', 'line 199', '##[error]Process completed with exit code 1.']);
  });

  it('stops at the last error, without the cleanup, the progress dots and the repeats', () => {
    const log = [
      'Run make test',
      '....................',
      '....................',
      'not ok 1 benchmark',
      '  actual: 1',
      '  actual: 1',
      '##[group]Details',
      '##[error]Process completed with exit code 2.',
      'Post job cleanup.',
      '##[group]Cachix: push',
      'Cleaning up orphan processes',
    ].join('\n');
    expect(logTail(log).split('\n')).toEqual([
      'Run make test',
      'not ok 1 benchmark',
      '  actual: 1',
      '##[error]Process completed with exit code 2.',
    ]);
  });

  it('reads with the token of gh, and asks for it again once GitHub refuses it', async () => {
    const tokens = ['old', 'new'];
    const runToken = vi.fn(async () => tokens.shift()!);
    const seen: string[] = [];
    const fetch = vi.fn(async (_url: string | URL | Request, init?: RequestInit) => {
      const auth = (init?.headers as Record<string, string>).authorization!;
      seen.push(auth);
      if (auth === 'Bearer old') return new Response('bad credentials', { status: 401 });
      return Response.json(answer([pr()]));
    });
    const client = new GitHubClient({ runToken, fetch: fetch as typeof globalThis.fetch });
    client.setAccount('ana');
    const result = await client.pulls(['acme/api']);
    expect(result.pulls).toHaveLength(1);
    expect(seen).toEqual(['Bearer old', 'Bearer new']);
    expect(runToken).toHaveBeenCalledWith('ana');
    expect(String(fetch.mock.calls[0]![0])).toBe('https://api.github.com/graphql');
  });

  it('reads the log of a job of Actions, and nothing for checks of other services', async () => {
    const fetch = vi.fn(
      async (_url: string | URL | Request) => new Response('2026-10-31T09:00:00Z boom\n'),
    );
    const client = new GitHubClient({ token: 't', fetch: fetch as typeof globalThis.fetch });
    const job = (logId: number | null): FailedJob => ({ name: 'test', url: null, logId });
    expect(await client.jobLog('acme/api', job(99))).toBe('boom');
    expect(String(fetch.mock.calls[0]![0])).toBe(
      'https://api.github.com/repos/acme/api/actions/jobs/99/logs',
    );
    expect(await client.jobLog('acme/api', job(null))).toBe('');
    expect(fetch).toHaveBeenCalledTimes(1);
  });
});

describe('the news of a look', () => {
  const seen = new Set(['acme/api']);

  it('tells a failed pipeline of mine once per commit', () => {
    const failed = view({ pipeline: { state: 'failure', sha: 's1', jobs: [] } });
    expect(pullNotices([view()], seen, [failed], 'ana').map((n) => n.kind)).toEqual(['failed']);
    expect(pullNotices([failed], seen, [failed], 'ana')).toEqual([]);
    const again = view({ pipeline: { state: 'failure', sha: 's2', jobs: [] } });
    expect(pullNotices([failed], seen, [again], 'ana').map((n) => n.kind)).toEqual(['failed']);
    // Someone else's pipeline is theirs to watch.
    expect(pullNotices([view({ mine: false })], seen, [{ ...failed, mine: false }], 'ana')).toEqual(
      [],
    );
  });

  it('tells a comment of someone else on a pull request of mine, not one of my own', () => {
    const before = view({ comments: 1 });
    expect(
      pullNotices([before], seen, [view({ comments: 2, lastCommentBy: 'bruno' })], 'ana').map(
        (n) => n.kind,
      ),
    ).toEqual(['comment']);
    expect(
      pullNotices([before], seen, [view({ comments: 2, lastCommentBy: 'Ana' })], 'ana'),
    ).toEqual([]);
  });

  it('tells a new request for my review, also on a pull request that just opened', () => {
    const asks = view({ mine: false, reviewRequested: true });
    expect(pullNotices([], seen, [asks], 'ana').map((n) => n.kind)).toEqual(['review']);
    expect(pullNotices([asks], seen, [asks], 'ana')).toEqual([]);
  });

  it('says nothing about a repository that was not in the previous look', () => {
    const failed = view({
      pipeline: { state: 'failure', sha: 's1', jobs: [] },
      reviewRequested: true,
    });
    expect(pullNotices([], new Set(), [failed], 'ana')).toEqual([]);
  });
});

class FakeClient implements ForgeClient {
  answers: (ForgePulls | Error)[] = [];
  calls: string[][] = [];
  account = '';
  async pulls(repos: readonly string[]): Promise<ForgePulls> {
    this.calls.push([...repos]);
    const next = this.answers.shift();
    if (!next) throw new Error('no answer');
    if (next instanceof Error) throw next;
    return next;
  }
  async available() {
    return ['acme/api', 'acme/web'];
  }
  async jobLog(_repo: string, job: FailedJob) {
    return job.logId ? `log of ${job.name}` : '';
  }
  setAccount(account: string) {
    this.account = account;
  }
}

const result = (pulls: PullRequestView[], failed: ForgePulls['failed'] = {}): ForgePulls => ({
  login: 'ana',
  pulls,
  failed,
  repoErrors: {},
});

describe('the watcher', () => {
  it('asks nothing while no repository is watched', async () => {
    const client = new FakeClient();
    const watcher = new PullWatcher({ client, intervalMs: 60_000 });
    watcher.start();
    await watcher.refresh();
    expect(client.calls).toEqual([]);
    expect(watcher.get().status).toBe('idle');
    watcher.dispose();
  });

  it('keeps the latest answer, and tells only what changed after the first look', async () => {
    const client = new FakeClient();
    const watcher = new PullWatcher({ client, intervalMs: 60_000, now: () => 1000 });
    const notices: PullNotice[] = [];
    watcher.on('notice', (n) => notices.push(n));
    watcher.configure({ repos: ['acme/api'], account: 'ana' });
    expect(client.account).toBe('ana');
    const failed = view({ pipeline: { state: 'failure', sha: 's1', jobs: [] } });
    client.answers.push(result([failed]), result([failed]), new Error('offline'));

    await watcher.refresh();
    expect(watcher.get()).toMatchObject({ status: 'ok', login: 'ana', checkedAt: 1000 });
    expect(watcher.get().pulls).toHaveLength(1);
    // The failure was already there when the list was first read: not news.
    expect(notices).toEqual([]);

    await watcher.refresh();
    expect(notices).toEqual([]);

    await watcher.refresh();
    // A network that drops keeps the list on screen, with the reason.
    expect(watcher.get()).toMatchObject({ status: 'error', error: 'offline' });
    expect(watcher.get().pulls).toHaveLength(1);
    watcher.dispose();
  });

  it('tells a pipeline that fails between two looks', async () => {
    const client = new FakeClient();
    const watcher = new PullWatcher({ client });
    const notices: string[] = [];
    watcher.on('notice', (n) => notices.push(`${n.kind}:${n.pull.key}`));
    watcher.configure({ repos: ['acme/api'], account: '' });
    client.answers.push(
      result([view()]),
      result([view({ pipeline: { state: 'failure', sha: 's1', jobs: [] } })]),
    );
    await watcher.refresh();
    await watcher.refresh();
    expect(notices).toEqual(['failed:acme/api#7']);
    watcher.dispose();
  });

  it('writes the failed jobs, their links and the end of their logs for the prompt', async () => {
    const client = new FakeClient();
    const watcher = new PullWatcher({ client });
    watcher.configure({ repos: ['acme/api'], account: '' });
    client.answers.push(
      result([view({ pipeline: { state: 'failure', sha: 's1', jobs: [] } })], {
        'acme/api#7': [
          { name: 'test', url: 'https://x/job/1', logId: 1 },
          { name: 'sonar', url: 'https://sonar', logId: null },
        ],
      }),
    );
    await watcher.refresh();
    expect(await watcher.failureText('acme/api#7')).toBe(
      '### test\nhttps://x/job/1\n```\nlog of test\n```\n\n### sonar\nhttps://sonar',
    );
    expect(await watcher.failureText('acme/api#8')).toBe('');
    watcher.dispose();
  });
});

describe('the prompt "Fix the pipeline"', () => {
  it('comes with the app and fills in the pull request and what failed', () => {
    const prompt = factoryPrompts('pt-BR').find((p) => p.id === FIX_PIPELINE_PROMPT_ID)!;
    const text = expandPrompt(prompt.text, {
      pr: 'acme/api#7: Paginar',
      pipeline: '### test',
      branch: 'paginar',
    });
    expect(text).toContain('acme/api#7: Paginar');
    expect(text).toContain('### test');
    expect(text).toContain('branch paginar');
    expect(text).not.toMatch(/\{(pr|pipeline|branch)\}/);
  });
});

describe('asking a repository at a time', () => {
  const body = (repo: string, number: number) => ({
    data: {
      viewer: { login: 'ana' },
      r0: { nameWithOwner: repo, pullRequests: { nodes: [pr({ number })] } },
    },
  });

  it('keeps the others when one repository times out twice, and tries a smaller page first', async () => {
    const queries: string[] = [];
    const fetch = vi.fn(async (_url: string | URL | Request, init?: RequestInit) => {
      const { query } = JSON.parse(String(init?.body)) as { query: string };
      queries.push(query);
      if (query.includes('name: "busy"')) {
        return new Response('<html>Unicorn!</html>', {
          status: 504,
          headers: { 'content-type': 'text/html' },
        });
      }
      return Response.json(
        query.includes('name: "web"') ? body('acme/web', 2) : body('acme/api', 1),
      );
    });
    const client = new GitHubClient({ token: 't', fetch: fetch as typeof globalThis.fetch });
    const result = await client.pulls(['acme/api', 'acme/busy', 'acme/web']);
    expect(result.pulls.map((p) => p.key).sort()).toEqual(['acme/api#1', 'acme/web#2']);
    // The HTML of the error page stays out of what the user reads.
    expect(result.repoErrors).toEqual({ 'acme/busy': 'GitHub 504' });
    const busy = queries.filter((q) => q.includes('name: "busy"'));
    expect(busy).toHaveLength(2);
    expect(busy[0]).toContain('first: 20');
    expect(busy[1]).toContain('first: 8');
  });

  it('fails as a whole without a login, whatever the repository', async () => {
    const fetch = vi.fn(async (_url: string | URL | Request) => new Response('', { status: 401 }));
    const client = new GitHubClient({ token: 't', fetch: fetch as typeof globalThis.fetch });
    await expect(client.pulls(['acme/api', 'acme/web'])).rejects.toMatchObject({
      kind: 'loggedOut',
    });
  });

  it('reads the log only of jobs that run in the repository itself', () => {
    const shared = pr({
      commits: {
        nodes: [
          {
            commit: {
              oid: 'x',
              statusCheckRollup: {
                state: 'FAILURE',
                contexts: {
                  nodes: [
                    {
                      __typename: 'CheckRun',
                      name: 'org check',
                      status: 'COMPLETED',
                      conclusion: 'FAILURE',
                      detailsUrl: 'https://github.com/acme/engineering/actions/runs/5',
                      databaseId: 5,
                    },
                  ],
                },
              },
            },
          },
        ],
      },
    });
    expect(parsePulls(['acme/api'], answer([shared])).failed['acme/api#7']).toEqual([
      { name: 'org check', url: 'https://github.com/acme/engineering/actions/runs/5', logId: null },
    ]);
  });
});

describe('the pace of the looks', () => {
  it('spaces the looks out with many repositories', async () => {
    vi.useFakeTimers();
    try {
      const client = new FakeClient();
      let now = 0;
      const watcher = new PullWatcher({ client, intervalMs: 60_000, now: () => now });
      const repos = Array.from({ length: 30 }, (_, i) => `acme/r${i}`);
      watcher.configure({ repos, account: '' });
      for (let i = 0; i < 10; i++) client.answers.push(result([]));
      watcher.start();
      await vi.advanceTimersByTimeAsync(0);
      expect(client.calls).toHaveLength(1);
      // Thirty repositories: a look every two minutes, not every minute.
      now = 60_000;
      await vi.advanceTimersByTimeAsync(60_000);
      expect(client.calls).toHaveLength(1);
      now = 120_000;
      await vi.advanceTimersByTimeAsync(60_000);
      expect(client.calls).toHaveLength(2);
      watcher.dispose();
    } finally {
      vi.useRealTimers();
    }
  });
});
