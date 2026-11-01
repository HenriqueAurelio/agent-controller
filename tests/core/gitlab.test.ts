import { describe, expect, it } from 'vitest';
import { ForgeError, type ForgeClient, type ForgePulls } from '../../src/core/forges/forge';
import {
  GitLabClient,
  gitlabLogTail,
  parseMergeRequests,
  type GitLabTransport,
} from '../../src/core/forges/gitlab';
import { pullNotices, PullWatcher } from '../../src/core/forges/PullWatcher';
import {
  forgeOf,
  normalizeRepo,
  parseRepoList,
  pullRef,
  type PullRequestView,
} from '../../src/shared/pulls';

const ESC = String.fromCharCode(27);

describe('GitLab repositories in the list', () => {
  it('reads the addresses of a project, of a merge request and of a clone', () => {
    expect(normalizeRepo('https://gitlab.com/acme/api')).toBe('gitlab.com/acme/api');
    expect(normalizeRepo('https://gitlab.com/acme/team/api/-/merge_requests/3')).toBe(
      'gitlab.com/acme/team/api',
    );
    expect(normalizeRepo('git@gitlab.empresa.com.br:time/app.git')).toBe(
      'gitlab.empresa.com.br/time/app',
    );
    expect(normalizeRepo('ssh://git@gitlab.com/acme/api.git')).toBe('gitlab.com/acme/api');
    expect(normalizeRepo('GitLab.com/Acme/Api/')).toBe('gitlab.com/Acme/Api');
    // GitHub stays as it was.
    expect(normalizeRepo('https://github.com/acme/api/pull/3')).toBe('acme/api');
    expect(normalizeRepo('git@github.com:acme/api.git')).toBe('acme/api');
    expect(normalizeRepo('vercel/next.js')).toBe('vercel/next.js');
  });

  it('refuses what is not a project', () => {
    expect(normalizeRepo('https://gitlab.com/acme')).toBeNull();
    expect(normalizeRepo('https://gitlab.com:8443/acme/api')).toBeNull();
    expect(normalizeRepo('gitlab.com/acme/../api')).toBeNull();
    expect(normalizeRepo('acme/api/extra')).toBeNull();
  });

  it('mixes both services in one paste, and tells them apart', () => {
    const { repos, invalid } = parseRepoList(
      'acme/api, https://gitlab.com/acme/web\ngitlab.com/acme/web, nada',
    );
    expect(repos).toEqual(['acme/api', 'gitlab.com/acme/web']);
    expect(invalid).toEqual(['nada']);
    expect(repos.map(forgeOf)).toEqual(['github', 'gitlab']);
    expect(pullRef({ forge: 'gitlab', repo: 'gitlab.com/acme/web', number: 4 })).toBe(
      'gitlab.com/acme/web!4',
    );
    expect(pullRef({ forge: 'github', repo: 'acme/api', number: 4 })).toBe('acme/api#4');
  });
});

const mr = (over: Record<string, unknown> = {}) => ({
  iid: '12',
  title: 'Paginar o relatório',
  webUrl: 'https://gitlab.com/acme/web/-/merge_requests/12',
  draft: false,
  createdAt: '2026-10-30T10:00:00Z',
  updatedAt: '2026-10-31T10:00:00Z',
  sourceBranch: 'paginar',
  targetBranch: 'main',
  diffHeadSha: 'abc',
  approved: false,
  author: { username: 'ana' },
  reviewers: {
    nodes: [
      { username: 'bruno', mergeRequestInteraction: { reviewState: 'UNREVIEWED' } },
      { username: 'carla', mergeRequestInteraction: { reviewState: 'APPROVED' } },
    ],
  },
  userNotesCount: 3,
  notes: { nodes: [{ author: { username: 'bruno' } }] },
  headPipeline: {
    status: 'FAILED',
    sha: 'abc',
    jobs: {
      nodes: [
        {
          id: 'gid://gitlab/Ci::Build/501',
          name: 'test',
          status: 'FAILED',
          allowFailure: false,
          // A merge request from a fork: the pipeline runs there.
          webPath: '/ana/web/-/jobs/501',
        },
        {
          id: 'gid://gitlab/Ci::Build/502',
          name: 'audit',
          status: 'FAILED',
          allowFailure: true,
          webPath: '/acme/web/-/jobs/502',
        },
        { id: 'gid://gitlab/Ci::Build/503', name: 'lint', status: 'SUCCESS', webPath: '' },
        { id: 'gid://gitlab/Ci::Build/504', name: 'deploy', status: 'MANUAL', webPath: '' },
      ],
    },
  },
  ...over,
});

const body = (mrs: unknown[], user: unknown = { username: 'ana' }) => ({
  data: { currentUser: user, project: { fullPath: 'acme/web', mergeRequests: { nodes: mrs } } },
});

