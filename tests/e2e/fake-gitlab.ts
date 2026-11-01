// A GitLab of the tests: answers the query of merge requests, the list of projects and the logs
// of jobs from data the test sets and can change while the app runs.
import http from 'node:http';
import type { AddressInfo } from 'node:net';

export interface FakeGitLabJob {
  name: string;
  /** What GitLab calls the state of a job: SUCCESS, FAILED, RUNNING… */
  status: string;
  /** For a failure, the log the app reads. */
  log?: string;
}

export interface FakeMergeRequest {
  iid: number;
  title: string;
  author: string;
  branch: string;
  base?: string;
  draft?: boolean;
  approved?: boolean;
  reviewers?: string[];
  comments?: number;
  /** Minutes since the latest update. */
  updatedMinutes?: number;
  sha?: string;
  jobs: FakeGitLabJob[];
}

export interface FakeGitLab {
  url: string;
  /** Projects by their path, and their open merge requests; the test changes them at will. */
  projects: Record<string, FakeMergeRequest[]>;
  username: string;
  close(): Promise<void>;
}

export const FAKE_GITLAB_TOKEN = 'e2e-gitlab-token';

export async function startFakeGitLab(
  projects: Record<string, FakeMergeRequest[]>,
  username = 'ana',
): Promise<FakeGitLab> {
  const fake: FakeGitLab = { url: '', projects, username, close: async () => {} };
  const logs = new Map<number, string>();

  const node = (path: string, mr: FakeMergeRequest) => {
    const jobs = mr.jobs.map((job, index) => {
      const id = mr.iid * 100 + index;
      if (job.log) logs.set(id, job.log);
      return {
        id: `gid://gitlab/Ci::Build/${id}`,
        name: job.name,
        status: job.status,
        allowFailure: false,
        webPath: `/${path}/-/jobs/${id}`,
      };
    });
    const status = mr.jobs.some((j) => j.status === 'FAILED')
      ? 'FAILED'
      : mr.jobs.some((j) => j.status === 'RUNNING' || j.status === 'PENDING')
        ? 'RUNNING'
        : 'SUCCESS';
    return {
      iid: String(mr.iid),
      title: mr.title,
      webUrl: `https://gitlab.com/${path}/-/merge_requests/${mr.iid}`,
      draft: mr.draft === true,
      createdAt: '2026-10-29T10:00:00Z',
      updatedAt: new Date(Date.now() - (mr.updatedMinutes ?? 5) * 60_000).toISOString(),
      sourceBranch: mr.branch,
      targetBranch: mr.base ?? 'main',
      diffHeadSha: mr.sha ?? `sha-${mr.iid}`,
      approved: mr.approved === true,
      author: { username: mr.author },
      reviewers: {
        nodes: (mr.reviewers ?? []).map((username) => ({
          username,
          mergeRequestInteraction: { reviewState: 'UNREVIEWED' },
        })),
      },
      userNotesCount: mr.comments ?? 0,
      notes: { nodes: mr.comments ? [{ author: { username: 'bruno' } }] : [] },
      headPipeline: jobs.length
        ? {
            status,
            sha: mr.sha ?? `sha-${mr.iid}`,
            jobs: { nodes: jobs },
            failedJobs: { nodes: jobs.filter((j) => j.status === 'FAILED') },
          }
        : null,
    };
  };

  const server = http.createServer((req, res) => {
    let body = '';
    req.on('data', (chunk) => (body += chunk));
    req.on('end', () => {
      if (req.headers.authorization !== `Bearer ${FAKE_GITLAB_TOKEN}`) {
        res.writeHead(401).end();
        return;
      }
      const url = req.url ?? '';
      const trace = /^\/api\/v4\/projects\/[^/]+\/jobs\/(\d+)\/trace$/.exec(url);
      if (trace) {
        const log = logs.get(Number(trace[1]));
        if (log === undefined) res.writeHead(404).end();
        else res.end(log);
        return;
      }
      res.setHeader('content-type', 'application/json');
      if (url.startsWith('/api/v4/projects?')) {
        res.end(
          JSON.stringify(
            Object.keys(fake.projects).map((path_with_namespace) => ({ path_with_namespace })),
          ),
        );
        return;
      }
      const { variables } = JSON.parse(body || '{}') as { variables?: { path?: string } };
      const path = variables?.path ?? '';
      const mrs = fake.projects[path];
      res.end(
        JSON.stringify({
          data: {
            currentUser: { username: fake.username },
            project: mrs
              ? { fullPath: path, mergeRequests: { nodes: mrs.map((mr) => node(path, mr)) } }
              : null,
          },
        }),
      );
    });
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  fake.url = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  fake.close = () =>
    new Promise((resolve) => {
      server.closeAllConnections();
      server.close(() => resolve());
    });
  return fake;
}

/** The environment that points the app at the fake GitLab. */
export const fakeGitLabEnv = (fake: FakeGitLab): Record<string, string> => ({
  AGENT_CONTROLLER_GITLAB_API: fake.url,
  AGENT_CONTROLLER_GITLAB_TOKEN: FAKE_GITLAB_TOKEN,
});
