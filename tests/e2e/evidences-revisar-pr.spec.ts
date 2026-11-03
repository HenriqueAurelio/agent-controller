// The screens of reviewing a pull request in the app, to attach to the pull request, as in
// `evidences.spec.ts`:
//
//   EVIDENCES=1 npx playwright test --config tests/e2e/playwright.config.ts evidences-revisar-pr.spec.ts
//
// `EVIDENCES_PHASE=antes`, run on a build of the code as it was, takes the "before" of each pair:
// the same pull request in the list, where reviewing it meant opening the site.
import fs from 'node:fs';
import path from 'node:path';
import { expect, test } from '@playwright/test';
import { fakeGitHubEnv, startFakeGitHub } from './fake-github';
import { launch, removeDir, ROOT, tempDir } from './harness';
import { reviewPulls, watchRepo } from './pull-helpers';

const PHASE = process.env.EVIDENCES_PHASE === 'antes' ? 'antes' : 'depois';
const OUT = process.env.EVIDENCES_DIR || path.join(ROOT, 'evidences', 'images');
const FOLDER = 'revisar-pr';

test.skip(process.env.EVIDENCES !== '1', 'só com EVIDENCES=1');

test('evidences: reviewing a pull request in the app', async () => {
  test.setTimeout(120_000);
  const fake = await startFakeGitHub({ 'acme/api': reviewPulls() });
  const userData = tempDir('ac-evid-data-');
  const running = await launch(userData, fakeGitHubEnv(fake));
  const { page } = running;
  const shot = async (name: string) => {
    fs.mkdirSync(path.join(OUT, FOLDER), { recursive: true });
    await page.waitForTimeout(800);
    await page.screenshot({ path: path.join(OUT, FOLDER, `${name}-${PHASE}.png`) });
  };
  try {
    await watchRepo(page);
    await expect(page.getByTestId('pulls-tab-all')).toHaveText('Todos abertos (2)', {
      timeout: 15_000,
    });
    await page.getByTestId('pulls-tab-review').click();
    const row = page.locator('[data-testid="pull-row"][data-key="acme/api#8"]');
    await expect(row).toBeVisible();

    // 1. A pull request that asks for my review: only a link to the site, or its changes and
    // comments right here.
    if (PHASE === 'depois') {
      await row.getByTestId('pull-review-open').click();
      await expect(page.getByTestId('pull-thread')).toBeVisible();
    }
    await shot('01-o-pr-para-revisar');

    // 2. The review written in the app, before it goes: a comment on a line and a summary.
    if (PHASE === 'depois') {
      const review = page.getByTestId('pull-review');
      await review.locator('.multidiff-line[data-new="3"]').hover();
      await review.locator('.multidiff-line[data-new="3"]').getByTestId('pull-review-plus').click();
      await review
        .getByTestId('pull-review-compose')
        .fill('Use uma constante com nome, como PAGE_SIZE.');
      await review.getByTestId('pull-review-add').click();
      await review.getByTestId('pull-review-summary').fill('Quase lá: só o nome do tamanho.');
      await review.locator('.multidiff-line[data-new="3"]').hover();
    }
    await shot('02-revisao-escrita');

    // 3. Published and merged, with no site opened.
    if (PHASE === 'depois') {
      const review = page.getByTestId('pull-review');
      await review.getByTestId('pull-review-changes').click();
      await expect(review.getByTestId('pull-review-notice')).toHaveText(
        'Revisão publicada, pedindo mudanças.',
      );
      await shot('03-publicada');
    }
  } finally {
    await running.close();
    await fake.close();
    removeDir(userData);
  }
});
