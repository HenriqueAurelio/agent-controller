// Comments on lines of the diff, gathered in the Review tab and sent to the agent as one prompt.
import fs from 'node:fs';
import path from 'node:path';
import { expect, test, type FrameLocator, type Locator, type Page } from '@playwright/test';
import { createSession, git, launch, makeRepo, removeDir, screenText, tempDir } from './harness';

const lines = (name: string, count = 20) =>
  Array.from({ length: count }, (_, i) => `export const ${name}${i + 1} = ${i + 1};`).join('\n');

/** A repository with two committed files, both changed by "the agent". */
export function makeReviewProject(): string {
  const repo = makeRepo();
  fs.mkdirSync(path.join(repo, 'src'), { recursive: true });
  fs.writeFileSync(path.join(repo, 'src', 'soma.ts'), lines('soma'));
  fs.writeFileSync(path.join(repo, 'src', 'texto.ts'), lines('texto'));
  git(repo, 'add', '-A');
  git(repo, 'commit', '-q', '-m', 'projeto');
  fs.writeFileSync(
    path.join(repo, 'src', 'soma.ts'),
    lines('soma').replace('soma3 = 3;', 'soma3 = 3 * 1000; // limite repetido'),
  );
  fs.writeFileSync(
    path.join(repo, 'src', 'texto.ts'),
    lines('texto').replace('texto7 = 7;', "texto7 = 'sete';"),
  );
  return repo;
}

export async function openChanges(page: Page): Promise<Locator> {
  await page.keyboard.press('Control+Shift+P');
  await page
    .getByRole('dialog', { name: 'Paleta de comandos' })
    .getByRole('option', { name: /^Ver mudanças/ })
    .click();
  const panel = page.locator('.changes-panel');
  await expect(panel).toBeVisible();
  return panel;
}

export async function openFile(panel: Locator, frame: FrameLocator, name: string) {
  await panel.locator(`.change-item[data-path="${name}"]`).click();
  await frame.locator(`body[data-path="${name}"]`).waitFor();
}

/** The line of the working-tree side that holds this text. */
const lineOf = (frame: FrameLocator, text: string) =>
  frame.locator('.editor.modified .view-line', { hasText: text }).first();

/** Clicks the + of the margin, at the height of the line that holds this text. */
export async function clickPlus(page: Page, frame: FrameLocator, text: string) {
  const line = await lineOf(frame, text).boundingBox();
  const margin = await frame.locator('.editor.modified .glyph-margin').first().boundingBox();
  if (!line || !margin) throw new Error(`a linha de "${text}" não está na tela`);
  const x = margin.x + margin.width / 2;
  const y = line.y + line.height / 2;
  await page.mouse.move(x, y);
  await expect(frame.locator('.comment-add')).toHaveCount(1);
  await page.mouse.click(x, y);
}

export async function writeComment(page: Page, text: string) {
  const dialog = page.locator('.review-comment-dialog');
  await expect(dialog).toBeVisible();
  await dialog.getByTestId('review-comment-text').fill(text);
  await dialog.getByTestId('review-comment-save').click();
  await expect(dialog).toBeHidden();
}

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