describe('reading GitLab', () => {
  it('reads the merge requests, their pipeline and who reviews them', () => {
    const result = parseMergeRequests('gitlab.com/acme/web', body([mr()]));
    expect(result.login).toBe('ana');
    const [pull] = result.pulls;
    expect(pull).toMatchObject({
      key: 'gitlab.com/acme/web!12',
      forge: 'gitlab',
      repo: 'gitlab.com/acme/web',
      number: 12,
      mine: true,
      branch: 'paginar',
      base: 'main',
      review: 'required',
      // Carla already approved: only who has not answered is still asked.
      reviewers: ['bruno'],
      reviewRequested: false,
      comments: 3,
      lastCommentBy: 'bruno',
      pipeline: { state: 'failure', sha: 'abc' },
    });
    expect(pull!.pipeline.jobs.map((j) => [j.name, j.state])).toEqual([
      ['test', 'failure'],
      // Allowed to fail, and waiting for a hand: neither holds the merge request back.
      ['audit', 'skipped'],
      ['lint', 'success'],
      ['deploy', 'skipped'],
    ]);
    expect(pull!.pipeline.jobs[0]!.url).toBe('https://gitlab.com/ana/web/-/jobs/501');
    expect(result.failed[pull!.key]).toEqual([
      {
        name: 'test',
        url: 'https://gitlab.com/ana/web/-/jobs/501',
        logId: 501,
        project: 'ana/web',
      },
    ]);
  });

  it('finds the failed jobs of a pipeline too big for one page of jobs', () => {
    const big = mr({
      headPipeline: {
        status: 'FAILED',
        sha: 'abc',
        jobs: {
          nodes: [
            { id: 'gid://gitlab/Ci::Build/1', name: 'a', status: 'SUCCESS', webPath: '' },
            { id: 'gid://gitlab/Ci::Build/2', name: 'b', status: 'FAILED', webPath: '' },
          ],
        },
        failedJobs: {
          nodes: [
            { id: 'gid://gitlab/Ci::Build/2', name: 'b', status: 'FAILED', webPath: '' },
            { id: 'gid://gitlab/Ci::Build/900', name: 'rspec 7/40', status: 'FAILED', webPath: '' },
          ],
        },
      },
    });
    const result = parseMergeRequests('gitlab.com/acme/web', body([big]));
    expect(result.failed['gitlab.com/acme/web!12']!.map((j) => [j.name, j.logId])).toEqual([
      ['b', 2],
      ['rspec 7/40', 900],
    ]);
    expect(result.pulls[0]!.pipeline.jobs).toHaveLength(3);
  });

  it('knows changes asked, an approval and a merge request that asks for my review', () => {
    const changes = mr({
      iid: '13',
      author: { username: 'bruno' },
      reviewers: {
        nodes: [
          { username: 'ana', mergeRequestInteraction: { reviewState: 'UNREVIEWED' } },
          { username: 'carla', mergeRequestInteraction: { reviewState: 'REQUESTED_CHANGES' } },
        ],
      },
    });
    const approved = mr({ iid: '14', approved: true, reviewers: { nodes: [] } });
    const [a, b] = parseMergeRequests('gitlab.com/acme/web', body([changes, approved])).pulls;
    expect(a).toMatchObject({ mine: false, review: 'changes', reviewRequested: true });
    expect(b).toMatchObject({ review: 'approved', reviewers: [] });
  });

  it('tells a pipeline still running, one waiting for a manual job and none at all', () => {
    const states = parseMergeRequests(
      'gitlab.com/acme/web',
      body([
        mr({ iid: '1', headPipeline: { status: 'RUNNING', sha: 'a', jobs: { nodes: [] } } }),
        mr({
          iid: '2',
          headPipeline: {
            status: 'MANUAL',
            sha: 'a',
            jobs: { nodes: [{ id: 'x/1', name: 'build', status: 'SUCCESS', webPath: '' }] },
          },
        }),
        mr({ iid: '3', headPipeline: null }),
      ]),
    ).pulls.map((p) => p.pipeline.state);
    expect(states).toEqual(['pending', 'success', 'none']);
  });

  it('says when the server has no login, and when the project does not exist', () => {
    expect(() => parseMergeRequests('gitlab.empresa.com/time/app', body([], null))).toThrow(
      expect.objectContaining({ kind: 'loggedOut', host: 'gitlab.empresa.com' }),
    );
    const gone = parseMergeRequests('gitlab.com/acme/gone', {
      data: { currentUser: { username: 'ana' }, project: null },
    });
    expect(gone.repoErrors).toEqual({ 'gitlab.com/acme/gone': 'not found' });
  });
});

