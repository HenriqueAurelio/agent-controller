import fs from 'node:fs';
import path from 'node:path';
import { expect, test, type Page } from '@playwright/test';
import { createSession, launch, removeDir, ROOT, screenText, tempDir } from './harness';

// A shell command that draws a permission menu like Claude Code's, calls the hook and prints the
// key it gets: the "agent" of these tests.
const MENU = path.join(ROOT, 'tests', 'fixtures', 'permission-menu.cjs');

/** Asks permission in the terminal in sight, and waits for the request to reach the list. */
async function ask(page: Page, sessionId: string, args: string) {
  await page.locator('.terminal-host.visible').click();
  await page.keyboard.type(`node "${MENU}" ${args}`);
  await page.keyboard.press('Enter');
  await expect(row(page, sessionId).getByTestId('permission-ask')).toBeVisible({ timeout: 20_000 });
}

const row = (page: Page, sessionId: string) =>
  page.locator(`.session-item[data-session-id="${sessionId}"]`);

const answered = (page: Page, sessionId: string, key: string) =>
  expect.poll(() => screenText(page, sessionId), { timeout: 15_000 }).toContain(`resposta: ${key}`);

test('two requests answered from the list, one allowed and one denied, without opening either', async () => {
  test.setTimeout(180_000);
  const userData = tempDir('ac-e2e-perm-');
  const folders = ['api', 'web', 'docs'].map((name) => tempDir(`ac-e2e-${name}-`));
  const running = await launch(userData);
  const { page } = running;
  try {
    const api = await createSession(page, 'API', folders[0]!);
    await ask(page, api, 'Bash npm install');
    const web = await createSession(page, 'Web', folders[1]!);
    await ask(page, web, 'Edit src/app.ts');
    const docs = await createSession(page, 'Docs', folders[2]!);

    // What is asked, where the user is looking.
    await expect(row(page, api).locator('.permission-tool')).toHaveText('Bash');
    await expect(row(page, api).locator('.permission-target')).toHaveText('npm install');
    await expect(row(page, web).locator('.permission-tool')).toHaveText('Edit');
    await expect(row(page, web).locator('.permission-target')).toHaveText('src/app.ts');
    await expect(row(page, api).getByRole('button', { name: /^Permitir sempre/ })).toBeVisible();

    await row(page, api).getByRole('button', { name: 'Permitir o pedido de API' }).click();
    await row(page, web).getByRole('button', { name: 'Negar o pedido de Web' }).click();
    await answered(page, api, '1');
    await answered(page, web, 'esc');
    // Neither was opened: the session in sight is still the one it was.
    await expect(row(page, docs)).toHaveAttribute('aria-selected', 'true');
    await expect(page.getByTestId('permission-ask')).toHaveCount(0);

    // Alt+Y answers the session in sight, from the terminal.
    await ask(page, docs, 'Bash npm test');
    await page.locator('.terminal-host.visible').click();
    await page.keyboard.press('Alt+KeyY');
    await answered(page, docs, '1');
    await expect(row(page, docs).getByTestId('permission-ask')).toHaveCount(0);
  } finally {
    await running.close();
    removeDir(userData);
    for (const folder of folders) removeDir(folder);
  }
});

test('a request that changed before the click gets nothing, and the list says so', async () => {
  test.setTimeout(120_000);
  const userData = tempDir('ac-e2e-perm-');
  const folder = tempDir('ac-e2e-api-');
  const running = await launch(userData);
  const { page } = running;
  try {
    const api = await createSession(page, 'API', folder);
    await ask(page, api, 'Bash npm install');
    // The agent moves on by itself: its menu leaves the screen.
    fs.writeFileSync(path.join(folder, 'limpar'), '');
    await expect
      .poll(() => screenText(page, api), { timeout: 15_000 })
      .toContain('o agente seguiu sozinho');

    await row(page, api).getByRole('button', { name: 'Permitir o pedido de API' }).click();
    await expect(row(page, api).getByTestId('permission-stale')).toHaveText(
      'O pedido mudou; abra a sessão',
    );
    await expect(row(page, api).getByTestId('permission-ask')).toHaveCount(0);
    await page.waitForTimeout(500);
    expect(await screenText(page, api)).not.toContain('resposta');

    // With the buttons turned off, the request is still told, with no way to answer it there.
    await page.evaluate(() => window.api.invoke('prefs:set', { permissionButtons: false }));
    await page.locator('.terminal-host.visible').click();
    await page.keyboard.type('x');
    await answered(page, api, 'x');
    fs.rmSync(path.join(folder, 'limpar'));
    // What is typed before the fake agent leaves would go to it, not to the shell.
    await page.waitForTimeout(1000);
    await ask(page, api, 'Bash npm ci');
    await expect(row(page, api).getByRole('button', { name: /pedido de API/ })).toHaveCount(0);
    // And Alt+Y is the terminal's again.
    await page.locator('.terminal-host.visible').click();
    await page.keyboard.press('Alt+KeyY');
    await expect
      .poll(async () => (await screenText(page, api)).match(/resposta:/g)?.length)
      .toBe(2);
    await expect(row(page, api).getByTestId('permission-ask')).toBeVisible();
  } finally {
    await running.close();
    removeDir(userData);
    removeDir(folder);
  }
});
