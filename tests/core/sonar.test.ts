import fs from 'node:fs';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { issueProblem, SonarApi } from '@core/sonar/SonarApi';
import { SonarConfigStore } from '@core/sonar/SonarConfigStore';
import { readTaskId, scannerParams, SonarService, type SonarJob } from '@core/sonar/SonarService';
import type { RunResult, ShellRunOptions } from '@core/tools/ToolRunner';
import { sanitizeSonarConfig, sonarSummary, type SonarConfig, type SonarRun } from '@shared/sonar';
import { removeDir, tempDir, waitFor } from './helpers';

const CONFIG: SonarConfig = {
  provider: 'sonarqube',
  url: 'http://localhost:9000',
  projectKey: 'acme:api',
  organization: '',
  scanner: 'sonar-scanner',
  enabled: true,
  branches: true,
  onTurnEnd: false,
};

describe('the setup of Sonar', () => {
  it('keeps what can be used and fills in the rest', () => {
    expect(sanitizeSonarConfig({ projectKey: 'acme:api', url: 'http://localhost:9000/' })).toEqual({
      ...CONFIG,
    });
    expect(
      sanitizeSonarConfig({ provider: 'sonarcloud', projectKey: 'a_b', organization: 'acme' }),
    ).toMatchObject({ url: 'https://sonarcloud.io', organization: 'acme' });
    expect(sanitizeSonarConfig({ provider: 'sonarcloud', projectKey: 'a' })).toBeNull();
    expect(sanitizeSonarConfig({ projectKey: 'a', url: 'ftp://x' })).toBeNull();
    expect(sanitizeSonarConfig({ projectKey: 'a b', url: 'http://x' })).toBeNull();
    expect(
      sanitizeSonarConfig({ projectKey: 'a', url: 'http://x', scanner: 'npx @sonar/scan\nrm' }),
    ).toMatchObject({ scanner: 'sonar-scanner' });
  });

  it('is saved per group, with no token, and a group can drop it', () => {
    const dir = tempDir();
    try {
      const file = path.join(dir, 'sonar.json');
      const store = new SonarConfigStore(file);
      store.set('g1', CONFIG);
      expect(new SonarConfigStore(file).get('g1')).toEqual(CONFIG);
      expect(fs.readFileSync(file, 'utf8')).not.toMatch(/token/i);
      store.set('g1', null);
      expect(new SonarConfigStore(file).get('g1')).toBeNull();
    } finally {
      removeDir(dir);
    }
  });

  it('sums up the sessions of a group', () => {
    const run = (status: SonarRun['status']): SonarRun => ({
      status,
      startedAt: 0,
      branch: null,
      problems: [],
      more: 0,
    });
    expect(
      sonarSummary([run('passed'), run('failed'), run('error'), run('running'), undefined]),
    ).toEqual({ passed: 1, failed: 2, running: 1 });
  });
});

describe('the API of Sonar', () => {
  it('turns an issue into a problem of the list', () => {
    expect(
      issueProblem(
        {
          component: 'acme:api:src/a.ts',
          line: 12,
          severity: 'CRITICAL',
          message: 'Remove this log',
          rule: 'ts:S106',
        },
        'acme:api',
      ),
    ).toEqual({
      file: 'src/a.ts',
      line: 12,
      severity: 'error',
      message: 'Remove this log (ts:S106)',
      source: 'Sonar',
      checkId: 'sonar',
    });
    expect(
      issueProblem({ component: 'acme:api:b.ts', severity: 'MINOR', message: 'x' }, 'acme:api'),
    ).toMatchObject({ line: 1, severity: 'warning' });
    // An issue of the project, not of a file, has no place in the list.
    expect(issueProblem({ component: 'acme:api', message: 'x' }, 'acme:api')).toBeNull();
  });

  it('asks with the token as user, the branch of the session, and says what failed', async () => {
    const asked: { url: string; auth: string | null }[] = [];
    const fetch = async (url: string, init: RequestInit = {}) => {
      asked.push({ url, auth: new Headers(init.headers).get('authorization') });
      if (url.includes('/api/issues/search')) {
        return new Response(
          JSON.stringify({
            paging: { total: 3 },
            issues: [{ component: 'acme:api:a.ts', line: 2, severity: 'MAJOR', message: 'm' }],
          }),
        );
      }
      if (url.includes('/api/components/show')) {
        return new Response(JSON.stringify({ errors: [{ msg: 'Component not found' }] }), {
          status: 404,
        });
      }
      return new Response(JSON.stringify({ valid: true }));
    };
    const api = new SonarApi(CONFIG, 'tok', { fetch: fetch as typeof globalThis.fetch });
    const issues = await api.issues('feature/x');
    expect(issues.total).toBe(3);
    expect(issues.problems).toHaveLength(1);
    expect(asked[0]!.url).toContain('branch=feature%2Fx');
    expect(asked[0]!.auth).toBe(`Basic ${Buffer.from('tok:').toString('base64')}`);
    await expect(api.test()).rejects.toMatchObject({
      status: 404,
      message: 'Sonar 404: Component not found',
    });
  });
});

