// Favorite folders, and the preferences going out to a file and coming back from it.
import fs from 'node:fs';
import path from 'node:path';
import { expect, test, type Page } from '@playwright/test';
import { createSession, launch, removeDir, tempDir, type RunningApp } from './harness';

let userData: string;
let first: string;
let second: string;
let exported: string;
let running: RunningApp | null = null;

test.beforeEach(() => {
  userData = tempDir('ac-e2e-data-');
  first = tempDir('ac-e2e-um-');
  second = tempDir('ac-e2e-dois-');
  exported = path.join(tempDir('ac-e2e-export-'), 'configuracoes.json');
});
test.afterEach(async () => {
  await running?.close();
  running = null;
  for (const dir of [userData, first, second, path.dirname(exported)]) removeDir(dir);
});

// The native dialogs cannot be driven: in test mode the file comes from the environment.
const open = async () =>
  (running = await launch(userData, { AGENT_CONTROLLER_TEST_PREFS_FILE: exported }));
const prefsOf = (page: Page) => page.evaluate(() => window.api.invoke('prefs:get'));

test('a favorite folder is kept at hand for the next sessions', async () => {
  const { page } = await open();
  const dialog = page.getByRole('dialog', { name: 'Nova sessão' });
  const favorites = dialog.getByRole('list', { name: 'Favoritas' });
  const recent = dialog.getByRole('list', { name: 'Recentes' });

  await page.getByRole('button', { name: '+ Nova sessão' }).click();
  const star = dialog.getByRole('button', { name: 'Guardar nos favoritos' });
  // There is nothing to keep before a folder is in the field.
  await expect(star).toBeDisabled();
  await expect(favorites).toBeHidden();
  await dialog.getByLabel('Pasta').fill(first);
  await star.click();
  await expect(favorites.getByRole('button')).toContainText([first]);
  await expect(dialog.getByRole('button', { name: 'Tirar dos favoritos' })).toHaveAttribute(
    'aria-pressed',
    'true',
  );
  await page.keyboard.press('Escape');

  // Another folder becomes the latest one; the favorite is still there, one click away.
  await createSession(page, 'Dois', second);
  await page.getByRole('button', { name: '+ Nova sessão' }).click();
  await expect(dialog.getByLabel('Pasta')).toHaveValue(second);
  await expect(favorites.getByRole('button')).toContainText([first]);
  // A folder is offered once: the favorite one is not repeated among the recent ones.
  await expect(recent).toBeHidden();
  await favorites.getByRole('button', { name: first }).click();
  await expect(dialog.getByLabel('Pasta')).toHaveValue(first);
  await expect(dialog.getByLabel('Nome')).toHaveValue(path.basename(first));
  await dialog.getByRole('button', { name: 'Criar e iniciar' }).click();
  await expect(page.locator('.session-item', { hasText: path.basename(first) })).toHaveAttribute(
    'aria-selected',
    'true',
  );

  // The same list, in the preferences: add by typing, take out with the ×.
  await page.keyboard.press('Control+,');
  const prefs = page.getByRole('dialog', { name: 'Preferências' });
  await prefs.getByRole('tab', { name: 'Agentes' }).click();
  const list = prefs.getByRole('list', { name: 'Pastas favoritas' });
  await expect(list.locator('.favorite-path')).toHaveText([first]);
  await prefs.getByLabel('Nova pasta favorita').fill(second + path.sep);
  await prefs.getByRole('button', { name: 'Adicionar' }).click();
  await expect(list.locator('.favorite-path')).toHaveText([first, second]);
  await expect(prefs.getByLabel('Nova pasta favorita')).toHaveValue('');
  // The same folder again changes nothing.
  await prefs.getByLabel('Nova pasta favorita').fill(second);
  await page.keyboard.press('Enter');
  await expect(list.locator('.favorite-path')).toHaveText([first, second]);
  await prefs.getByRole('button', { name: `Tirar ${first} dos favoritos` }).click();
  await expect(list.locator('.favorite-path')).toHaveText([second]);
  expect((await prefsOf(page)).favoriteFolders).toEqual([second]);
});

test('the preferences are exported to a file and imported back', async () => {
  let { page } = await open();
  const chosen = {
    theme: 'light' as const,
    fontSize: 17,
    favoriteFolders: [first, second],
    layout: { sessions: 'top' as const, panel: 'right' as const, files: 'bottom' as const },
  };
  await page.evaluate((patch) => window.api.invoke('prefs:set', patch), chosen);
  await createSession(page, 'Fica', first);

  await page.keyboard.press('Control+,');
  let prefs = page.getByRole('dialog', { name: 'Preferências' });
  await prefs.getByRole('tab', { name: 'Importar e exportar' }).click();
  await prefs.getByRole('button', { name: 'Exportar…' }).click();
  await expect(prefs.getByRole('status')).toContainText(exported);
  const file = JSON.parse(fs.readFileSync(exported, 'utf8'));
  expect(file).toMatchObject({ kind: 'agent-controller/preferences', version: 1, prefs: chosen });
  // The sessions are not preferences: nothing of them goes along.
  expect(JSON.stringify(file)).not.toContain('Fica');
  await running!.close();

  // Another machine, with nothing chosen yet.
  removeDir(userData);
  userData = tempDir('ac-e2e-data-');
  ({ page } = await open());
  await expect(page.locator('.app')).toHaveAttribute('data-sessions', 'left');
  await page.keyboard.press('Control+,');
  prefs = page.getByRole('dialog', { name: 'Preferências' });
  await prefs.getByRole('tab', { name: 'Importar e exportar' }).click();
  await prefs.getByRole('button', { name: 'Importar…' }).click();
  await expect(prefs.getByRole('status')).toHaveText('Configurações importadas.');
  // Applied right away, and shown in the dialog that is open.
  await expect(page.locator('.app')).toHaveAttribute('data-sessions', 'top');
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'light');
  await prefs.getByRole('tab', { name: 'Agentes' }).click();
  await expect(
    prefs.getByRole('list', { name: 'Pastas favoritas' }).locator('.favorite-path'),
  ).toHaveText([first, second]);
  expect(await prefsOf(page)).toMatchObject(chosen);

  // And kept.
  await running!.close();
  ({ page } = await open());
  expect(await prefsOf(page)).toMatchObject(chosen);

  // A file that is not an export is refused, and nothing changes.
  fs.writeFileSync(exported, JSON.stringify({ version: 1, sessions: [] }));
  await page.keyboard.press('Control+,');
  prefs = page.getByRole('dialog', { name: 'Preferências' });
  await prefs.getByRole('tab', { name: 'Importar e exportar' }).click();
  await prefs.getByRole('button', { name: 'Importar…' }).click();
  await expect(prefs.getByRole('alert')).toContainText('não é uma exportação');
  expect(await prefsOf(page)).toMatchObject(chosen);
});
