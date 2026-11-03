// Every changed block in one scroll: seen, undone, commented and opened one by one.
import fs from 'node:fs';
import path from 'node:path';
import { expect, test } from '@playwright/test';
import { makeReviewProject, openChanges } from './review-helpers';
import { createSession, launch, removeDir, tempDir } from './harness';

test('the scroll of every block marks blocks as seen, undoes one, comments and opens the file', async () => {
  test.setTimeout(180_000);
  const userData = tempDir('ac-e2e-all-');
  const repo = makeReviewProject();
  const running = await launch(userData);
  const { page } = running;
  try {
    await createSession(page, 'Projeto', repo);
    const panel = await openChanges(page);
    await panel.getByTestId('all-tab').click();

    const files = page.getByTestId('multidiff-file');
    await expect(files).toHaveCount(2);
    const hunks = page.getByTestId('multidiff-hunk');
    await expect(hunks).toHaveCount(2);
    await expect(page.getByTestId('multidiff-seen')).toHaveText('0 de 2 trechos vistos');
    await expect(files.nth(0)).toContainText('src/soma.ts');
    await expect(hunks.nth(0).locator('.line-add')).toContainText('limite repetido');
    await expect(hunks.nth(0).locator('.line-del')).toContainText('soma3 = 3;');

    // Seen: the block folds away and is counted; it can be shown again.
    await hunks.nth(0).getByTestId('multidiff-accept').click();
    await expect(page.getByTestId('multidiff-seen')).toHaveText('1 de 2 trechos vistos');
    await expect(hunks).toHaveCount(1);
    await page.getByLabel('Mostrar os vistos').check();
    await expect(hunks).toHaveCount(2);
    await expect(hunks.nth(0)).toHaveAttribute('data-seen', 'true');
    await page.getByLabel('Mostrar os vistos').uncheck();

    // A comment on the block goes to the review, and shows under it.
    await hunks.nth(0).getByTestId('multidiff-comment').click();
    const dialog = page.locator('.review-comment-dialog');
    await expect(dialog).toContainText('src/texto.ts, linha 7');
    await dialog.getByTestId('review-comment-text').fill('Volte a ser número.');
    await dialog.getByTestId('review-comment-save').click();
    await expect(panel.getByTestId('review-tab')).toHaveText('Revisão (1)');
    await expect(hunks.nth(0).getByTestId('multidiff-note')).toHaveText('Volte a ser número.');

    // Undo: the file on disk gets its line back, and the block leaves the scroll.
    page.once('dialog', (d) => void d.accept());
    await hunks.nth(0).getByTestId('multidiff-revert').click();
    await expect
      .poll(() => fs.readFileSync(path.join(repo, 'src', 'texto.ts'), 'utf8'))
      .toContain('export const texto7 = 7;');
    await expect(files).toHaveCount(1, { timeout: 15_000 });
    await expect(page.getByTestId('multidiff-seen')).toHaveText('1 de 1 trechos vistos');
    await expect(page.locator('.multidiff-done')).toBeVisible();

    // "Open in the file" goes to the editor, on the line of the block.
    await page.getByLabel('Mostrar os vistos').check();
    await files.nth(0).getByRole('button', { name: 'Abrir no arquivo' }).click();
    const frame = page.frameLocator('[data-testid="diff-frame"]');
    await expect(frame.locator('body[data-reveal-path="src/soma.ts"]')).toHaveCount(1, {
      timeout: 20_000,
    });
  } finally {
    await running.close();
    removeDir(userData);
    removeDir(repo);
  }
});
