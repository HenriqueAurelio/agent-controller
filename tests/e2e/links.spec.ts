// Links in the terminal: Ctrl+click on `file:line` opens the file in the panel at that line, a
// path outside the folder is not a link, and an address opens the browser.
import fs from 'node:fs';
import path from 'node:path';
import { expect, test } from '@playwright/test';
import { createSession, launch, removeDir, tempDir, type RunningApp } from './harness';
import { ctrlClick, makeFolder, pointAt, printLine } from './links-helpers';

let running: RunningApp;
let folder: string;
let outside: string;
let userData: string;

test.beforeEach(async () => {
  ({ folder, outside } = makeFolder());
  userData = tempDir('ac-e2e-links-data-');
  running = await launch(userData);
});
test.afterEach(async () => {
  await running.close();
  removeDir(userData);
  removeDir(path.dirname(folder));
});

test('Ctrl+click on file:line opens the file in the panel at that line', async () => {
  test.setTimeout(120_000);
  const { page } = running;
  const id = await createSession(page, 'Links', folder);
  const host = page.locator('.terminal-host.visible');
  await host.click();
  const { row } = await printLine(page, id, 'src/exemplo.ts:12:3 quebrou');

  // Without Ctrl the click only focuses the terminal.
  const point = await pointAt(page, host, row, 6);
  await page.mouse.click(point.x, point.y);
  await page.waitForTimeout(500);
  await expect(page.getByRole('region', { name: 'Mudanças' })).toHaveCount(0);

  await ctrlClick(page, point);
  const panel = page.getByRole('region', { name: 'Mudanças' });
  await expect(panel).toBeVisible();
  await expect(panel.getByRole('button', { name: 'Todos os arquivos' })).toHaveAttribute(
    'aria-pressed',
    'true',
  );
  const frame = page.frameLocator('[data-testid="diff-frame"]');
  await frame.locator('body[data-path="src/exemplo.ts"]').waitFor();
  await expect(frame.locator('body[data-reveal-line="12"]')).toHaveCount(1);
  // The tree shows where the file is.
  await expect(panel.locator('.file-item[data-path="src/exemplo.ts"]')).toBeVisible();

  // Another line of the same file, with the panel already open beside the terminal.
  await page.evaluate(async () => {
    const { layout } = await window.api.invoke('prefs:get');
    await window.api.invoke('prefs:set', { layout: { ...layout, panel: 'right' } });
  });
  await host.click();
  const second = await printLine(page, id, 'src/exemplo.ts(30,1): erro');
  await ctrlClick(page, await pointAt(page, host, second.row, 6));
  await expect(frame.locator('body[data-reveal-line="30"]')).toHaveCount(1);
});

test('what is outside the folder, or does not exist, is not a link', async () => {
  test.setTimeout(120_000);
  const { page } = running;
  const id = await createSession(page, 'Fora', folder);
  const host = page.locator('.terminal-host.visible');
  await host.click();
  const absolute = outside.replaceAll('\\', '/');

  for (const text of [`${absolute}:1`, '../fora.txt:1', 'src/nao-existe.ts:3']) {
    const { row } = await printLine(page, id, text);
    await ctrlClick(page, await pointAt(page, host, row, 4));
    await page.waitForTimeout(400);
    await expect(page.getByRole('region', { name: 'Mudanças' })).toHaveCount(0);
  }
});

test('the side terminal has the same links, and an address opens the browser', async () => {
  test.setTimeout(120_000);
  const { page, app } = running;
  await app.evaluate(({ shell }) => {
    (globalThis as { opened?: string[] }).opened = [];
    shell.openExternal = async (url: string) => {
      (globalThis as { opened?: string[] }).opened!.push(url);
    };
  });
  const id = await createSession(page, 'Aux', folder);
  await page.keyboard.press('Control+Shift+Quote');
  const pane = page.getByRole('region', { name: 'Terminal auxiliar' });
  const host = pane.locator('.terminal-host');
  await host.waitFor();
  await expect
    .poll(() => page.evaluate(() => document.activeElement?.closest('.aux-pane') !== null))
    .toBe(true);

  const address = await printLine(page, `${id}:aux`, 'http://localhost:3000/painel');
  await ctrlClick(page, await pointAt(page, host, address.row, 8));
  await expect
    .poll(() => app.evaluate(() => (globalThis as { opened?: string[] }).opened))
    .toEqual(['http://localhost:3000/painel']);

  const place = await printLine(page, `${id}:aux`, 'src/exemplo.ts:7');
  await ctrlClick(page, await pointAt(page, host, place.row, 6));
  const frame = page.frameLocator('[data-testid="diff-frame"]');
  await frame.locator('body[data-path="src/exemplo.ts"]').waitFor();
  await expect(frame.locator('body[data-reveal-line="7"]')).toHaveCount(1);
});

test('the output of the checks has the same links', async () => {
  test.setTimeout(120_000);
  const { page } = running;
  fs.writeFileSync(
    path.join(folder, 'falha.cjs'),
    "console.log('src/exemplo.ts:5:1 falhou');\nconsole.log('veja ../fora.txt:1');\nprocess.exit(1);\n",
  );
  const id = await createSession(page, 'Checks', folder);
  await page.evaluate(
    (sessionId) =>
      window.api.invoke('checks:configure', sessionId, [
        {
          id: 'falha',
          label: 'falha',
          command: 'node falha.cjs',
          timeoutSec: 60,
          onTurnEnd: false,
        },
      ]),
    id,
  );
  await page.evaluate((sessionId) => window.api.invoke('checks:run', sessionId), id);
  await page
    .locator('.session-header')
    .getByRole('button', { name: /^Verificações/ })
    .click();
  const dialog = page.getByRole('dialog', { name: 'Verificações' });
  const output = dialog.locator('.checks-output');
  await expect(output).toContainText('src/exemplo.ts:5:1 falhou', { timeout: 60_000 });
  // Only what exists inside the folder is a link.
  await expect(output.locator('.output-link')).toHaveCount(1);
  await expect(output.locator('.output-link')).toHaveText('src/exemplo.ts:5:1');

  await output.locator('.output-link').click({ modifiers: ['Control'] });
  await expect(dialog).toBeHidden();
  const frame = page.frameLocator('[data-testid="diff-frame"]');
  await frame.locator('body[data-path="src/exemplo.ts"]').waitFor();
  await expect(frame.locator('body[data-reveal-line="5"]')).toHaveCount(1);
});
