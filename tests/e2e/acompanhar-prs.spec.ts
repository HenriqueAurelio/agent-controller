import { expect, test } from '@playwright/test';
import { fakeGitHubEnv, startFakeGitHub, type FakePull } from './fake-github';
import { fakeGitLabEnv, startFakeGitLab } from './fake-gitlab';
import { createSession, git, launch, makeRepo, removeDir, tempDir } from './harness';

const LOG =
  '2026-10-31T09:00:00.0000000Z FAIL relatorio.test.ts\n' +
  '2026-10-31T09:00:01Z boom: esperado 20, veio 10\n' +
  '2026-10-31T09:00:01Z ##[error]Process completed with exit code 1.\n' +
  '2026-10-31T09:00:02Z Post job cleanup.\n';

test('the pull requests of the watched repositories, with the pipeline and the fix by the agent', async () => {
  test.setTimeout(120_000);
  const mine: FakePull = {
    number: 7,
    title: 'Paginar o relatório',
    author: 'ana',
    branch: 'paginar',
    reviewers: ['bruno'],
    comments: 1,
    jobs: [
      { name: 'test', conclusion: 'SUCCESS' },
      { name: 'lint', conclusion: 'SUCCESS' },
    ],
  };
  const fake = await startFakeGitHub({ 'acme/api': [mine] });
  fake.available = ['acme/api', 'acme/infra'];
  const userData = tempDir('ac-e2e-prs-');
  const repo = makeRepo();
  git(repo, 'checkout', '-q', '-b', 'paginar');
  git(repo, 'remote', 'add', 'origin', 'https://github.com/acme/api.git');
  const running = await launch(userData, fakeGitHubEnv(fake));
  const { page } = running;
  try {
    await createSession(page, 'Relatório', repo);

    // Nothing is asked of GitHub while no repository is watched.
    await page.getByTestId('pulls-button').click();
    const view = page.getByTestId('pulls-view');
    await expect(view).toBeVisible();
    await expect(page.getByTestId('pulls-settings')).toBeVisible();
    expect(fake.queries).toBe(0);

    // Names pasted with commas; an address and a name that is not one.
    await page
      .getByTestId('pulls-repos-input')
      .fill('acme/api, https://github.com/acme/gone, nada');
    await page.getByTestId('pulls-repos-add').click();
    await expect(page.getByTestId('pulls-repos')).toContainText('acme/api');
    await expect(page.getByTestId('pulls-repos')).toContainText('acme/gone');
    await expect(page.getByTestId('pulls-repos-note')).toContainText('nada');
    await expect(page.getByTestId('pulls-repos-input')).toHaveValue('nada');

    const row = view.locator('[data-testid="pull-row"][data-key="acme/api#7"]');
    await expect(row).toHaveAttribute('data-pipeline', 'success');
    await expect(row).toContainText('Paginar o relatório');
    await expect(row).toContainText('ana · paginar → main');
    await expect(row).toContainText('2 de 2 jobs passaram');
    await expect(page.getByTestId('pulls-repo-error')).toContainText('acme/gone');
    await expect(page.getByTestId('pulls-tab-mine')).toHaveText('Meus (1)');
    await expect(page.getByTestId('pulls-checked')).toContainText('como ana');

    // The list of the repositories the account sees, to tick.
    await page.getByTestId('pulls-pick').click();
    await expect(page.getByTestId('pulls-available')).toContainText('acme/infra');
    await expect(
      page.getByTestId('pulls-available').getByRole('checkbox', { name: 'acme/api' }),
    ).toBeChecked();

    // The pipeline breaks: the row and the button of the list say so.
    mine.sha = 'quebrou';
    mine.jobs[0] = { name: 'test', conclusion: 'FAILURE', log: LOG };
    await expect(row).toHaveAttribute('data-pipeline', 'failure', { timeout: 15_000 });
    await expect(row).toContainText('1 de 2 jobs passaram');
    await expect(page.getByTestId('pulls-badge')).toHaveText('1');

    // The fix goes through the prompt, to the session on the branch, with the end of the log.
    await row.getByTestId('pull-fix').click();
    const dialog = page.getByRole('dialog');
    await expect(dialog).toBeVisible();
    await expect(dialog.getByRole('checkbox', { name: /Relatório/ })).toBeChecked();
    const preview = dialog.getByTestId('prompt-preview');
    await expect(preview).toContainText('acme/api#7: Paginar o relatório');
    await expect(preview).toContainText('boom: esperado 20, veio 10');
    await expect(preview).toContainText('branch paginar');
    await expect(preview).not.toContainText('2026-10-31T09');
    await expect(preview).not.toContainText('Post job cleanup');
  } finally {
    await running.close();
    await fake.close();
    removeDir(userData);
    removeDir(repo);
  }
});

test('the tabs split my pull requests from the ones that ask for my review', async () => {
  test.setTimeout(90_000);
  const fake = await startFakeGitHub({
    'acme/api': [
      { number: 1, title: 'Meu PR', author: 'ana', branch: 'a', jobs: [] },
      {
        number: 2,
        title: 'Do Bruno, para mim',
        author: 'bruno',
        branch: 'b',
        reviewers: ['ana'],
        jobs: [],
      },
      { number: 3, title: 'Da Carla', author: 'carla', branch: 'c', draft: true, jobs: [] },
    ],
  });
  const userData = tempDir('ac-e2e-prs-abas-');
  const running = await launch(userData, fakeGitHubEnv(fake));
  const { page } = running;
  try {
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
    const view = page.getByTestId('pulls-view');
    await expect(view).toBeVisible();
    const rows = view.getByTestId('pull-row');
    await expect(page.getByTestId('pulls-tab-all')).toHaveText('Todos abertos (3)');
    await page.getByTestId('pulls-tab-mine').click();
    await expect(rows).toHaveCount(1);
    await expect(rows).toContainText('Meu PR');
    await page.getByTestId('pulls-tab-review').click();
    await expect(rows).toHaveCount(1);
    await expect(rows).toContainText('pede a sua revisão');
    await page.getByTestId('pulls-tab-all').click();
    await expect(rows).toHaveCount(3);
    await expect(rows.filter({ hasText: 'Da Carla' })).toContainText('rascunho');

    // Esc gives the place back to the terminal.
    await view.press('Escape');
    await expect(view).toBeHidden();
  } finally {
    await running.close();
    await fake.close();
    removeDir(userData);
  }
});

