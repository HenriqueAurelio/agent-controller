import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { folderFingerprint } from '@core/checks/fingerprint';
import { failureReport } from '@core/checks/report';
import { packageManagerOf, suggestChecks } from '@core/checks/suggest';
import { createAppStore, sanitizeFolderChecks } from '@core/store/appStore';
import { folderKey } from '@core/store/recentFolders';
import {
  CHECK_TIMEOUT,
  CHECKS_LIMIT,
  sanitizeChecks,
  stripAnsi,
  summarizeRun,
  type CheckResult,
  type ChecksRun,
} from '@shared/checks';
import { removeDir, tempDir } from './helpers';

const result = (id: string, outcome: CheckResult['outcome'], extra = {}): CheckResult => ({
  id,
  label: id,
  command: `npm run ${id}`,
  outcome,
  exitCode: outcome === 'passed' ? 0 : outcome === 'failed' ? 1 : null,
  durationMs: 1200,
  output: '',
  truncated: false,
  ...extra,
});
const run = (state: ChecksRun['state'], results: CheckResult[], total = results.length) => ({
  trigger: 'turnEnd' as const,
  state,
  startedAt: 0,
  checks: Array.from({ length: total }, (_, i) => ({
    id: results[i]?.id ?? `c${i}`,
    label: `c${i}`,
    command: 'x',
  })),
  results,
});

describe('sanitizeChecks', () => {
  it('keeps what is valid and fills in what is missing', () => {
    expect(sanitizeChecks([{ command: '  npm test  ' }])).toEqual([
      {
        id: 'npm-test',
        label: 'npm test',
        command: 'npm test',
        timeoutSec: CHECK_TIMEOUT.default,
        onTurnEnd: true,
      },
    ]);
  });

  it('drops commands of more than one line, or with control characters, and junk', () => {
    expect(
      sanitizeChecks([
        { command: 'npm test\nrm -rf /' },
        { command: 'npm\x1b[31m test' },
        { command: '' },
        null,
        'npm test',
        42,
      ]),
    ).toEqual([]);
    expect(sanitizeChecks('npm test')).toEqual([]);
  });

  it('keeps ids unique and timeouts within bounds', () => {
    const checks = sanitizeChecks([
      { id: 'lint', label: 'Lint', command: 'npm run lint', timeoutSec: 1 },
      { id: 'lint', label: 'Lint', command: 'npm run lint:css', timeoutSec: 99_999 },
      { id: 'NÃO VALE', label: 'Testes', command: 'npm test', onTurnEnd: false },
    ]);
    expect(checks.map((c) => c.id)).toEqual(['lint', 'lint-2', 'testes']);
    expect(checks.map((c) => c.timeoutSec)).toEqual([
      CHECK_TIMEOUT.min,
      CHECK_TIMEOUT.max,
      CHECK_TIMEOUT.default,
    ]);
    expect(checks[2]!.onTurnEnd).toBe(false);
  });

  it('keeps at most the limit', () => {
    const many = Array.from({ length: 30 }, (_, i) => ({ command: `echo ${i}` }));
    expect(sanitizeChecks(many)).toHaveLength(CHECKS_LIMIT);
  });
});

describe('summarizeRun', () => {
  it('counts what failed, timed out or could not run as failures', () => {
    expect(
      summarizeRun(
        run('done', [result('a', 'passed'), result('b', 'failed'), result('c', 'timedOut')]),
      ),
    ).toEqual({ state: 'failed', failed: 2, total: 3 });
    expect(summarizeRun(run('done', [result('a', 'passed')]))).toEqual({
      state: 'passed',
      failed: 0,
      total: 1,
    });
  });

  it('follows the run while it is not over', () => {
    expect(summarizeRun(run('running', [result('a', 'failed')], 3)).state).toBe('running');
    expect(summarizeRun(run('queued', [], 2)).state).toBe('queued');
    expect(summarizeRun(run('cancelled', [result('a', 'passed')], 2)).state).toBe('cancelled');
  });
});

describe('stripAnsi', () => {
  it('removes colors, titles and progress rewrites, as a terminal would show the text', () => {
    expect(stripAnsi('\x1b[31mFAIL\x1b[0m src/a.test.ts\r\n')).toBe('FAIL src/a.test.ts\n');
    expect(stripAnsi('\x1b]0;título\x07ok')).toBe('ok');
    expect(stripAnsi('10%\r50%\r100%\nfim')).toBe('100%\nfim');
  });
});

describe('failureReport', () => {
  it('names each failed check, its command, why, and the end of its output', () => {
    const long = Array.from({ length: 100 }, (_, i) => `linha ${i}`).join('\n');
    const report = failureReport(
      run('done', [
        result('lint', 'passed', { output: 'tudo certo' }),
        result('test', 'failed', { output: `\x1b[31m${long}\x1b[0m\n` }),
        result('typecheck', 'timedOut'),
      ]),
      'pt-BR',
    )!;
    expect(report).toContain('As verificações do projeto falharam');
    expect(report).toContain('$ npm run test (código 1)');
    expect(report).toContain('linha 99');
    expect(report).not.toContain('linha 39\n');
    expect(report).not.toContain('\x1b');
    expect(report).toContain('$ npm run typecheck (passou do limite de tempo)\n(sem saída)');
    expect(report).not.toContain('npm run lint');
  });

  it('is in the language of the interface, and absent when nothing failed', () => {
    expect(failureReport(run('done', [result('test', 'failed')]), 'en')).toContain(
      "The project's checks failed",
    );
    expect(failureReport(run('done', [result('test', 'passed')]), 'pt-BR')).toBeNull();
  });
});

