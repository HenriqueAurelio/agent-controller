import fs from 'node:fs';
import path from 'node:path';
import { expect, test, type Page } from '@playwright/test';
import {
  createSession,
  launch,
  makeRepo,
  removeDir,
  screenText,
  setTitle,
  tempDir,
} from './harness';

const row = (page: Page, id: string) => page.locator(`.session-item[data-session-id="${id}"]`);

/** A line the shell prints as `marker`, without the typed command containing it. */
const echoes = (n: number) =>
  process.platform === 'win32' ? `echo ^>chegou${n}^<` : `echo chegou"${n}"`;
const marker = (n: number) => (process.platform === 'win32' ? `>chegou${n}<` : `chegou${n}`);

/** The shell plays an agent that has finished a turn and waits at its prompt. */
async function idle(page: Page, id: string) {
  await row(page, id).click();
  await setTitle(page, '◐ x');
  await expect(row(page, id)).toHaveAttribute('data-state', 'trabalhando', { timeout: 15_000 });
  await setTitle(page, '✳ pronto');
  await expect(row(page, id)).toHaveAttribute('data-state', 'terminou', { timeout: 15_000 });
}

const typed = async (page: Page, id: string) => (await screenText(page, id)).replace(/\r?\n/g, '');

test('a plan, an implementation and a review pass the work on with approval, and stop at the limit', async () => {
  test.setTimeout(240_000);
  const userData = tempDir('ac-e2e-flow-');
  const repo = makeRepo();
  const running = await launch(userData);
  const { page } = running;
  page.on('dialog', (dialog) => void dialog.accept());
  try {
    const plan = await createSession(page, 'Planejar', repo);
    const build = await createSession(page, 'Implementar', repo);
    const review = await createSession(page, 'Revisar', repo);
    for (const id of [plan, build, review]) await idle(page, id);
    const groupId = await page.evaluate(
      async (ids) => (await window.api.invoke('groups:create', 'Fluxo', ids)).id,
      [plan, build, review],
    );
    // The photo of the folder as the session found it runs in the background.
    await page.waitForTimeout(3000);

    // The editor: the ready-made model fills three rules; the round limit of the cycle is one.
    const header = page.locator(`.session-group[data-group-id="${groupId}"] .group-header`);
    await header.hover();
    await page.getByTestId('flow-button').click();
    const dialog = page.getByRole('dialog', { name: 'Fluxo de “Fluxo”' });
    await dialog.getByTestId('flow-template-plan').click();
    const rules = dialog.getByTestId('flow-rule');
    await expect(rules).toHaveCount(3);
    await expect(rules.nth(0).getByTestId('flow-when')).toHaveValue('fileWritten');
    await expect(rules.nth(1).getByTestId('flow-confirm')).toBeChecked();
    for (let i = 0; i < 3; i++) {
      await rules
        .nth(i)
        .getByTestId('flow-prompt')
        .fill(echoes(i + 1));
    }
    await rules.nth(1).getByTestId('flow-rounds').fill('1');
    await rules.nth(2).getByTestId('flow-rounds').fill('1');
    await dialog.getByTestId('flow-save').click();
    await expect(dialog.getByTestId('flow-status')).toContainText('O fluxo está ligado');
    await expect(dialog.getByTestId('flow-files')).toContainText('revisao.md');
    await dialog.getByRole('button', { name: 'Fechar' }).click();
    await expect(row(page, plan).getByTestId('flow-badge')).toBeVisible();

    // 1. The planner writes its plan: the send waits for a click, on the row of the planner.
    const handoff = (id: string) => path.join(userData, 'handoffs', id);
    fs.mkdirSync(handoff(plan), { recursive: true });
    fs.writeFileSync(path.join(handoff(plan), 'revisao.md'), '1. mude editado.ts\n');
    const pending = row(page, plan).getByTestId('flow-pending-badge');
    await expect(pending).toBeVisible({ timeout: 30_000 });
    await expect(pending).toHaveAttribute('aria-label', 'Pronto para mandar a “Implementar” ✓');
    expect(await typed(page, build)).not.toContain(marker(1));
    await pending.click();
    await expect.poll(() => typed(page, build), { timeout: 30_000 }).toContain(marker(1));

    // 2. The implementation ends a turn: the send to the reviewer is approved in the dialog.
    await row(page, build).click();
    await setTitle(page, '◐ turno');
    await expect(row(page, build)).toHaveAttribute('data-state', 'trabalhando', {
      timeout: 15_000,
    });
    fs.writeFileSync(path.join(repo, 'turno1.ts'), 'export const turno = 1;\n');
    await setTitle(page, '✳ pronto');
    await expect(row(page, build).getByTestId('flow-pending-badge')).toBeVisible({
      timeout: 30_000,
    });
    await header.hover();
    await page.getByTestId('flow-button').click();
    await expect(dialog.getByTestId('flow-pending')).toContainText('Implementar → Revisar');
    await dialog.getByTestId('flow-approve').click();
    await expect(dialog.getByTestId('flow-pending')).toHaveCount(0);
    await dialog.getByRole('button', { name: 'Fechar' }).click();
    await expect.poll(() => typed(page, review), { timeout: 30_000 }).toContain(marker(2));

    // 3. The reviewer writes its file back: the fix goes to the implementation.
    fs.mkdirSync(handoff(review), { recursive: true });
    fs.writeFileSync(path.join(handoff(review), 'revisao.md'), '- turno1.ts:1 — sem teste\n');
    await expect(row(page, review).getByTestId('flow-pending-badge')).toBeVisible({
      timeout: 30_000,
    });
    await row(page, review).getByTestId('flow-pending-badge').click();
    await expect.poll(() => typed(page, build), { timeout: 30_000 }).toContain(marker(3));

    // 4. Another turn would be a second round of a cycle with a limit of one: the flow stops.
    await row(page, build).click();
    await setTitle(page, '◐ turno 2');
    await expect(row(page, build)).toHaveAttribute('data-state', 'trabalhando', {
      timeout: 15_000,
    });
    await setTitle(page, '✳ pronto');
    await expect(row(page, build)).toHaveAttribute('data-state', 'terminou', { timeout: 15_000 });
    const pause = page.getByTestId('flow-pause-button');
    await expect(pause).toHaveAttribute('aria-label', 'Retomar o fluxo de “Fluxo”', {
      timeout: 30_000,
    });
    await header.hover();
    await page.getByTestId('flow-button').click();
    await expect(dialog.getByTestId('flow-status')).toContainText('limite de voltas');
    await expect(dialog.getByTestId('flow-history')).toContainText('Parou o fluxo');
    await dialog.getByRole('button', { name: 'Fechar' }).click();
    await expect(row(page, build).getByTestId('flow-pending-badge')).toHaveCount(0);

    // The user resumes the flow from the header of the group.
    await pause.click();
    await expect(pause).toHaveAttribute('aria-label', 'Parar o fluxo de “Fluxo”');
  } finally {
    await running.close();
    removeDir(userData);
    removeDir(repo);
  }
});
