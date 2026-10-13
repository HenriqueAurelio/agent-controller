// Where the parts of the window go, chosen in the preferences, and the editor following the theme.
import fs from 'node:fs';
import path from 'node:path';
import { expect, test, type Locator, type Page } from '@playwright/test';
import { createSession, launch, makeRepo, removeDir, tempDir, type RunningApp } from './harness';

let userData: string;
let repo: string;
let running: RunningApp | null = null;

test.beforeEach(() => {
  userData = tempDir('ac-e2e-data-');
  repo = makeRepo();
  fs.writeFileSync(path.join(repo, 'editado.ts'), 'export const valor = 2;\n');
});
test.afterEach(async () => {
  await running?.close();
  running = null;
  for (const dir of [userData, repo]) removeDir(dir);
});

const open = async () => (running = await launch(userData));

interface Box {
  x: number;
  y: number;
  right: number;
  bottom: number;
}
const box = async (locator: Locator): Promise<Box> => {
  const b = (await locator.boundingBox())!;
  return { x: b.x, y: b.y, right: b.x + b.width, bottom: b.y + b.height };
};
/** Which side of `other` the element is on, when they do not overlap. */
const sideOf = async (element: Locator, other: Locator) => {
  const [a, b] = [await box(element), await box(other)];
  if (a.right <= b.x + 1) return 'left';
  if (a.x >= b.right - 1) return 'right';
  if (a.bottom <= b.y + 1) return 'top';
  if (a.y >= b.bottom - 1) return 'bottom';
  return 'over';
};

const parts = (page: Page) => ({
  sessions: page.locator('.sidebar'),
  main: page.locator('.main'),
  terminal: page.locator('.terminal-area'),
  panel: page.locator('.changes-panel'),
  files: page.locator('.changes-list'),
  text: page.locator('.diff-view'),
});

test('the layout of the preferences places the sessions, the panel and its list of files', async () => {
  let { page } = await open();
  await createSession(page, 'Layout', repo);
  await page.locator('.session-header button[title^="See changes"]').click();
  let p = parts(page);
  await expect(p.text).toBeVisible();

  // As it always was: sessions at the left, the panel over the terminal, the list at the left.
  expect(await sideOf(p.sessions, p.main)).toBe('left');
  expect(await sideOf(p.panel, p.terminal)).toBe('over');
  expect(await sideOf(p.files, p.text)).toBe('left');

  await page.keyboard.press('Control+,');
  let prefs = page.getByRole('dialog', { name: 'Preferências' });
  await prefs.getByRole('tab', { name: 'Layout' }).click();
  const choose = async (label: string, value: string) => {
    await prefs.getByLabel(label).selectOption(value);
  };

  // Every place of each part, applied while the preferences are still open.
  for (const side of ['right', 'top', 'bottom', 'left']) {
    await choose('Sessões', side);
    await expect.poll(() => sideOf(p.sessions, p.main)).toBe(side);
  }
  for (const side of ['right', 'left', 'top', 'bottom']) {
    await choose('Painel de mudanças e arquivos', side);
    await expect.poll(() => sideOf(p.panel, p.terminal)).toBe(side);
  }
  for (const side of ['right', 'top', 'bottom']) {
    await choose('Lista de arquivos do painel', side);
    await expect.poll(() => sideOf(p.files, p.text)).toBe(side);
  }

  // A combination of the three, kept between runs.
  await choose('Sessões', 'top');
  await choose('Painel de mudanças e arquivos', 'right');
  await choose('Lista de arquivos do painel', 'bottom');
  await prefs.getByRole('button', { name: 'Fechar' }).click();
  const combined = async () => [
    await sideOf(p.sessions, p.main),
    await sideOf(p.panel, p.terminal),
    await sideOf(p.files, p.text),
  ];
  await expect.poll(combined).toEqual(['top', 'right', 'bottom']);

  // On top the sessions run sideways, and the terminal beside the panel is still usable.
  await createSession(page, 'Segunda', repo);
  const items = page.locator('.session-item');
  expect(await sideOf(items.nth(0), items.nth(1))).toBe('left');

  await running!.close();
  ({ page } = await open());
  p = parts(page);
  await expect(page.locator('.app')).toHaveAttribute('data-sessions', 'top');
  await page.locator('.session-header button[title^="See changes"]').click();
  await expect(p.text).toBeVisible();
  await expect.poll(combined).toEqual(['top', 'right', 'bottom']);

  // And back to the default with one button.
  await page.keyboard.press('Control+,');
  prefs = page.getByRole('dialog', { name: 'Preferências' });
  await prefs.getByRole('tab', { name: 'Layout' }).click();
  await prefs.getByRole('button', { name: 'Restaurar padrão' }).click();
  await expect.poll(combined).toEqual(['left', 'over', 'left']);
  await expect(prefs.getByRole('button', { name: 'Restaurar padrão' })).toBeDisabled();
});

test('the editor of the panel follows the theme of the app, with nothing left white', async () => {
  const { page } = await open();
  await createSession(page, 'Tema', repo);
  await page.locator('.session-header button[title^="See changes"]').click();
  const frame = page.frameLocator('[data-testid="diff-frame"]');
  await expect(frame.locator('.monaco-diff-editor')).toBeVisible();

  const background = (selector: string) =>
    frame
      .locator(selector)
      .first()
      .evaluate((el) => getComputedStyle(el).backgroundColor);
  const appColor = (name: string) =>
    page.evaluate((variable) => {
      const probe = document.createElement('div');
      probe.style.background = `var(${variable})`;
      document.body.append(probe);
      const color = getComputedStyle(probe).backgroundColor;
      probe.remove();
      return color;
    }, name);

  for (const theme of ['dark', 'light'] as const) {
    await page.evaluate((t) => window.api.invoke('prefs:set', { theme: t }), theme);
    await expect(frame.locator('html')).toHaveAttribute('data-theme', theme);
    // The page under the editor is what shows in the strip of the changed blocks.
    expect(await background('html')).toBe(await appColor('--bg-raised'));
    await expect.poll(() => background('.monaco-editor')).toBe(await appColor('--bg'));
  }
});
