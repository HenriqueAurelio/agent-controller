// The guard of a pull request: its failed pipeline goes to the agent of its branch by itself.
import { expect, test } from '@playwright/test';
import { fakeGitHubEnv, startFakeGitHub, type FakePull } from './fake-github';
import { createSession, git, launch, makeRepo, removeDir, setTitle, tempDir } from './harness';

const LOG =
  '2026-11-03T09:00:00Z FAIL relatorio.test.ts\n' +
  '2026-11-03T09:00:01Z boom: esperado 20, veio 10\n' +
  '2026-11-03T09:00:01Z ##[error]Process completed with exit code 1.\n';

test('a guarded pull request sends its failed pipeline to the session of its branch, and stops after the limit', async () => {
  test.setTimeout(150_000);
  const mine: FakePull = {
    number: 7,
    title: 'Paginar o relatório',
    author: 'ana',
    branch: 'paginar',
    sha: 'verde',
    jobs: [{ name: 'test', conclusion: 'SUCCESS' }],
  };
  const fake = await startFakeGitHub({ 'acme/api': [mine] });
  const userData = tempDir('ac-e2e-guard-');
  const repo = makeRepo();
  git(repo, 'checkout', '-q', '-b', 'paginar');
  git(repo, 'remote', 'add', 'origin', 'https://github.com/acme/api.git');
  const running = await launch(userData, fakeGitHubEnv(fake));
  const { page } = running;
  try {
    const id = await createSession(page, 'Relatório', repo);
    // The agent is in the middle of a turn: what the guard sends waits in the queue for its end.
    // An agent at its prompt would get it at once.
    await setTitle(page, '◐ trabalhando');
    await expect(page.locator(`.session-item[data-session-id="${id}"]`)).toHaveAttribute(
      'data-state',
      'trabalhando',
      { timeout: 15_000 },
    );
    await page.evaluate(() =>
      window.api.invoke('prefs:set', {
        pulls: {
          repos: ['acme/api'],
          account: '',
          notifyFailed: true,
          notifyComments: true,
          notifyReview: true,
        },
      }),
    );
    await page.keyboard.press('Control+Shift+U');
    const row = page.locator('[data-testid="pull-row"][data-key="acme/api#7"]');
    await expect(row).toHaveAttribute('data-pipeline', 'success', { timeout: 15_000 });

    // Turned on, it watches; the choice is saved with the preferences.
    await row.getByTestId('pull-guard').click();
    await expect(row.getByTestId('pull-guard')).toHaveAttribute('aria-pressed', 'true');
    await expect(row.getByTestId('pull-guard-status')).toHaveText('vigiando o pipeline');
    await expect
      .poll(async () => (await page.evaluate(() => window.api.invoke('prefs:get'))).pulls.guarded)
      .toEqual(['acme/api#7']);

    // The pipeline breaks: the fix reaches the session of the branch with the end of the log,
    // with no click.
    const breakAs = (sha: string) => {
      mine.sha = sha;
      mine.jobs = [{ name: 'test', conclusion: 'FAILURE', log: LOG }];
    };
    breakAs('quebrou-1');
    await expect(row.getByTestId('pull-guard-status')).toHaveText('mandado ao agente (1 de 3)', {
      timeout: 15_000,
    });
    // It waits in the queue of the session for the end of the turn, with the end of the log.
    const queued = () =>
      page.evaluate((sid) => window.api.invoke('queue:get', sid), id).then((q) => q.items);
    await expect.poll(async () => (await queued()).length, { timeout: 15_000 }).toBe(1);
    const [item] = await queued();
    expect(item!.condition).toBe('turnEnd');
    expect(item!.values.pr).toContain('acme/api#7: Paginar o relatório');
    expect(item!.values.pipeline).toContain('boom: esperado 20, veio 10');
    expect(item!.text).toContain('{pipeline}');

    // Two more failures go; the fourth makes it stop.
    for (const [n, label] of [
      [2, 'mandado ao agente (2 de 3)'],
      [3, 'mandado ao agente (3 de 3)'],
      [4, 'parou depois de 3 tentativas'],
    ] as const) {
      breakAs(`quebrou-${n}`);
      await expect(row.getByTestId('pull-guard-status')).toHaveText(label, { timeout: 15_000 });
    }
    // Each failure took the place of the one before in the queue: the agent gets the latest only.
    await expect.poll(async () => (await queued()).length).toBe(1);

    // Green again: the count starts over.
    mine.sha = 'verde-de-novo';
    mine.jobs = [{ name: 'test', conclusion: 'SUCCESS' }];
    await expect(row.getByTestId('pull-guard-status')).toHaveText('vigiando o pipeline', {
      timeout: 15_000,
    });

    // Off: nothing more is sent.
    await row.getByTestId('pull-guard').click();
    await expect(row.getByTestId('pull-guard-status')).toHaveCount(0);
  } finally {
    await running.close();
    await fake.close();
    removeDir(userData);
    removeDir(repo);
  }
});
