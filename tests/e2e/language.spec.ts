// The language of the interface: chosen in the preferences, applied to everything on screen, and
// carried by the file of the settings.
import fs from 'node:fs';
import path from 'node:path';
import { expect, test, type Page } from '@playwright/test';
import { createSession, launch, removeDir, tempDir, type RunningApp } from './harness';

let userData: string;
let folder: string;
let exported: string;
let running: RunningApp | null = null;

test.beforeEach(() => {
  userData = tempDir('ac-e2e-data-');
  folder = tempDir('ac-e2e-idioma-');
  exported = path.join(tempDir('ac-e2e-export-'), 'configuracoes.json');
});
test.afterEach(async () => {
  await running?.close();
  running = null;
  for (const dir of [userData, folder, path.dirname(exported)]) removeDir(dir);
});

const open = async () =>
  (running = await launch(userData, { AGENT_CONTROLLER_TEST_PREFS_FILE: exported }));
const prefsOf = (page: Page) => page.evaluate(() => window.api.invoke('prefs:get'));

test('the language chosen in the preferences is the one of every text', async () => {
  let { page } = await open();
  await createSession(page, 'Loja', folder);
  await expect(page.locator('html')).toHaveAttribute('lang', 'pt-BR');
  // Which state the shell of the tests reaches depends on the system: cmd.exe sets a title.
  await expect(page.locator('.session-item .session-state')).toHaveText(
    /Aguardando você|Iniciando/,
  );

  await page.keyboard.press('Control+,');
  await page
    .getByRole('dialog', { name: 'Preferências' })
    .getByLabel('Idioma da interface')
    .selectOption('en');

  // Applied right away, to the dialog that is open and to what is behind it.
  const prefs = page.getByRole('dialog', { name: 'Preferences' });
  await expect(prefs.getByRole('tab')).toHaveText([
    'General',
    'Agents',
    'Shortcuts',
    'Layout',
    'Import and export',
  ]);
  await expect(prefs.getByLabel('Interface language')).toHaveValue('en');
  await expect(prefs.getByText('Notify when an agent is waiting for you')).toBeVisible();
  await expect(page.locator('html')).toHaveAttribute('lang', 'en');
  await expect(page.locator('.sidebar-title')).toHaveText('Sessions');
  await expect(page.locator('.session-item .session-state')).toHaveText(/Waiting for you|Starting/);
  await expect(page.getByRole('button', { name: '+ New session' })).toBeVisible();
  await expect(page.locator('.session-header').getByRole('button', { name: 'Stop' })).toBeVisible();

  // The other sections of the preferences.
  await prefs.getByRole('tab', { name: 'Shortcuts' }).click();
  await expect(prefs.locator('[data-action="newSession"] .shortcut-label')).toHaveText(
    'New session',
  );
  await prefs.getByRole('tab', { name: 'Layout' }).click();
  await expect(prefs.getByLabel('Changes and files panel')).toContainText('Over the terminal');
  await prefs.getByRole('button', { name: 'Close' }).click();

  // The command palette, and a message that comes from the main process.
  await page.keyboard.press('Control+Shift+P');
  const palette = page.getByRole('dialog', { name: 'Command palette' });
  await expect(palette.getByRole('option', { name: 'Go to: Loja' })).toBeVisible();
  await page.keyboard.press('Escape');
  await page.getByRole('button', { name: '+ New session' }).click();
  const dialog = page.getByRole('dialog', { name: 'New session' });
  await dialog.getByLabel('Folder').fill(path.join(folder, 'missing'));
  await dialog.getByRole('button', { name: 'Create and start' }).click();
  await expect(dialog.getByRole('alert')).toContainText('The folder does not exist');
  await dialog.getByRole('button', { name: 'Cancel' }).click();

  // The changes panel.
  await page.locator('.session-header button[title^="See changes"]').click();
  const panel = page.getByRole('region', { name: 'Changes' });
  await expect(panel.getByText('This folder is not a git repository')).toBeVisible();
  await panel.getByRole('button', { name: 'Close the changes panel' }).click();

  // And kept for the next time the app opens.
  expect((await prefsOf(page)).language).toBe('en');
  await running!.close();
  ({ page } = await open());
  await expect(page.locator('.sidebar-title')).toHaveText('Sessions');
  await expect(page.getByRole('button', { name: '+ New session' })).toBeVisible();
});