describe('SonarService', () => {
  let dir = '';
  afterEach(() => dir && removeDir(dir));

  const job = (over: Partial<SonarJob> = {}): SonarJob => ({
    sessionId: 's1',
    repoKey: 'g1',
    cwd: dir,
    branch: 'feature/a',
    config: CONFIG,
    token: 'segredo',
    ...over,
  });

  /** A scanner that leaves the report, as the real one does, and says what it was given. */
  function fakeScanner(log: { cwd: string; env: NodeJS.ProcessEnv }[], exitCode = 0) {
    return async (_command: string, options: ShellRunOptions): Promise<RunResult> => {
      log.push({ cwd: options.cwd, env: options.env ?? {} });
      const params = JSON.parse(options.env!.SONAR_SCANNER_JSON_PARAMS!) as Record<string, string>;
      fs.writeFileSync(
        path.join(params['sonar.working.directory']!, 'report-task.txt'),
        `projectKey=acme:api\nceTaskId=task-${log.length}\n`,
      );
      return {
        exitCode,
        stdout: '',
        stderr: '',
        output: exitCode ? 'ERROR: token segredo was refused' : 'EXECUTION SUCCESS',
        truncated: false,
        timedOut: false,
        cancelled: false,
        durationMs: 1,
      };
    };
  }

  it('analyses each session on its own branch and keeps each result apart', async () => {
    dir = tempDir();
    const log: { cwd: string; env: NodeJS.ProcessEnv }[] = [];
    const branchesAsked: (string | null)[] = [];
    const service = new SonarService({
      workDirectory: path.join(dir, 'work'),
      run: fakeScanner(log),
      pollMs: 1,
      api: () => ({
        task: async () => ({ status: 'SUCCESS', error: '' }),
        gate: async (branch) => (branch === 'feature/a' ? 'ERROR' : 'OK'),
        issues: async (branch) => {
          branchesAsked.push(branch);
          return branch === 'feature/a'
            ? {
                problems: [
                  {
                    file: 'a.ts',
                    line: 1,
                    severity: 'error' as const,
                    message: 'm',
                    source: 'Sonar',
                    checkId: 'sonar',
                  },
                ],
                total: 1,
              }
            : { problems: [], total: 0 };
        },
      }),
    });
    service.start(job());
    service.start(job({ sessionId: 's2', branch: 'feature/b', cwd: path.join(dir, 'b') }));
    await waitFor(() => service.get('s2')?.status === 'passed');
    expect(service.get('s1')).toMatchObject({ status: 'failed', gate: 'ERROR' });
    expect(service.get('s1')!.problems).toHaveLength(1);
    expect(service.get('s2')!.problems).toHaveLength(0);
    expect(branchesAsked.sort()).toEqual(['feature/a', 'feature/b']);
    // The token goes in the environment, never in a parameter; the working folder is the app's.
    expect(log[0]!.env.SONAR_TOKEN).toBe('segredo');
    const params = JSON.parse(log[0]!.env.SONAR_SCANNER_JSON_PARAMS!) as Record<string, string>;
    expect(params).toMatchObject({
      'sonar.branch.name': 'feature/a',
      'sonar.projectKey': 'acme:api',
    });
    expect(JSON.stringify(params)).not.toContain('segredo');
    expect(params['sonar.working.directory']!.startsWith(path.join(dir, 'work'))).toBe(true);
    service.dispose();
  });

  it('hides the token in what a failed scanner said, and cancels when the agent goes back', async () => {
    dir = tempDir();
    const failing = new SonarService({
      workDirectory: path.join(dir, 'work'),
      run: fakeScanner([], 2),
      api: () => {
        throw new Error('not reached');
      },
    });
    failing.start(job());
    await waitFor(() => failing.get('s1')?.status === 'error');
    expect(failing.get('s1')!.error).toBe('ERROR: token *** was refused');
    failing.dispose();

    let release: () => void = () => {};
    const slow = new SonarService({
      workDirectory: path.join(dir, 'work2'),
      run: (_c, options) =>
        new Promise((resolve) => {
          release = () =>
            resolve({
              exitCode: null,
              stdout: '',
              stderr: '',
              output: '',
              truncated: false,
              timedOut: false,
              cancelled: options.signal?.aborted === true,
              durationMs: 1,
            });
          options.signal?.addEventListener('abort', () => release());
        }),
    });
    slow.start(job());
    await waitFor(() => slow.get('s1')?.status === 'running');
    slow.cancel('s1');
    expect(slow.get('s1')!.status).toBe('cancelled');
    slow.dispose();
  });

  it('sends no branch when the server does not take branches, and reads the report id', () => {
    dir = tempDir();
    expect(
      scannerParams(job({ config: { ...CONFIG, branches: false } }), 'w')['sonar.branch.name'],
    ).toBeUndefined();
    fs.writeFileSync(path.join(dir, 'report-task.txt'), 'a=b\r\nceTaskId=AX-12\r\n');
    expect(readTaskId(dir)).toBe('AX-12');
    expect(readTaskId(path.join(dir, 'nada'))).toBeNull();
  });
});
