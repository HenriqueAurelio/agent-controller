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

/** One turn of the agent that writes a file: a spinner in the title, the file, then idle. */
async function turn(page: Page, id: string, repo: string, n: number) {
  await setTitle(page, `◐ turno ${n}`);
  await expect(row(page, id)).toHaveAttribute('data-state', 'trabalhando', { timeout: 15_000 });
  fs.writeFileSync(path.join(repo, `turno${n}.ts`), `export const turno = ${n};\n`);
  await setTitle(page, '✳ pronto');
  await expect(row(page, id)).toHaveAttribute('data-state', 'terminou', { timeout: 15_000 });
}

const REVIEW = [
  '- turno1.ts:1 — Falta um comentario sobre o valor de turno.',
  '- turno1.ts — Nao ha teste para este arquivo.',
  '- Nota geral: nomes em portugues e ingles misturados.',
  '- editado.ts:1 — Valor magico sem constante nomeada.',
].join('\n');

test('a reviewer reads the diff of a turn, writes observations and two go back to the agent', async () => {
  test.setTimeout(180_000);
  const userData = tempDir('ac-e2e-reviewer-');
  const repo = makeRepo();
  const running = await launch(userData);
  const { page } = running;
  page.on('dialog', (dialog) => void dialog.accept());
  try {
    const main = await createSession(page, 'Principal', repo);
    // The second shell plays the reviewer: at its prompt, as an agent between turns would be.
    const reviewer = await createSession(page, 'Revisor', repo);
    await setTitle(page, '◐ espera');
    await expect(row(page, reviewer)).toHaveAttribute('data-state', 'trabalhando', {
      timeout: 15_000,
    });
    await setTitle(page, '✳ pronto');
    await expect(row(page, reviewer)).toHaveAttribute('data-state', 'terminou', {
      timeout: 15_000,
    });
    await row(page, main).click();
    // The photo of the folder as the session found it runs in the background.
    await page.waitForTimeout(3000);

    await page.getByTestId('reviewer-button').click();
    const dialog = page.getByRole('dialog', { name: 'Revisor de “Principal”' });
    await dialog.getByRole('radio', { name: 'Uma sessão que já existe' }).check();
    await dialog
      .getByLabel('Sessão', { exact: true })
      .selectOption({ label: 'Revisor · Claude Code' });
    await dialog.getByTestId('reviewer-enable').click();
    await expect(dialog.getByTestId('reviewer-current')).toContainText('Revisor: Revisor');
    await dialog.getByRole('button', { name: 'Fechar' }).click();
    await expect(row(page, reviewer).getByTestId('review-badge-reviewer')).toBeVisible();

    // A turn that changes files: the reviewer is asked, with the diff in a file.
    await turn(page, main, repo, 1);
    const handoff = path.join(userData, 'handoffs', main);
    await expect
      .poll(() => fs.existsSync(path.join(handoff, 'diff.patch')), { timeout: 30_000 })
      .toBe(true);
    expect(fs.readFileSync(path.join(handoff, 'diff.patch'), 'utf8')).toContain('turno1.ts');
    await expect(row(page, main).getByTestId('review-badge')).toBeVisible();
    // The request is on the reviewer's terminal, with the path of the file and no diff in it.
    await expect
      .poll(async () => (await screenText(page, reviewer)).replace(/\r?\n/g, ''), {
        timeout: 30_000,
      })
      .toContain('diff.patch');
    expect(await screenText(page, reviewer)).not.toContain('export const turno = 1');

    // The reviewer writes its file; the main session says the review is ready.
    fs.writeFileSync(path.join(handoff, 'revisao.md'), REVIEW);
    const button = page.getByTestId('reviewer-button');
    await expect(button).toHaveText('Revisão pronta (4)', { timeout: 30_000 });
    await expect(row(page, main).getByTestId('review-badge')).toContainText('4');

    await button.click();
    const review = page.getByRole('dialog', { name: 'Revisor de “Principal”' });
    await expect(review.getByTestId('review-item')).toHaveCount(4);
    await review.getByTestId('review-item').nth(0).check();
    await review.getByTestId('review-item').nth(3).check();
    await review.getByTestId('reviewer-return').click();

    // The dialog of sending opens with the two marked observations, and only those.
    const send = page.getByRole('dialog', { name: 'Enviar prompt' });
    const text = send.getByLabel('Texto a enviar');
    await expect(text).toHaveValue(/turno1\.ts:1 — Falta um comentario/);
    await expect(text).toHaveValue(/editado\.ts:1 — Valor magico/);
    await expect(text).not.toHaveValue(/Nao ha teste/);
    await send.getByRole('button', { name: 'Enviar', exact: true }).click();
    await expect(send).toBeHidden();
    await expect
      .poll(async () => (await screenText(page, main)).replace(/\r?\n/g, ''), { timeout: 20_000 })
      .toContain('Valor magico');
  } finally {
    await running.close();
    removeDir(userData);
    removeDir(repo);
  }
});

test('a new reviewer is a read-only session beside the main one, and "only when I click" asks nothing by itself', async () => {
  test.setTimeout(120_000);
  const userData = tempDir('ac-e2e-reviewer-new-');
  const repo = makeRepo();
  const running = await launch(userData);
  const { page } = running;
  try {
    const main = await createSession(page, 'Principal', repo);
    await page.waitForTimeout(3000);
    await page.getByTestId('reviewer-button').click();
    const dialog = page.getByRole('dialog', { name: 'Revisor de “Principal”' });
    await dialog.getByRole('radio', { name: 'Só quando eu clicar em “Revisar agora”' }).check();
    await dialog.getByTestId('reviewer-enable').click();
    await expect(dialog.getByTestId('reviewer-current')).toContainText('Revisor de Principal');
    await expect(dialog.getByTestId('reviewer-run-now')).toBeEnabled();
    await dialog.getByRole('button', { name: 'Fechar' }).click();

    const sessions = await page.evaluate(
      async () => (await window.api.invoke('sessions:list')).sessions,
    );
    const reviewer = sessions.find((s) => s.name === 'Revisor de Principal')!;
    expect(reviewer).toMatchObject({ readOnly: true, cwd: repo, reviewing: main });
    expect(reviewer.groupId).toBe(sessions.find((s) => s.id === main)!.groupId);
    // The session in sight is still the one being worked in.
    await expect(row(page, main)).toHaveAttribute('aria-selected', 'true');

    // A turn changes files, and the reviewer is not started: the trigger is on demand.
    await turn(page, main, repo, 1);
    await page.waitForTimeout(2500);
    expect(fs.existsSync(path.join(userData, 'handoffs', main, 'diff.patch'))).toBe(false);
    await expect(row(page, main).getByTestId('review-badge')).toHaveCount(0);

    // Taking the reviewer away leaves its session.
    await page.getByTestId('reviewer-button').click();
    await page
      .getByRole('dialog', { name: 'Revisor de “Principal”' })
      .getByRole('button', { name: 'Tirar o revisor' })
      .click();
    await expect(page.getByTestId('reviewer-enable')).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(row(page, reviewer.id)).toBeVisible();
    await expect(row(page, reviewer.id).getByTestId('review-badge-reviewer')).toHaveCount(0);
  } finally {
    await running.close();
    removeDir(userData);
    removeDir(repo);
  }
});