const GITLAB_LOG = [
  '2026-10-31T09:00:00.000000Z 00O section_start:1:step_script\r\u001b[0KExecuting "step_script"',
  '2026-10-31T09:00:01.000000Z 01O $ npm test',
  '2026-10-31T09:00:02.000000Z 01O FAIL estoque.test.ts: esperado 5, veio 3',
  '2026-10-31T09:00:03.000000Z 00O section_end:1:step_script\r\u001b[0K',
  '2026-10-31T09:00:03.000000Z 00O+section_start:2:cleanup_file_variables\r\u001b[0K',
  '2026-10-31T09:00:03.000000Z 00O+Cleaning up project directory and file based variables',
  '2026-10-31T09:00:04.000000Z 00O section_end:2:cleanup_file_variables\r\u001b[0K',
  '2026-10-31T09:00:04.000000Z 00O ERROR: Job failed: exit code 1',
].join('\n');

test('GitLab merge requests next to GitHub pull requests, each service on its own', async () => {
  test.setTimeout(120_000);
  const github = await startFakeGitHub({
    'acme/api': [{ number: 7, title: 'Do GitHub', author: 'ana', branch: 'a', jobs: [] }],
  });
  const gitlab = await startFakeGitLab(
    {
      'time/estoque': [
        {
          iid: 12,
          title: 'Reserva de estoque',
          author: 'henriquesd',
          branch: 'reserva',
          reviewers: ['bruno'],
          jobs: [
            { name: 'test', status: 'FAILED', log: GITLAB_LOG },
            { name: 'lint', status: 'SUCCESS' },
          ],
        },
        {
          iid: 9,
          title: 'Do Bruno',
          author: 'bruno',
          branch: 'b',
          reviewers: ['henriquesd'],
          jobs: [],
        },
      ],
    },
    'henriquesd',
  );
  const userData = tempDir('ac-e2e-prs-gitlab-');
  const repo = makeRepo();
  git(repo, 'checkout', '-q', '-b', 'reserva');
  git(repo, 'remote', 'add', 'origin', 'git@gitlab.com:time/estoque.git');
  const running = await launch(userData, { ...fakeGitHubEnv(github), ...fakeGitLabEnv(gitlab) });
  const { page } = running;
  try {
    await createSession(page, 'Estoque', repo);
    await page.getByTestId('pulls-button').click();
    const view = page.getByTestId('pulls-view');
    // The address of a merge request, pasted, names its project.
    await page
      .getByTestId('pulls-repos-input')
      .fill('acme/api, https://gitlab.com/time/estoque/-/merge_requests/12');
    await page.getByTestId('pulls-repos-add').click();
    await expect(page.getByTestId('pulls-repos')).toContainText('gitlab.com/time/estoque');

    const mr = view.locator('[data-testid="pull-row"][data-key="gitlab.com/time/estoque!12"]');
    await expect(mr).toHaveAttribute('data-pipeline', 'failure');
    await expect(mr).toContainText('!12');
    await expect(mr).toContainText('1 de 2 jobs passaram');
    await expect(view.locator('[data-key="acme/api#7"]')).toBeVisible();
    await expect(page.getByTestId('pulls-checked')).toContainText(
      'como ana (GitHub), henriquesd (GitLab)',
    );
    await expect(page.getByTestId('pulls-tab-mine')).toHaveText('Meus (2)');
    await expect(page.getByTestId('pulls-tab-review')).toHaveText('Para eu revisar (1)');

    // The projects of GitLab are in the list to pick from, next to the repositories of GitHub.
    await page.getByTestId('pulls-pick').click();
    await expect(
      page
        .getByTestId('pulls-available')
        .getByRole('checkbox', { name: 'gitlab.com/time/estoque' }),
    ).toBeChecked();

    // The fix finds the session by its remote over ssh, and the log comes without the runner.
    await mr.getByTestId('pull-fix').click();
    const dialog = page.getByRole('dialog');
    await expect(dialog.getByRole('checkbox', { name: /Estoque/ })).toBeChecked();
    const preview = dialog.getByTestId('prompt-preview');
    await expect(preview).toContainText('gitlab.com/time/estoque!12: Reserva de estoque');
    await expect(preview).toContainText('FAIL estoque.test.ts: esperado 5, veio 3');
    await expect(preview).toContainText('ERROR: Job failed: exit code 1');
    await expect(preview).not.toContainText('Cleaning up');
    await expect(preview).not.toContainText('section_');
    await dialog.press('Escape');

    // GitLab goes away: GitHub still answers, and the merge requests stay as they were.
    await gitlab.close();
    await expect(page.locator('[data-testid="pulls-status"][data-forge="gitlab"]')).toContainText(
      'Não foi possível consultar o GitLab',
      { timeout: 15_000 },
    );
    await expect(mr).toBeVisible();
    await expect(view.locator('[data-key="acme/api#7"]')).toBeVisible();
  } finally {
    await running.close();
    await github.close();
    await gitlab.close();
    removeDir(userData);
    removeDir(repo);
  }
});
