// A GitHub of the tests: answers the queries of the app (GraphQL and the logs of jobs) from data
// the test sets and can change while the app runs.
import http from 'node:http';
import type { AddressInfo } from 'node:net';

export interface FakeJob {
  name: string;
  /** What GitHub calls the end of a check run: SUCCESS, FAILURE, SKIPPED… */
  conclusion: string;
  /** For a failure, the log the app reads; the job gets an id of Actions. */
  log?: string;
}

export interface FakePull {
  number: number;
  title: string;
  author: string;
  branch: string;
  base?: string;
  draft?: boolean;
  review?: 'APPROVED' | 'CHANGES_REQUESTED' | 'REVIEW_REQUIRED' | null;
  reviewers?: string[];
  comments?: number;
  /** Minutes since the latest update. */
  updatedMinutes?: number;
  sha?: string;
  /** Running when set: the rollup is PENDING. */
  running?: boolean;
  jobs: FakeJob[];
  /** What `GET /pulls/{n}/files` lists, to review it in the app. */
  files?: { filename: string; status: string; patch?: string }[];
  /** The review comments already on it. */
  reviewComments?: Record<string, unknown>[];
  /** `mergeable_state` of the REST API; `clean` when not set. */
  mergeableState?: string;
}

/** A review or merge the app published, as the fake received it. */
export interface FakeWrite {
  method: string;
  path: string;
  body: unknown;
}

export interface FakeGitHub {
  url: string;
  /** Repositories and their open pull requests; the test changes them at will. */
  repos: Record<string, FakePull[]>;
  /** What "Pick from the ones I can access" lists. */
  available: string[];
  login: string;
  /** Queries of pull requests answered so far. */
  queries: number;
  /** Every review, merge and branch deletion the app sent. */
  writes: FakeWrite[];
  /** Open issues by repository, as `GET /repos/{r}/issues` lists them. */
  issues: Record<string, { number: number; title: string; body?: string; labels?: string[] }[]>;
  close(): Promise<void>;
}

export const FAKE_TOKEN = 'e2e-token';

