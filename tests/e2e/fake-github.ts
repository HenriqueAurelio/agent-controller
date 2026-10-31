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
