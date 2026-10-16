import { expect, test } from '@playwright/test';
import { createSession, launch, removeDir, screenText, setTitle, tempDir } from './harness';

test('a saved prompt reaches three sessions, each with its own variables', async () => {
  test.setTimeout(180_000);
  const userData = tempDir('ac-e2e-prompts-');
  const folders = ['api', 'web', 'docs'].map((name) => tempDir(`ac-e2e-${name}-`));
  const running = await launch(userData);
  const { page } = running;
  try {
    const ids: string[] = [];
    for (const [index, name] of ['API', 'Web', 'Docs'].entries()) {
      ids.push(await createSession(page, name, folders[index]!));
    }

    // A prompt of the user's, written in the preferences.
    await page.keyboard.press('Control+,');
    const prefs = page.getByRole('dialog', { name: 'Preferências' });
    await prefs.getByRole('tab', { name: 'Prompts' }).click();
    await expect(prefs.getByRole('option')).toHaveCount(3); // The factory ones.
    await prefs.getByRole('button', { name: '+ Novo prompt' }).click();
    await prefs.getByLabel('Nome').fill('Saudar');
    await prefs.getByLabel('Texto').fill('ola {sessao} prioridade {?Prioridade} fim');
    await prefs.getByLabel('Nome').click(); // Leaves the text, which saves it.
    await expect(prefs.getByRole('option', { name: 'Saudar' })).toBeVisible();
    await prefs.getByRole('button', { name: 'Fechar' }).click();

    // The one in sight plus two more, picked with Ctrl+click.
    await page.locator('.session-item', { hasText: 'API' }).click({ modifiers: ['Control'] });
    await page.locator('.session-item', { hasText: 'Web' }).click({ modifiers: ['Control'] });
    await expect(page.locator('.session-item.marked')).toHaveCount(3);
    await page.getByRole('button', { name: 'Enviar prompt' }).click();

    const dialog = page.getByRole('dialog', { name: 'Enviar prompt' });
    await dialog.getByLabel('Prompt', { exact: true }).selectOption({ label: 'Saudar' });
    await dialog.getByLabel('Prioridade').fill('alta');
    await expect(dialog.getByTestId('prompt-preview')).toHaveText('ola API prioridade alta fim');
    await dialog.getByRole('button', { name: 'Enviar a 3 sessões' }).click();
    await expect(dialog).toBeHidden();
    await expect(page.locator('.session-item.marked')).toHaveCount(0);

    // Without Enter: the text waits at the prompt of each one, with its own name.
    for (const [index, name] of ['API', 'Web', 'Docs'].entries()) {
      await expect
        .poll(() => screenText(page, ids[index]!), { timeout: 15_000 })
        .toContain(`ola ${name} prioridade alta fim`);
    }

    // From the palette, to the session in sight only.
    await page.locator('.session-item', { hasText: 'Web' }).click();
    await page.keyboard.press('Control+Shift+P');
    const palette = page.getByRole('dialog', { name: 'Paleta de comandos' });
    await palette.getByRole('option', { name: 'Prompt: Revisar o diff' }).click();
    const review = page.getByRole('dialog', { name: 'Enviar prompt' });
    await expect(review.getByTestId('prompt-preview')).toContainText('Revise as mudanças');
    await review.getByRole('button', { name: 'Enviar', exact: true }).click();
    await expect.poll(() => screenText(page, ids[1]!)).toContain('Revise as mudan');
    expect(await screenText(page, ids[0]!)).not.toContain('Revise as mudan');
  } finally {
    await running.close();
    removeDir(userData);
    for (const folder of folders) removeDir(folder);
  }
});

test('a prompt sent while the agent works waits for the end of the turn', async () => {
  test.setTimeout(120_000);
  const userData = tempDir('ac-e2e-prompts-wait-');
  const folder = tempDir('ac-e2e-wait-');
  const running = await launch(userData);
  const { page } = running;
  try {
    const id = await createSession(page, 'Ocupada', folder);
    const item = page.locator('.session-item', { hasText: 'Ocupada' });
    // A spinner in the title, as Claude Code shows while it works.
    await setTitle(page, '◐ tarefa');
    await expect(item).toHaveAttribute('data-state', 'trabalhando', { timeout: 15_000 });

    await page.keyboard.press('Control+Shift+P');
    await page
      .getByRole('dialog', { name: 'Paleta de comandos' })
      .getByRole('option', { name: 'Prompt: Revisar o diff' })
      .click();
    const dialog = page.getByRole('dialog', { name: 'Enviar prompt' });
    await expect(dialog.getByRole('status')).toContainText('1 das sessões estão ocupadas');
    await dialog.getByRole('button', { name: 'Enviar', exact: true }).click();
    await expect(item.getByTestId('pending-send')).toContainText('1 envio(s) esperando o turno');
    expect(await screenText(page, id)).not.toContain('Revise as mudan');

    // The turn ends: the title settles on idle, and the text goes.
    await setTitle(page, '✳ pronto');
    await expect(item.getByTestId('pending-send')).toHaveCount(0, { timeout: 15_000 });
    await expect.poll(() => screenText(page, id), { timeout: 15_000 }).toContain('Revise as mudan');

    // Cancelled, a pending text never goes.
    await setTitle(page, '◐ outra');
    await expect(item).toHaveAttribute('data-state', 'trabalhando', { timeout: 15_000 });
    await page.evaluate(
      (s) =>
        window.api.invoke('terminal:sendText', [s], { text: 'NUNCA-ENVIADO' }, { submit: false }),
      id,
    );
    await item.getByRole('button', { name: 'Cancelar o envio pendente de Ocupada' }).click();
    await expect(item.getByTestId('pending-send')).toHaveCount(0);
    await setTitle(page, '✳ pronto');
    await expect(item).toHaveAttribute('data-state', 'terminou', { timeout: 15_000 });
    await page.waitForTimeout(1000);
    expect(await screenText(page, id)).not.toContain('NUNCA-ENVIADO');
  } finally {
    await running.close();
    removeDir(userData);
    removeDir(folder);
  }
});
