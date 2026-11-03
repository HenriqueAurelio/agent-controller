// Reviewing a pull request inside the app: its changes and comments, a review published with line
// comments, and the merge (ADR 0028).
import { expect, test } from '@playwright/test';
import { fakeGitHubEnv, startFakeGitHub } from './fake-github';
import { launch, removeDir, tempDir } from './harness';
import { reviewPulls, watchRepo } from './pull-helpers';

test('a pull request is reviewed in the app: line comments, a verdict and the merge', async () => {
  test.setTimeout(120_000);
  const fake = await startFakeGitHub({ 'acme/api': reviewPulls() });
  const userData = tempDir('ac-e2e-review-pr-');
  const running = await launch(userData, fakeGitHubEnv(fake));
  const { page } = running;
  try {
    await watchRepo(page);
    await expect(page.getByTestId('pulls-tab-all')).toHaveText('Todos abertos (2)', {
      timeout: 15_000,
    });
    await page.getByTestId('pulls-tab-all').click();
    const row = page.locator('[data-testid="pull-row"][data-key="acme/api#8"]');
    await expect(row).toBeVisible({ timeout: 15_000 });
    await row.getByTestId('pull-review-open').click();

    // The changes and the comment already on them.
    const review = page.getByTestId('pull-review');
    await expect(review).toBeVisible();
    await expect(review.getByTestId('pull-review-file')).toHaveCount(2);
    await expect(review.locator('.line-add')).toHaveCount(2);
    await expect(review.getByTestId('pull-thread')).toContainText('carla Por que 20?');
    await expect(review).toContainText('Sem diff para mostrar');
    await expect(review.getByTestId('pull-review-merge-state')).toHaveText('pronto para o merge');

    // A comment on an added line stays as a draft until the review goes.
    await review.locator('.multidiff-line[data-new="3"]').hover();
    await review.locator('.multidiff-line[data-new="3"]').getByTestId('pull-review-plus').click();
    await review.getByTestId('pull-review-compose').fill('Use uma constante com nome.');
    await review.getByTestId('pull-review-add').click();
    await expect(review.getByTestId('pull-draft')).toContainText('Use uma constante com nome.');
    await expect(review.getByTestId('pull-review-count')).toHaveText('1 comentário numa linha');
    expect(fake.writes).toEqual([]);

    // Request changes: one review, against the commit that was read.
    await review.getByTestId('pull-review-summary').fill('Quase lá.');
    await review.getByTestId('pull-review-changes').click();
    await expect(review.getByTestId('pull-review-notice')).toHaveText(
      'Revisão publicada, pedindo mudanças.',
    );
    expect(fake.writes).toEqual([
      {
        method: 'POST',
        path: '/repos/acme/api/pulls/8/reviews',
        body: {
          commit_id: 'cabeca-8',
          event: 'REQUEST_CHANGES',
          body: 'Quase lá.',
          comments: [
            { path: 'src/pagina.ts', line: 3, side: 'RIGHT', body: 'Use uma constante com nome.' },
          ],
        },
      },
    ]);
    await expect(review.getByTestId('pull-draft')).toHaveCount(0);

    // The merge asks first, squashes and deletes the branch.
    page.once('dialog', (d) => void d.accept());
    await review.getByTestId('pull-review-merge').click();
    await expect(review.getByTestId('pull-review-notice')).toHaveText('Merge feito.');
    expect(fake.writes.slice(1)).toEqual([
      { method: 'PUT', path: '/repos/acme/api/pulls/8/merge', body: { merge_method: 'squash' } },
      { method: 'DELETE', path: '/repos/acme/api/git/refs/heads/pagina-20', body: null },
    ]);

    // Back to the list: the merged one is gone; my own cannot be approved by me.
    await review.getByTestId('pull-review-back').click();
    await expect(row).toHaveCount(0, { timeout: 15_000 });
    await page
      .locator('[data-testid="pull-row"][data-key="acme/api#7"]')
      .getByTestId('pull-review-open')
      .click();
    await expect(page.getByTestId('pull-review-approve')).toBeDisabled();
    await expect(page.getByTestId('pull-review-approve')).toHaveAttribute(
      'title',
      'O serviço não deixa aprovar nem pedir mudanças no próprio PR.',
    );
  } finally {
    await running.close();
    await fake.close();
    removeDir(userData);
  }
});