export async function startFakeGitHub(
  repos: Record<string, FakePull[]>,
  login = 'ana',
): Promise<FakeGitHub> {
  const fake: FakeGitHub = {
    url: '',
    repos,
    available: Object.keys(repos),
    login,
    queries: 0,
    writes: [],
    issues: {},
    close: async () => {},
  };
  const logs = new Map<number, string>();

  const node = (repo: string, pull: FakePull) => {
    const contexts = pull.jobs.map((job, index) => {
      const id = pull.number * 100 + index;
      if (job.log) logs.set(id, job.log);
      return {
        __typename: 'CheckRun',
        name: job.name,
        status: pull.running && job.conclusion !== 'SUCCESS' ? 'IN_PROGRESS' : 'COMPLETED',
        conclusion: job.conclusion,
        detailsUrl: `https://github.com/${repo}/actions/runs/${pull.number}/job/${id}`,
        databaseId: id,
      };
    });
    const failed = pull.jobs.some((j) => j.conclusion === 'FAILURE');
    return {
      number: pull.number,
      title: pull.title,
      url: `https://github.com/${repo}/pull/${pull.number}`,
      isDraft: pull.draft === true,
      createdAt: '2026-10-29T10:00:00Z',
      updatedAt: new Date(Date.now() - (pull.updatedMinutes ?? 5) * 60_000).toISOString(),
      headRefName: pull.branch,
      baseRefName: pull.base ?? 'main',
      reviewDecision: pull.review === undefined ? 'REVIEW_REQUIRED' : pull.review,
      author: { login: pull.author },
      reviewRequests: {
        nodes: (pull.reviewers ?? []).map((login) => ({ requestedReviewer: { login } })),
      },
      comments: {
        totalCount: pull.comments ?? 0,
        nodes: pull.comments ? [{ author: { login: 'bruno' } }] : [],
      },
      reviews: { totalCount: 0, nodes: [] },
      commits: {
        nodes: [
          {
            commit: {
              oid: pull.sha ?? `sha-${pull.number}`,
              statusCheckRollup: contexts.length
                ? {
                    state: pull.running ? 'PENDING' : failed ? 'FAILURE' : 'SUCCESS',
                    contexts: { nodes: contexts },
                  }
                : null,
            },
          },
        ],
      },
    };
  };

  const server = http.createServer((req, res) => {
    let body = '';
    req.on('data', (chunk) => (body += chunk));
    req.on('end', () => {
      if (req.headers.authorization !== `Bearer ${FAKE_TOKEN}`) {
        res.writeHead(401).end();
        return;
      }
      const issues = /^\/repos\/([^/]+\/[^/]+)\/issues(?:\?.*)?$/.exec(req.url ?? '');
      if (issues) {
        const repo = issues[1]!;
        res.setHeader('content-type', 'application/json');
        res.end(
          JSON.stringify(
            (fake.issues[repo] ?? []).map((i) => ({
              number: i.number,
              title: i.title,
              body: i.body ?? '',
              html_url: `https://github.com/${repo}/issues/${i.number}`,
              user: { login: 'ana' },
              labels: (i.labels ?? []).map((name) => ({ name })),
            })),
          ),
        );
        return;
      }
      // A new pull request: recorded, and listed from then on.
      const created = /^\/repos\/([^/]+\/[^/]+)\/pulls$/.exec(req.url ?? '');
      if (created && req.method === 'POST') {
        const repo = created[1]!;
        const input = JSON.parse(body) as { title: string; head: string; base: string };
        fake.writes.push({ method: 'POST', path: req.url!, body: JSON.parse(body) });
        const list = (fake.repos[repo] ??= []);
        const number = 100 + list.length;
        list.push({
          number,
          title: input.title,
          author: fake.login,
          branch: input.head,
          base: input.base,
          jobs: [],
        });
        res.setHeader('content-type', 'application/json');
        res.end(JSON.stringify({ number, html_url: `https://github.com/${repo}/pull/${number}` }));
        return;
      }
      const rest =
        /^\/repos\/([^/]+\/[^/]+)\/(pulls\/(\d+)(?:\/(files|comments|reviews|merge))?|git\/refs\/heads\/.+)(?:\?.*)?$/.exec(
          req.url ?? '',
        );
      if (rest) {
        const [, repo, , number, part] = rest;
        const pull = fake.repos[repo!]?.find((p) => p.number === Number(number));
        const path = (req.url ?? '').replace(/\?.*$/, '');
        res.setHeader('content-type', 'application/json');
        if (req.method !== 'GET') {
          fake.writes.push({
            method: req.method ?? '',
            path,
            body: body ? JSON.parse(body) : null,
          });
          // A merged pull request leaves the open ones.
          if (part === 'merge' && pull) {
            fake.repos[repo!] = fake.repos[repo!]!.filter((p) => p !== pull);
          }
          res.end(part === 'merge' ? '{"merged":true}' : '{}');
          return;
        }
        if (!pull) {
          res.writeHead(404).end('{"message":"Not Found"}');
          return;
        }
        const page = /[?&]page=(\d+)/.exec(req.url ?? '')?.[1] ?? '1';
        if (part === 'files') res.end(JSON.stringify(page === '1' ? (pull.files ?? []) : []));
        else if (part === 'comments') {
          res.end(JSON.stringify(page === '1' ? (pull.reviewComments ?? []) : []));
        } else {
          res.end(
            JSON.stringify({
              title: pull.title,
              html_url: `https://github.com/${repo}/pull/${pull.number}`,
              user: { login: pull.author },
              head: { ref: pull.branch, sha: pull.sha ?? `sha-${pull.number}` },
              base: { ref: pull.base ?? 'main' },
              draft: pull.draft === true,
              mergeable_state: pull.mergeableState ?? 'clean',
              changed_files: pull.files?.length ?? 0,
            }),
          );
        }
        return;
      }
      const job = /^\/repos\/[^/]+\/[^/]+\/actions\/jobs\/(\d+)\/logs$/.exec(req.url ?? '');
      if (job) {
        const log = logs.get(Number(job[1]));
        if (log === undefined) res.writeHead(404).end();
        else res.end(log);
        return;
      }
      const { query } = JSON.parse(body || '{}') as { query: string };
      res.setHeader('content-type', 'application/json');
      if (query.includes('repositories(')) {
        res.end(
          JSON.stringify({
            data: {
              viewer: {
                repositories: {
                  nodes: fake.available.map((nameWithOwner) => ({ nameWithOwner })),
                  pageInfo: { hasNextPage: false },
                },
              },
            },
          }),
        );
        return;
      }
      fake.queries++;
      const data: Record<string, unknown> = { viewer: { login: fake.login } };
      const errors: unknown[] = [];
      const aliases = query.matchAll(/(r\d+): repository\(owner: "([^"]+)", name: "([^"]+)"\)/g);
      for (const [, alias, owner, name] of aliases) {
        const repo = `${owner}/${name}`;
        const pulls = fake.repos[repo];
        if (pulls) {
          data[alias!] = {
            nameWithOwner: repo,
            pullRequests: { nodes: pulls.map((p) => node(repo, p)) },
          };
        } else {
          data[alias!] = null;
          errors.push({
            path: [alias],
            message: `Could not resolve to a Repository with the name '${repo}'.`,
          });
        }
      }
      res.end(JSON.stringify({ data, errors }));
    });
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  fake.url = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  fake.close = () => new Promise((resolve) => server.close(() => resolve()));
  return fake;
}

/** The environment that points the app at the fake, with looks every second. */
export const fakeGitHubEnv = (fake: FakeGitHub): Record<string, string> => ({
  AGENT_CONTROLLER_GITHUB_API: fake.url,
  AGENT_CONTROLLER_GITHUB_TOKEN: FAKE_TOKEN,
  AGENT_CONTROLLER_PULLS_MS: '1000',
});