describe('the log of a GitLab job', () => {
  const stamp = (n: number, stream = '01O') =>
    `2026-10-31T19:00:${String(n).padStart(2, '0')}.081525Z ${stream} `;

  it('keeps what the job ran, through the line that says it failed', () => {
    const log = [
      `${stamp(1, '00O')}section_start:1:prepare_executor\r${ESC}[0K${ESC}[36;1mPreparing the "docker" executor${ESC}[0;m`,
      `${stamp(1, '00O')}Using docker image node:22`,
      `${stamp(2, '00O')}section_end:1:prepare_executor\r${ESC}[0K`,
      `${stamp(3, '00O')}section_start:2:step_script\r${ESC}[0K${ESC}[36;1mExecuting "step_script"${ESC}[0;m`,
      `${stamp(4)}$ npm test`,
      `${stamp(5)}Status: processing`,
      `${stamp(6)}Status: processing`,
      `${stamp(7)}downloading 10%\rdownloading 100%`,
      `${stamp(8)}${ESC}[31mFAIL${ESC}[0m tests/report.test.ts > pages`,
      `${stamp(9, '00O')}section_end:2:step_script\r${ESC}[0K`,
      `${stamp(9, '00O+')}section_start:3:cleanup_file_variables\r${ESC}[0K`,
      `${stamp(9, '00O+')}${ESC}[0K${ESC}[36;1mCleaning up project directory and file based variables${ESC}[0;m`,
      `${stamp(10, '00O')}section_end:3:cleanup_file_variables\r${ESC}[0K`,
      `${stamp(10, '00O')}${ESC}[31;1mERROR: Job failed: exit code 1${ESC}[0;m`,
      '',
    ].join('\n');
    const expected = [
      'Executing "step_script"',
      '$ npm test',
      'Status: processing',
      'downloading 100%',
      'FAIL tests/report.test.ts > pages',
      'ERROR: Job failed: exit code 1',
    ];
    expect(gitlabLogTail(log).split('\n')).toEqual(expected);
    // The same log from a Windows runner, whose lines end with \r\n.
    expect(gitlabLogTail(log.replace(/\n/g, '\r\n')).split('\n')).toEqual(expected);
  });
});

class FakeTransport implements GitLabTransport {
  queries: Record<string, unknown>[] = [];
  paths: string[] = [];
  answers: (unknown | ForgeError)[] = [];
  projects: Record<string, string[]> = {};

  async graphql(_host: string, _query: string, variables: Record<string, unknown>) {
    this.queries.push(variables);
    const next = this.answers.shift();
    if (next instanceof ForgeError) throw next;
    return next;
  }
  async rest(host: string, path: string) {
    this.paths.push(`${host} ${path}`);
    if (path.startsWith('projects?')) {
      if (!this.projects[host]) throw new ForgeError('loggedOut', 'no login', host);
      return JSON.stringify(this.projects[host].map((p) => ({ path_with_namespace: p })));
    }
    return `${stamp()}$ npm test\n${stamp()}ERROR: Job failed: exit code 1\n`;
  }
  async defaultHost() {
    return 'gitlab.com';
  }
}
const stamp = () => '2026-10-31T19:00:00.000000Z 01O ';

describe('the GitLab client', () => {
  it('tries a smaller page when the server gives up, and reads the log in the fork', async () => {
    const transport = new FakeTransport();
    const timedOut = new ForgeError('error', 'glab: HTTP 504');
    timedOut.timedOut = true;
    transport.answers.push(timedOut, body([mr()]));
    const client = new GitLabClient(transport);
    const result = await client.pulls(['gitlab.com/acme/web']);
    expect(transport.queries.map((q) => q.pulls)).toEqual([20, 8]);
    expect(transport.queries[0]).toMatchObject({ path: 'acme/web' });
    const [job] = result.failed['gitlab.com/acme/web!12']!;
    expect(await client.jobLog('gitlab.com/acme/web', job!)).toBe(
      '$ npm test\nERROR: Job failed: exit code 1',
    );
    expect(transport.paths).toContain('gitlab.com projects/ana%2Fweb/jobs/501/trace');
  });

  it('keeps the projects of a server when another has no login', async () => {
    const transport = new FakeTransport();
    transport.answers.push(body([mr()]), body([], null));
    const result = await new GitLabClient(transport).pulls([
      'gitlab.com/acme/web',
      'gitlab.empresa.com/time/app',
    ]);
    expect(result.pulls).toHaveLength(1);
    expect(Object.keys(result.repoErrors)).toEqual(['gitlab.empresa.com/time/app']);
  });

  it('fails as a whole when no server could be read', async () => {
    const transport = new FakeTransport();
    transport.answers.push(body([], null));
    await expect(new GitLabClient(transport).pulls(['gitlab.com/acme/web'])).rejects.toMatchObject({
      kind: 'loggedOut',
    });
  });

  it('says why when no server could be listed, instead of an empty list', async () => {
    const transport = new FakeTransport();
    await expect(new GitLabClient(transport).available([])).rejects.toMatchObject({
      kind: 'loggedOut',
    });
  });

  it('lists the projects of glab’s server and of every watched one', async () => {
    const transport = new FakeTransport();
    transport.projects = { 'gitlab.com': ['acme/web'], 'gitlab.empresa.com': ['time/app'] };
    const list = await new GitLabClient(transport).available([
      'acme/api',
      'gitlab.empresa.com/time/app',
    ]);
    expect(list).toEqual(['gitlab.com/acme/web', 'gitlab.empresa.com/time/app']);
  });
});