test('the button of the changes and the palette speak the language too, Spanish included', async () => {
  const { page } = await open();
  await createSession(page, 'Loja', folder);
  const header = page.locator('.session-header');
  await expect(header.getByRole('button', { name: 'Ver mudanças' })).toHaveAttribute(
    'title',
    /^Ver mudanças/,
  );
  await page.keyboard.press('Control+Shift+P');
  let palette = page.getByRole('dialog', { name: 'Paleta de comandos' });
  await expect(palette.getByRole('option', { name: /^Ver mudanças:/ })).toBeVisible();
  await page.keyboard.press('Escape');

  await page.keyboard.press('Control+,');
  await page
    .getByRole('dialog', { name: 'Preferências' })
    .getByLabel('Idioma da interface')
    .selectOption('es');
  const prefs = page.getByRole('dialog', { name: 'Preferencias' });
  await expect(prefs.getByRole('tab')).toHaveText([
    'General',
    'Agentes',
    'Atajos',
    'Diseño',
    'Importar y exportar',
  ]);
  await expect(prefs.getByLabel('Idioma de la interfaz')).toHaveValue('es');
  await expect(page.locator('html')).toHaveAttribute('lang', 'es');
  await prefs.getByRole('button', { name: 'Cerrar' }).click();

  await expect(page.locator('.sidebar-title')).toHaveText('Sesiones');
  await expect(page.getByRole('button', { name: '+ Nueva sesión' })).toBeVisible();
  await expect(header.getByRole('button', { name: 'Ver cambios' })).toHaveAttribute(
    'title',
    /^Ver cambios/,
  );
  await page.keyboard.press('Control+Shift+P');
  palette = page.getByRole('dialog', { name: 'Paleta de comandos' });
  await expect(palette.getByRole('option', { name: /^Ver cambios:/ })).toBeVisible();
  await expect(palette.getByRole('option', { name: 'Ir a: Loja' })).toBeVisible();
  await page.keyboard.press('Escape');
  expect((await prefsOf(page)).language).toBe('es');
});

test('the language goes out with the exported settings and comes back with them', async () => {
  let { page } = await open();
  await page.evaluate(() => window.api.invoke('prefs:set', { language: 'en' }));
  await page.keyboard.press('Control+,');
  let prefs = page.getByRole('dialog', { name: 'Preferences' });
  await prefs.getByRole('tab', { name: 'Import and export' }).click();
  await prefs.getByRole('button', { name: 'Export…' }).click();
  await expect(prefs.getByRole('status')).toHaveText(`Settings exported to ${exported}`);
  expect(JSON.parse(fs.readFileSync(exported, 'utf8')).prefs.language).toBe('en');
  await running!.close();

  // Another machine, still in the language the app comes with.
  removeDir(userData);
  userData = tempDir('ac-e2e-data-');
  ({ page } = await open());
  expect((await prefsOf(page)).language).toBe('pt-BR');
  await page.keyboard.press('Control+,');
  prefs = page.getByRole('dialog', { name: 'Preferências' });
  await prefs.getByRole('tab', { name: 'Importar e exportar' }).click();
  await prefs.getByRole('button', { name: 'Importar…' }).click();
  // The dialog that asked for the import already answers in the language that came in.
  prefs = page.getByRole('dialog', { name: 'Preferences' });
  await expect(prefs.getByRole('status')).toHaveText('Settings imported.');
  await prefs.getByRole('tab', { name: 'General' }).click();
  await expect(prefs.getByLabel('Interface language')).toHaveValue('en');
  await expect(page.locator('.sidebar-title')).toHaveText('Sessions');
  expect((await prefsOf(page)).language).toBe('en');

  // A file from before the language existed, or with one the app does not have: the default.
  const file = JSON.parse(fs.readFileSync(exported, 'utf8'));
  file.prefs.language = 'xx';
  fs.writeFileSync(exported, JSON.stringify(file));
  await prefs.getByRole('tab', { name: 'Import and export' }).click();
  await prefs.getByRole('button', { name: 'Import…' }).click();
  await expect(page.getByRole('dialog', { name: 'Preferências' }).getByRole('status')).toHaveText(
    'Configurações importadas.',
  );
  expect((await prefsOf(page)).language).toBe('pt-BR');
});
