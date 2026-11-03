// Helpers of the tests of the review: a project with changes, and the panel opened on them.
import fs from 'node:fs';
import path from 'node:path';
import { expect, type FrameLocator, type Locator, type Page } from '@playwright/test';
import { git, makeRepo } from './harness';

export const lines = (name: string, count = 20) =>
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
export const lineOf = (frame: FrameLocator, text: string) =>
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
