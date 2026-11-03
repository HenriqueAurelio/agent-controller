// A Sonar server of the tests, and a scanner to go with it: the scanner leaves the report the way
// the real one does, and the server answers the API the app reads, with issues per branch.
import fs from 'node:fs';
import http from 'node:http';
import type { AddressInfo } from 'node:net';
import path from 'node:path';
import type { Page } from '@playwright/test';
import { git, makeRepo } from './harness';

export interface FakeSonarIssue {
  file: string;
  line: number;
  severity: string;
  message: string;
  rule: string;
}

export interface FakeSonar {
  url: string;
  projectKey: string;
  /** The token it takes. */
  token: string;
  /** Open issues by branch; a branch not here has none. */
  issues: Record<string, FakeSonarIssue[]>;
  close(): Promise<void>;
}

export async function startFakeSonar(
  projectKey = 'acme:api',
  token = 'tok-e2e',
): Promise<FakeSonar> {
  const fake: FakeSonar = { url: '', projectKey, token, issues: {}, close: async () => {} };
  const server = http.createServer((req, res) => {
    const url = new URL(req.url ?? '/', 'http://x');
    res.setHeader('content-type', 'application/json');
    const auth = req.headers.authorization ?? '';
    if (auth !== `Basic ${Buffer.from(`${fake.token}:`).toString('base64')}`) {
      if (url.pathname === '/api/authentication/validate') {
        res.end(JSON.stringify({ valid: false }));
      } else res.writeHead(401).end('{}');
      return;
    }
    const branch = url.searchParams.get('branch') ?? 'main';
    switch (url.pathname) {
      case '/api/authentication/validate':
        res.end(JSON.stringify({ valid: true }));
        return;
      case '/api/components/show':
        if (url.searchParams.get('component') === fake.projectKey) {
          res.end(JSON.stringify({ component: { key: fake.projectKey } }));
        } else res.writeHead(404).end(JSON.stringify({ errors: [{ msg: 'Component not found' }] }));
        return;
      case '/api/ce/task':
        res.end(JSON.stringify({ task: { id: url.searchParams.get('id'), status: 'SUCCESS' } }));
        return;
      case '/api/qualitygates/project_status': {
        const failing = (fake.issues[branch] ?? []).length > 0;
        res.end(JSON.stringify({ projectStatus: { status: failing ? 'ERROR' : 'OK' } }));
        return;
      }
      case '/api/issues/search': {
        const list = fake.issues[branch] ?? [];
        res.end(
          JSON.stringify({
            paging: { total: list.length },
            issues: list.map((i) => ({
              component: `${fake.projectKey}:${i.file}`,
              line: i.line,
              severity: i.severity,
              message: i.message,
              rule: i.rule,
            })),
          }),
        );
        return;
      }
      default:
        res.writeHead(404).end('{}');
    }
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  fake.url = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  fake.close = () => new Promise((resolve) => server.close(() => resolve()));
  return fake;
}

/**
 * A scanner: reads its parameters from SONAR_SCANNER_JSON_PARAMS, as the real one, refuses a run
 * without the token, and leaves `report-task.txt` in its working folder. Returns its command line.
 */
export function writeFakeScanner(dir: string): string {
  const file = path.join(dir, 'fake-scanner.cjs');
  fs.writeFileSync(
    file,
    [
      "const fs = require('node:fs');",
      "const path = require('node:path');",
      "if (!process.env.SONAR_TOKEN) { console.error('ERROR: no token'); process.exit(2); }",
      'const params = JSON.parse(process.env.SONAR_SCANNER_JSON_PARAMS);',
      "const work = params['sonar.working.directory'];",
      'fs.mkdirSync(work, { recursive: true });',
      "const id = 'task-' + (params['sonar.branch.name'] || 'main');",
      "fs.writeFileSync(path.join(work, 'report-task.txt'), 'ceTaskId=' + id + '\\n');",
      "console.log('INFO: EXECUTION SUCCESS');",
      '',
    ].join('\n'),
  );
  return `node "${file}"`;
}

/** A repository on `feature-a`, with a worktree of it on `feature-b`. */
export async function sonarProject(dir: string) {
  const repo = makeRepo();
  fs.mkdirSync(path.join(repo, 'src'), { recursive: true });
  fs.writeFileSync(path.join(repo, 'src', 'a.ts'), 'export const a = 1;\nconsole.log(a);\n');
  git(repo, 'add', '-A');
  git(repo, 'commit', '-q', '-m', 'base');
  git(repo, 'checkout', '-q', '-b', 'feature-a');
  const copy = path.join(dir, 'copia-b');
  git(repo, 'worktree', 'add', '-q', '-b', 'feature-b', copy);
  return { repo, copy };
}

export async function groupOf(page: Page, name: string, ids: string[]): Promise<string> {
  const group = await page.evaluate(
    ({ name, ids }) => window.api.invoke('groups:create', name, ids),
    { name, ids },
  );
  return group.id;
}
