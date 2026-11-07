// The screens of the review of pull requests, to attach to the pull request, as in
// `evidences.spec.ts`:
//
//   EVIDENCES=1 npx playwright test --config tests/e2e/playwright.config.ts evidences-revisao-de-prs.spec.ts
//
// `EVIDENCES_PHASE=antes`, run on a build of the code as it was, takes the "before" of each pair:
// the merge that only squashes, and a guarded pull request whose new comment reaches no agent.
import fs from 'node:fs';
import path from 'node:path';
import { expect, test } from '@playwright/test';
import { fakeGitHubEnv, startFakeGitHub, type FakePull } from './fake-github';
import { createSession, git, launch, makeRepo, removeDir, ROOT, tempDir } from './harness';
import { reviewPulls, watchRepo } from './pull-helpers';

const PHASE = process.env.EVIDENCES_PHASE === 'antes' ? 'antes' : 'depois';
const AFTER = PHASE === 'depois';
const OUT = process.env.EVIDENCES_DIR || path.join(ROOT, 'evidences', 'images');
const FOLDER = 'revisao-de-prs';

test.skip(process.env.EVIDENCES !== '1', 'só com EVIDENCES=1');

test('evidences: the merge method, and the comments of a guarded pull request', async () => {
  test.setTimeout(150_000);
  const fake = await startFakeGitHub({ 'acme/api': reviewPulls() });
  const userData = tempDir('ac-evid-data-');
  const repo = makeRepo();
  git(repo, 'checkout', '-q', '-b', 'pagina-20');
  git(repo, 'remote', 'add', 'origin', 'https://github.com/acme/api.git');
  const running = await launch(userData, fakeGitHubEnv(fake));
  const { page } = running;
  const shot = async (name: string) => {
    fs.mkdirSync(path.join(OUT, FOLDER), { recursive: true });
    await page.waitForTimeout(800);
    await page.screenshot({ path: path.join(OUT, FOLDER, `${name}-${PHASE}.png`) });
  };
  try {
    await createSession(page, 'pagina-20', repo);
    await watchRepo(page);
    await expect(page.getByTestId('pulls-tab-all')).toHaveText('Todos abertos (2)', {
      timeout: 15_000,
    });
    await page.getByTestId('pulls-tab-all').click();

    // 1. The review of a pull request, at its footer: how the merge is done.
    const row = page.locator('[data-testid="pull-row"][data-key="acme/api#8"]');
    await row.getByTestId('pull-review-open').click();
    const review = page.getByTestId('pull-review');
    await expect(review.getByTestId('pull-review-merge-state')).toHaveText('pronto para o merge');
    if (AFTER) await review.getByTestId('pull-review-merge-method').selectOption('rebase');
    await shot('01-merge');
    await review.getByTestId('pull-review-back').click();

    // 2. A guarded pull request gets a comment from someone else: the open conversations go to
    // the queue of the session of its branch, or nowhere.
    const pull = fake.repos['acme/api']!.find((p) => p.number === 8) as FakePull;
    pull.author = 'ana';
    await expect(row.getByTestId('pull-guard')).toBeVisible({ timeout: 15_000 });
    await row.getByTestId('pull-guard').click();
    pull.comments = 2;
    pull.reviewComments = [
      ...(pull.reviewComments ?? []),
      {
        id: 9,
        path: 'src/pagina.ts',
        line: 3,
        side: 'RIGHT',
        body: 'Use uma constante com nome no lugar do 20.',
        user: { login: 'bruno' },
      },
    ];
    // Before, nothing comes of it: a few looks of the services later, the queue is still empty.
    if (!AFTER) await page.waitForTimeout(20_000);
    await page.keyboard.press('Escape');
    await page.keyboard.press('Control+Shift+P');
    await page
      .getByRole('dialog', { name: 'Paleta de comandos' })
      .getByRole('option', { name: /^Abrir a fila de/ })
      .click();
    const queue = page.getByRole('dialog', { name: /^Fila de/ });
    await expect(queue).toBeVisible();
    if (AFTER)
      await expect(queue).toContainText('Chegaram comentários de revisão', { timeout: 30_000 });
    await shot('02-fila-depois-do-comentario');
  } finally {
    await running.close();
    await fake.close();
    removeDir(userData);
    removeDir(repo);
  }
});
