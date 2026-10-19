import fs from 'node:fs';
import path from 'node:path';
import { expect, test, type Page } from '@playwright/test';
import { createSession, launch, removeDir, tempDir } from './harness';

const item = (page: Page, name: string) =>
  page.locator('.session-item', { has: page.locator('.session-name', { hasText: name }) });
const group = (page: Page, name: string) => page.getByRole('group', { name });
const listed = (page: Page) =>
  page.locator('.session-list .session-name, .session-list .group-name').allTextContents();

async function palette(page: Page, command: string) {
  await page.keyboard.press('Control+Shift+P');
  const dialog = page.getByRole('dialog', { name: 'Paleta de comandos' });
  await dialog.getByRole('option', { name: command }).click();
  await expect(dialog).toBeHidden();
}

test('sessions are gathered in groups that fold, move, and come back after a restart', async () => {
  test.setTimeout(180_000);
  const userData = tempDir('ac-e2e-groups-');
  const base = tempDir('ac-e2e-groups-dirs-');
  const repo = path.join(base, 'xxx-repo');
  const other = path.join(base, 'outro');
  fs.mkdirSync(repo);
  fs.mkdirSync(other);
  const running = await launch(userData);
  const { page } = running;
  let closed = false;
  try {
    await createSession(page, 'Back', repo);
    await createSession(page, 'Docs', other);
    await createSession(page, 'Front', repo);

    // A new group starts from the folder in sight: its name, and the sessions open in it.
    await page.getByRole('button', { name: /^Novo grupo/ }).click();
    let dialog = page.getByRole('dialog', { name: 'Novo grupo' });
    await expect(dialog.getByLabel('Nome do grupo')).toHaveValue('xxx-repo');
    await expect(dialog.getByRole('checkbox', { name: /Back/ })).toBeChecked();
    await expect(dialog.getByRole('checkbox', { name: /Front/ })).toBeChecked();
    await expect(dialog.getByRole('checkbox', { name: /Docs/ })).not.toBeChecked();
    await dialog.getByLabel('Nome do grupo').fill('XXX-REPO');
    await dialog.getByRole('button', { name: 'Criar grupo' }).click();
    await expect(dialog).toBeHidden();

    const repoGroup = group(page, 'XXX-REPO');
    await expect(repoGroup.locator('.session-name')).toHaveText(['Back', 'Front']);
    await expect(repoGroup.locator('.group-count')).toHaveText('2');
    // The ones with no group come first.
    expect(await listed(page)).toEqual(['Docs', 'XXX-REPO', 'Back', 'Front']);
    // The shortcuts follow the list as it is shown.
    await page.keyboard.press('Control+2');
    await expect(item(page, 'Back')).toHaveAttribute('aria-selected', 'true');

    // Folded, every member is hidden, including the session in sight.
    await repoGroup.locator('.group-header').click();
    await expect(repoGroup.locator('.group-header')).toHaveAttribute('aria-expanded', 'false');
    await expect(repoGroup.locator('.session-name')).toHaveCount(0);
    await item(page, 'Docs').click();
    await expect(repoGroup.locator('.session-item')).toHaveCount(0);
    await repoGroup.locator('.group-header').click();
    await expect(repoGroup.locator('.session-name')).toHaveText(['Back', 'Front']);

    // In and out through the palette.
    await palette(page, 'Mover “Docs” para o grupo “XXX-REPO”');
    await expect(repoGroup.locator('.session-name')).toHaveText(['Back', 'Front', 'Docs']);
    await palette(page, 'Tirar “Docs” do grupo “XXX-REPO”');
    expect(await listed(page)).toEqual(['Docs', 'XXX-REPO', 'Back', 'Front']);

    // Dragged onto the header, it joins the group; onto the strip at the top, it leaves.
    await item(page, 'Docs').dragTo(repoGroup.locator('.group-header'));
    await expect(repoGroup.locator('.session-name')).toHaveText(['Back', 'Front', 'Docs']);
    await item(page, 'Docs').dragTo(item(page, 'Back'));
    await expect(repoGroup.locator('.session-name')).toHaveText(['Docs', 'Back', 'Front']);

    // With the keyboard: Alt+arrow past the edge of the group takes it out.
    await item(page, 'Docs').focus();
    await page.keyboard.press('Alt+ArrowUp');
    await expect.poll(() => listed(page)).toEqual(['Docs', 'XXX-REPO', 'Back', 'Front']);
    // The moved session gets the keyboard back on the next frame.
    await expect(item(page, 'Docs')).toBeFocused();
    await page.keyboard.press('Alt+ArrowDown');
    await expect.poll(() => listed(page)).toEqual(['XXX-REPO', 'Docs', 'Back', 'Front']);
    await palette(page, 'Tirar “Docs” do grupo “XXX-REPO”');

    // A new session from the group's header goes into it.
    await repoGroup.locator('.group-header').hover();
    await page.getByRole('button', { name: 'Nova sessão em XXX-REPO' }).click();
    dialog = page.getByRole('dialog', { name: 'Nova sessão' });
    await expect(dialog.getByLabel('Grupo')).toHaveValue(/.+/);
    await dialog.getByLabel('Pasta').fill(repo);
    await dialog.getByLabel('Nome', { exact: true }).fill('Testes');
    await dialog.getByRole('button', { name: 'Criar e iniciar' }).click();
    await expect(dialog).toBeHidden();
    await expect(repoGroup.locator('.session-name')).toHaveText(['Back', 'Front', 'Testes']);

    // Renamed in place, and edited: Front leaves, Docs joins.
    await repoGroup.locator('.group-name').dblclick();
    await page.keyboard.press('Control+A');
    await page.keyboard.type('Repositório XXX');
    await page.keyboard.press('Enter');
    const renamed = group(page, 'Repositório XXX');
    await expect(renamed.locator('.group-name')).toHaveText('Repositório XXX');
    await palette(page, 'Editar o grupo “Repositório XXX”');
    dialog = page.getByRole('dialog', { name: 'Editar grupo' });
    await dialog.getByRole('checkbox', { name: /Front/ }).uncheck();
    await dialog.getByRole('checkbox', { name: /Docs/ }).check();
    await dialog.getByRole('button', { name: 'Salvar' }).click();
    await expect(renamed.locator('.session-name')).toHaveText(['Back', 'Testes', 'Docs']);
    expect(await listed(page)).toEqual(['Front', 'Repositório XXX', 'Back', 'Testes', 'Docs']);

    // Groups and folding are still there after the app reopens.
    await item(page, 'Front').click();
    await renamed.locator('.group-header').click();
    await running.close();
    closed = true;
    const again = await launch(userData);
    try {
      const page2 = again.page;
      const back = group(page2, 'Repositório XXX');
      await expect(back.locator('.group-header')).toHaveAttribute('aria-expanded', 'false');
      await expect(back.locator('.group-count')).toHaveText('3');
      await back.locator('.group-header').click();
      expect(await listed(page2)).toEqual(['Front', 'Repositório XXX', 'Back', 'Testes', 'Docs']);

      // Ungrouping keeps every session.
      await back.locator('.group-header').hover();
      await page2.getByRole('button', { name: /^Desfazer o grupo Repositório XXX/ }).click();
      await expect(page2.locator('.session-group')).toHaveCount(0);
      expect(await listed(page2)).toEqual(['Front', 'Back', 'Testes', 'Docs']);
    } finally {
      await again.close();
    }
  } finally {
    if (!closed) await running.close();
    removeDir(userData);
    removeDir(base);
  }
});

test('a session can start a new group from its context menu', async () => {
  const userData = tempDir('ac-e2e-group-context-');
  const base = tempDir('ac-e2e-group-context-dir-');
  const folder = path.join(base, 'context-repo');
  fs.mkdirSync(folder);
  const running = await launch(userData);
  try {
    const { page } = running;
    await createSession(page, 'Implementação', folder);

    await expect(page.getByTestId('new-group-button')).toBeVisible();
    await item(page, 'Implementação').click({ button: 'right' });
    const menu = page.getByRole('menu', { name: 'Ações para Implementação' });
    await menu.getByRole('menuitem', { name: 'Novo grupo com Implementação' }).click();

    const dialog = page.getByRole('dialog', { name: 'Novo grupo' });
    await expect(dialog.getByLabel('Nome do grupo')).toHaveValue('context-repo');
    await expect(dialog.getByRole('checkbox', { name: /Implementação/ })).toBeChecked();
    await dialog.getByLabel('Nome do grupo').fill('Entrega');
    await dialog.getByRole('button', { name: 'Criar grupo' }).click();

    await expect(group(page, 'Entrega').locator('.session-name')).toHaveText(['Implementação']);
  } finally {
    await running.close();
    removeDir(userData);
    removeDir(base);
  }
});