describe('suggestChecks', () => {
  let dir: string;
  beforeEach(() => {
    dir = tempDir('ac-suggest-');
  });
  afterEach(() => removeDir(dir));
  const pkg = (scripts: object) =>
    fs.writeFileSync(path.join(dir, 'package.json'), JSON.stringify({ scripts }));

  it('offers lint, typecheck and tests from the scripts, in that order', () => {
    pkg({ test: 'vitest run', build: 'vite build', lint: 'eslint .', typecheck: 'tsc' });
    expect(suggestChecks(dir).map((c) => c.command)).toEqual([
      'npm run lint',
      'npm run typecheck',
      'npm test',
    ]);
  });

  it('uses the package manager of the lock file', () => {
    pkg({ lint: 'eslint .', test: 'jest' });
    fs.writeFileSync(path.join(dir, 'pnpm-lock.yaml'), '');
    expect(packageManagerOf(dir)).toBe('pnpm');
    expect(suggestChecks(dir).map((c) => c.command)).toEqual(['pnpm run lint', 'pnpm run test']);
    fs.rmSync(path.join(dir, 'pnpm-lock.yaml'));
    fs.writeFileSync(path.join(dir, 'yarn.lock'), '');
    expect(suggestChecks(dir).map((c) => c.command)).toEqual(['yarn lint', 'yarn test']);
  });

  it('skips the placeholder test of npm init, and folders without package.json', () => {
    pkg({ test: 'echo "Error: no test specified" && exit 1' });
    expect(suggestChecks(dir)).toEqual([]);
    fs.writeFileSync(path.join(dir, 'package.json'), '{ quebrado');
    expect(suggestChecks(dir)).toEqual([]);
    expect(suggestChecks(path.join(dir, 'nao-existe'))).toEqual([]);
  });
});

describe('folderFingerprint', () => {
  let dir: string;
  const git = (...args: string[]) =>
    execFileSync('git', args, { cwd: dir, stdio: ['ignore', 'pipe', 'pipe'] });
  beforeEach(() => {
    dir = tempDir('ac-fingerprint-');
  });
  afterEach(() => removeDir(dir));

  it('changes when a file changes, appears or is committed, and not otherwise', async () => {
    git('init', '-q');
    git('config', 'user.email', 't@example.com');
    git('config', 'user.name', 'T');
    git('config', 'commit.gpgsign', 'false');
    fs.writeFileSync(path.join(dir, 'a.txt'), 'um\n');
    git('add', '-A');
    git('commit', '-q', '-m', 'base');

    const clean = await folderFingerprint(dir);
    expect(clean).not.toBeNull();
    expect(await folderFingerprint(dir)).toBe(clean);

    fs.writeFileSync(path.join(dir, 'a.txt'), 'dois\n');
    const edited = await folderFingerprint(dir);
    expect(edited).not.toBe(clean);
    fs.writeFileSync(path.join(dir, 'a.txt'), 'dois, de novo e maior\n');
    expect(await folderFingerprint(dir)).not.toBe(edited);

    fs.writeFileSync(path.join(dir, 'novo.txt'), 'x');
    const added = await folderFingerprint(dir);
    git('add', '-A');
    git('commit', '-q', '-m', 'mais');
    const committed = await folderFingerprint(dir);
    expect(committed).not.toBe(added);
    expect(committed).not.toBe(clean);
  });

  it('is null outside a repository: then there is no telling, and the checks run', async () => {
    expect(await folderFingerprint(dir)).toBeNull();
  });
});

describe('checks in the app data', () => {
  let dir: string;
  beforeEach(() => {
    dir = tempDir('ac-store-');
  });
  afterEach(() => removeDir(dir));

  it('are kept per folder, sanitized, and survive a reload', () => {
    const store = createAppStore(dir);
    const data = store.load();
    expect(data.checks).toEqual({});
    data.checks[folderKey('/projetos/api/')] = sanitizeChecks([{ command: 'npm test' }]);
    store.save(data);
    const again = createAppStore(dir).load();
    expect(Object.values(again.checks)).toEqual([sanitizeChecks([{ command: 'npm test' }])]);
  });

  it('drop what is not a list of valid checks', () => {
    expect(
      sanitizeFolderChecks({
        '/a': [{ command: 'npm test' }],
        '/b': [{ command: 'npm\ntest' }],
        '/c': 'npm test',
        '': [{ command: 'npm test' }],
      }),
    ).toEqual({ [folderKey('/a')]: sanitizeChecks([{ command: 'npm test' }]) });
    expect(sanitizeFolderChecks(['x'])).toEqual({});
    expect(sanitizeFolderChecks(null)).toEqual({});
  });
});
