// Quick open: Ctrl+P, a few letters of a name and Enter open the file in the panel, `name:42`
// opens it at that line, and in a terminal the key stays the shell's unless the preference says so.
import fs from 'node:fs';
import path from 'node:path';
import { expect, test } from '@playwright/test';
import { createSession, git, launch, removeDir, tempDir, type RunningApp } from './harness';

let running: RunningApp;
let folder: string;
let userData: string;

const code = (lines: number) =>
  Array.from({ length: lines }, (_, i) => `export const linha${i + 1} = ${i + 1};`).join('\n') +
  '\n';

test.beforeEach(async () => {
  folder = tempDir('ac-e2e-quick-');
  const write = (file: string, content: string) => {
    fs.mkdirSync(path.dirname(path.join(folder, file)), { recursive: true });
    fs.writeFileSync(path.join(folder, file), content);
  };
  write('src/core/sessions/SessionManager.ts', code(60));
  write('src/core/sessions/SessionStore.ts', code(10));
  write('src/main/ipc.ts', code(10));
  write('README.md', '# Projeto\n');
  write('.segredo', 'x\n');
  git(folder, 'init', '-q', '-b', 'main');
  git(folder, 'config', 'user.email', 'e2e@example.com');
  git(folder, 'config', 'user.name', 'E2E');
  git(folder, 'config', 'commit.gpgsign', 'false');
  git(folder, 'add', '-A');
  git(folder, 'commit', '-q', '-m', 'base');
  write('src/main/ipc.ts', code(12));
  userData = tempDir('ac-e2e-quick-data-');
  running = await launch(userData);
});
test.afterEach(async () => {
  await running.close();
  removeDir(userData);
  removeDir(folder);
});

test('Ctrl+P, sesmgr and Enter open SessionManager.ts; name:line opens at the line', async () => {
  test.setTimeout(120_000);
  const { page } = running;
  await createSession(page, 'Busca', folder);
  // The focus out of the terminal: the key belongs to the app there.
  await page.keyboard.press('Control+0');

  await page.keyboard.press('Control+P');
  const box = page.getByRole('dialog', { name: 'Abrir arquivo' });
  await expect(box).toBeVisible();
  const input = box.getByRole('textbox', { name: 'Nome do arquivo' });

  // Empty: what changed, with the letter of the panel.
  await expect(box.getByRole('option')).toHaveCount(1);
  await expect(box.getByRole('option').first()).toContainText('ipc.ts');
  await expect(box.getByRole('option').first().locator('kbd')).toHaveText('M');

  await input.fill('sesmgr');
  await expect(box.getByRole('option').first()).toContainText('SessionManager.ts');
  await input.press('Enter');
  await expect(box).toHaveCount(0);

  const panel = page.getByRole('region', { name: 'Mudanças' });
  await expect(panel).toBeVisible();
  const frame = page.frameLocator('[data-testid="diff-frame"]');
  await frame.locator('body[data-path="src/core/sessions/SessionManager.ts"]').waitFor();

  // On a line, and now among the recent ones.
  await page.keyboard.press('Control+0');
  await page.keyboard.press('Control+P');
  await expect(box.getByRole('option').first()).toContainText('SessionManager.ts');
  await expect(box.getByRole('option').first().locator('kbd')).toHaveText('recente');
  await input.fill('store:7');
  await expect(box.getByRole('option').first()).toContainText('SessionStore.ts');
  await input.press('Enter');
  await frame.locator('body[data-path="src/core/sessions/SessionStore.ts"]').waitFor();
  await expect(frame.locator('body[data-reveal-line="7"]')).toHaveCount(1);
});

test('hidden files follow the preference, and Esc closes the box', async () => {
  test.setTimeout(120_000);
  const { page } = running;
  await createSession(page, 'Ocultos', folder);
  await page.keyboard.press('Control+0');
  await page.keyboard.press('Control+P');
  const box = page.getByRole('dialog', { name: 'Abrir arquivo' });
  const input = box.getByRole('textbox', { name: 'Nome do arquivo' });
  await input.fill('segredo');
  await expect(box.getByText('Nenhum arquivo com esse nome.')).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(box).toHaveCount(0);

  await page.evaluate(() => window.api.invoke('prefs:set', { showHiddenFiles: true }));
  await page.keyboard.press('Control+0');
  await page.keyboard.press('Control+P');
  await input.fill('segredo');
  await expect(box.getByRole('option').first()).toContainText('.segredo');
});

test('in the terminal Ctrl+P stays the terminal key, unless the preference takes it', async () => {
  test.setTimeout(120_000);
  const { page } = running;
  await createSession(page, 'Terminal', folder);
  await page.locator('.terminal-host.visible').click();
  await page.keyboard.press('Control+P');
  await page.waitForTimeout(500);
  await expect(page.getByRole('dialog', { name: 'Abrir arquivo' })).toHaveCount(0);

  await page.evaluate(() => window.api.invoke('prefs:set', { quickOpenInTerminal: true }));
  await page.locator('.terminal-host.visible').click();
  await page.keyboard.press('Control+P');
  await expect(page.getByRole('dialog', { name: 'Abrir arquivo' })).toBeVisible();
});

test('the palette offers it too', async () => {
  test.setTimeout(120_000);
  const { page } = running;
  await createSession(page, 'Paleta', folder);
  await page.keyboard.press('Control+0');
  await page.keyboard.press('Control+Shift+P');
  await page.getByRole('textbox', { name: /comando/i }).fill('abrir arquivo');
  await page.getByRole('option', { name: /Abrir arquivo pelo nome/ }).click();
  await expect(page.getByRole('dialog', { name: 'Abrir arquivo' })).toBeVisible();
});
