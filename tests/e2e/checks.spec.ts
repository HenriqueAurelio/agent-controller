import fs from 'node:fs';
import path from 'node:path';
import { expect, test } from '@playwright/test';
import { createSession, launch, removeDir, screenText, tempDir } from './harness';
import { configureSuggested, makeProject, turn } from './project';

test('checks run when a turn ends, tell what failed, and the error goes to the agent', async () => {
  test.setTimeout(240_000);
  const userData = tempDir('ac-e2e-checks-');
  const repo = makeProject();
  const running = await launch(userData);
  const { page } = running;
  let closed = false;
  try {
    const id = await createSession(page, 'Projeto', repo);
    const item = page.locator('.session-item', { hasText: 'Projeto' });

    // Nothing runs before the user picks the commands: the project only suggests them.
    await turn(page, id);
    await expect(item.getByTestId('checks-badge')).toHaveCount(0);

    let dialog = await configureSuggested(page);
    await expect(dialog.getByLabel('Comando da verificação 1')).toHaveValue('npm run lint');
    await expect(dialog.getByLabel('Comando da verificação 2')).toHaveValue('npm test');
    // `build` is not a check, and what was added is no longer suggested.
    await expect(dialog.locator('.checks-suggestion')).toHaveCount(0);
    await dialog.getByRole('button', { name: 'Fechar' }).click();

    // A turn that changed a file: the checks run by themselves.
    await turn(page, id);
    const badge = item.getByTestId('checks-badge');
    await expect(badge).toHaveAttribute('data-checks', 'failed', { timeout: 90_000 });
    await expect(badge).toHaveText('✗ 1');
    await expect(badge).toHaveAttribute('title', '1 de 2 falharam');

    await page
      .locator('.session-header')
      .getByRole('button', { name: /^Verificações/ })
      .click();
    dialog = page.getByRole('dialog', { name: 'Verificações' });
    const run = dialog.getByTestId('checks-run');
    await expect(run).toContainText('1 de 2 falharam');
    await expect(run).toContainText('ao fim do turno');
    await expect(run.locator('[data-outcome="passed"]')).toContainText('npm run lint');
    const failed = run.locator('[data-outcome="failed"]');
    await expect(failed).toContainText('falhou (código 1)');
    await expect(failed.locator('.checks-output')).toContainText('soma(2, 3) deu -1, esperava 5');

    // The failure goes into the agent's prompt, for the user to send.
    await dialog.getByRole('button', { name: 'Mandar o erro ao agente' }).click();
    await expect(dialog).toBeHidden();
    await expect
      .poll(() => screenText(page, id), { timeout: 15_000 })
      .toContain('As verificações do projeto falharam');
    await expect.poll(() => screenText(page, id)).toContain('esperava 5');

    // Fixed, and checked again by hand.
    fs.writeFileSync(path.join(repo, 'soma.cjs'), 'module.exports = (a, b) => a + b;\n');
    await page.keyboard.press('Control+Shift+P');
    const palette = page.getByRole('dialog', { name: 'Paleta de comandos' });
    await palette.getByRole('option', { name: 'Rodar agora as verificações de “Projeto”' }).click();
    await expect(badge).toHaveAttribute('data-checks', 'passed', { timeout: 90_000 });
    await expect(badge).toHaveText('✓');

    // The checks belong to the folder: they are still there after the app reopens.
    await running.close();
    closed = true;
    const again = await launch(userData);
    try {
      await again.page.locator('.session-item', { hasText: 'Projeto' }).click();
      await again.page
        .locator('.session-header')
        .getByRole('button', { name: /^Verificações/ })
        .click();
      const reopened = again.page.getByRole('dialog', { name: 'Verificações' });
      await expect(reopened.getByLabel('Comando da verificação 2')).toHaveValue('npm test');
      await expect(reopened).toContainText('Ainda não rodou nesta sessão.');
    } finally {
      await again.close();
    }
  } finally {
    if (!closed) await running.close();
    removeDir(userData);
    removeDir(repo);
  }
});

test('a run is cancelled when the agent goes back to work', async () => {
  test.setTimeout(180_000);
  const userData = tempDir('ac-e2e-checks-');
  const repo = makeProject();
  // A check that takes long enough to be caught running.
  fs.writeFileSync(
    path.join(repo, 'lint.cjs'),
    "setTimeout(() => console.log('lint: ok'), 60000);\n",
  );
  const running = await launch(userData);
  const { page } = running;
  try {
    const id = await createSession(page, 'Lento', repo);
    const dialog = await configureSuggested(page);
    await dialog.getByRole('button', { name: 'Fechar' }).click();
    const badge = page.locator('.session-item', { hasText: 'Lento' }).getByTestId('checks-badge');

    await turn(page, id);
    await expect(badge).toHaveAttribute('data-checks', 'running', { timeout: 30_000 });
    await turn(page, id);
    // The second turn cancels the first run and, having changed a file, starts a new one.
    await expect(badge).toHaveAttribute('data-checks', 'running', { timeout: 30_000 });

    await page
      .locator('.session-header')
      .getByRole('button', { name: /^Verificações/ })
      .click();
    const opened = page.getByRole('dialog', { name: 'Verificações' });
    await opened.getByRole('button', { name: 'Cancelar a rodada' }).click();
    await expect(badge).toHaveAttribute('data-checks', 'cancelled');
    await expect(opened.getByTestId('checks-run')).toContainText('Cancelada');
  } finally {
    await running.close();
    removeDir(userData);
    removeDir(repo);
  }
});