const view = (over: Partial<PullRequestView>): PullRequestView => ({
  key: 'acme/api#7',
  forge: 'github',
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
  updatedAt: '2026-10-31T10:00:00Z',
  review: null,
  reviewers: [],
  reviewRequested: false,
  comments: 0,
  lastCommentBy: null,
  pipeline: { state: 'success', sha: 's1', jobs: [] },
  ...over,
});

class Client implements ForgeClient {
  answers: (ForgePulls | Error)[] = [];
  async pulls() {
    const next = this.answers.shift();
    if (!next || next instanceof Error) throw next ?? new Error('no answer');
    return next;
  }
  async available(): Promise<string[]> {
    return [];
  }
  async jobLog() {
    return '';
  }
  setAccount() {}
}

const answer = (login: string, pulls: PullRequestView[]): ForgePulls => ({
  login,
  pulls,
  failed: {},
  repoErrors: {},
});

describe('watching both services', () => {
  const mrView = view({
    key: 'gitlab.com/acme/web!3',
    forge: 'gitlab',
    repo: 'gitlab.com/acme/web',
    number: 3,
    author: 'henriquesd',
  });

  it('shows one service while the other cannot be read, with what it showed before', async () => {
    const github = new Client();
    const gitlab = new Client();
    const watcher = new PullWatcher({ clients: { github, gitlab } });
    watcher.configure({ repos: ['acme/api', 'gitlab.com/acme/web'], account: '' });
    github.answers.push(answer('ana', [view({})]), new ForgeError('noCli', 'spawn gh ENOENT'));
    gitlab.answers.push(answer('henriquesd', [mrView]), answer('henriquesd', [mrView]));

    await watcher.refresh();
    expect(watcher.get()).toMatchObject({
      status: 'ok',
      problems: [],
      logins: { github: 'ana', gitlab: 'henriquesd' },
    });
    expect(watcher.get().pulls.map((p) => p.key)).toEqual(['acme/api#7', 'gitlab.com/acme/web!3']);

    await watcher.refresh();
    expect(watcher.get()).toMatchObject({
      status: 'ok',
      problems: [{ forge: 'github', status: 'noCli' }],
      logins: { github: 'ana', gitlab: 'henriquesd' },
    });
    expect(watcher.get().pulls).toHaveLength(2);
    watcher.dispose();
  });

  it('tells the status of the first service when none can be read', async () => {
    const gitlab = new Client();
    const watcher = new PullWatcher({ clients: { github: new Client(), gitlab } });
    watcher.configure({ repos: ['gitlab.empresa.com/time/app'], account: '' });
    gitlab.answers.push(new ForgeError('loggedOut', 'no login', 'gitlab.empresa.com'));
    await watcher.refresh();
    expect(watcher.get()).toMatchObject({
      status: 'loggedOut',
      problems: [{ forge: 'gitlab', status: 'loggedOut', host: 'gitlab.empresa.com' }],
    });
    watcher.dispose();
  });

  it('compares a comment with the login of the service it came from', () => {
    const seen = new Set(['gitlab.com/acme/web']);
    const logins = { github: 'HenriqueAurelio', gitlab: 'henriquesd' };
    const before = { ...mrView, mine: true, comments: 1 };
    const own = { ...before, comments: 2, lastCommentBy: 'henriquesd' };
    const theirs = { ...before, comments: 2, lastCommentBy: 'bruno' };
    expect(pullNotices([before], seen, [own], logins)).toEqual([]);
    expect(pullNotices([before], seen, [theirs], logins).map((n) => n.kind)).toEqual(['comment']);
  });
});

describe('the repositories to pick from', () => {
  it('asks each service apart, and says why one has nothing', async () => {
    const github = new Client();
    const gitlab = new Client();
    github.available = async () => ['acme/api'];
    gitlab.available = async () => {
      throw new ForgeError('noCli', 'spawn glab ENOENT');
    };
    const watcher = new PullWatcher({ clients: { github, gitlab } });
    // GitLab down does not take the GitHub list with it.
    expect(await watcher.available('github')).toEqual({ repos: ['acme/api'] });
    expect(await watcher.available('gitlab')).toEqual({
      repos: [],
      problem: { forge: 'gitlab', status: 'noCli' },
    });
    watcher.dispose();
  });
});
