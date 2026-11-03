// Comments on lines of the diff, gathered in the Review tab and sent to the agent as one prompt.
import fs from 'node:fs';
import path from 'node:path';
import { expect, test } from '@playwright/test';
import { createSession, launch, removeDir, screenText, tempDir } from './harness';
import {
  clickPlus,
  lineOf,
  lines,
  makeReviewProject,
  openChanges,
  openFile,
  writeComment,
} from './review-helpers';

test('comments on lines of the diff go to the agent together, as one prompt', async () => {
  test.setTimeout(180_000);
  const userData = tempDir('ac-e2e-review-');
  const repo = makeReviewProject();
  const running = await launch(userData);
  const { page } = running;
  try {
    const id = await createSession(page, 'Projeto', repo);
    const panel = await openChanges(page);
    const frame = page.frameLocator('[data-testid="diff-frame"]');

    // The cursor on a changed line and "Comment": the comment shows under the line.
    await openFile(panel, frame, 'src/soma.ts');
    await lineOf(frame, 'limite repetido').click();
    await panel.getByTestId('diff-comment').click();
    const dialog = page.locator('.review-comment-dialog');
    await expect(dialog).toContainText('src/soma.ts, linha 3');
    await expect(dialog.locator('.review-snippet')).toHaveText(
      'export const soma3 = 3 * 1000; // limite repetido',
    );
    await writeComment(page, 'Use a constante MAX em vez de repetir o limite.');
    await expect(frame.locator('body[data-comments="1"]')).toHaveCount(1);
    await expect(frame.locator('.comment-zone')).toContainText('Use a constante MAX');
    await expect(panel.getByTestId('review-tab')).toHaveText('Revisão (1)');

    // The + of the margin, on another file.
    await openFile(panel, frame, 'src/texto.ts');
    await clickPlus(page, frame, "'sete'");
    await expect(dialog).toContainText('src/texto.ts, linha 7');
    await writeComment(page, 'Volte a ser número.');
    await expect(panel.getByTestId('review-tab')).toHaveText('Revisão (2)');

    // A click on the comment opens it to edit.
    // The zone sits under the layer of the lines; Monaco finds it by where the click lands.
    await frame.locator('.comment-zone').click({ force: true });
    await expect(dialog).toContainText('Comentário em src/texto.ts, linha 7');
    await writeComment(page, 'Volte a ser o número 7.');
    await expect(frame.locator('.comment-zone')).toContainText('o número 7');

    // The Review tab lists them by file and opens each on its line.
    await panel.getByTestId('review-tab').click();
    const rows = page.getByTestId('review-row');
    await expect(rows).toHaveCount(2);
    await expect(page.getByTestId('review-file').nth(0)).toContainText('src/soma.ts');
    await rows.nth(0).getByTestId('review-open').click();
    await expect(frame.locator('body[data-reveal-line="3"]')).toHaveCount(1, { timeout: 20_000 });
    await expect(frame.locator('body[data-reveal-path="src/soma.ts"]')).toHaveCount(1);

    // Both go in one prompt, each with its place and its code.
    await page.getByTestId('review-send').click();
    const send = page.getByRole('dialog', { name: 'Enviar prompt' });
    await expect(send.getByLabel('Texto a enviar')).toContainText('{revisao}');
    const preview = send.getByTestId('prompt-preview');
    await expect(preview).toContainText('1. src/soma.ts:3');
    await expect(preview).toContainText('2. src/texto.ts:7');
    await expect(preview).toContainText('// limite repetido');
    await send.getByRole('button', { name: 'Enviar', exact: true }).click();
    await expect(send).toBeHidden();
    await expect
      .poll(async () => (await screenText(page, id)).replace(/\s+/g, ''), { timeout: 15_000 })
      .toContain('src/texto.ts:7');

    // What was sent leaves the review.
    await expect(rows).toHaveCount(0);
    await expect(panel.getByTestId('review-tab')).toHaveText('Revisão');
  } finally {
    await running.close();
    removeDir(userData);
    removeDir(repo);
  }
});

test('the review survives closing the app, and a comment whose lines changed says so', async () => {
  test.setTimeout(180_000);
  const userData = tempDir('ac-e2e-review-');
  const repo = makeReviewProject();
  let running = await launch(userData);
  try {
    const id = await createSession(running.page, 'Projeto', repo);
    await running.page.evaluate(
      (sid) =>
        window.api.invoke('review:add', sid, {
          file: 'src/soma.ts',
          startLine: 3,
          endLine: 3,
          snippet: 'export const soma3 = 3 * 1000; // limite repetido',
          text: 'Use a constante.',
        }),
      id,
    );
    await running.close();

    // The agent changed the line meanwhile.
    fs.writeFileSync(path.join(repo, 'src', 'soma.ts'), lines('soma').replace('soma3', 'somaTres'));
    running = await launch(userData);
    const { page } = running;
    await page.locator('.session-item').first().click();
    const panel = await openChanges(page);
    await expect(panel.getByTestId('review-tab')).toHaveText('Revisão (1)');
    const frame = page.frameLocator('[data-testid="diff-frame"]');
    await openFile(panel, frame, 'src/soma.ts');
    await expect(frame.locator('body[data-stale-comments="1"]')).toHaveCount(1);
    await expect(frame.locator('.comment-zone.stale')).toBeVisible();
  } finally {
    await running.close();
    removeDir(userData);
    removeDir(repo);
  }
});
