import path from 'node:path';
import { expect, test, type Page } from '@playwright/test';
import {
  createSession,
  launch,
  removeDir,
  ROOT,
  runInTerminal,
  screenText,
  setTitle,
  tempDir,
} from './harness';

const MENU = path.join(ROOT, 'tests', 'fixtures', 'permission-menu.cjs');

const row = (page: Page, id: string) => page.locator(`.session-item[data-session-id="${id}"]`);
const card = (page: Page, id: string) =>
  page.getByTestId('overview').locator(`.overview-card[data-session-id="${id}"]`);
const cardIds = (page: Page) =>
  page
    .getByTestId('overview')
    .locator('.overview-card')
    .evaluateAll((cards) => cards.map((c) => c.getAttribute('data-session-id')));

// Written so that the command line itself does not hold what it prints.
const echo = (word: string) =>
  process.platform === 'win32'
    ? `echo ^>${word}^<`
    : `echo '>${word.slice(0, -1)}''${word.slice(-1)}<'`;

test('the overview shows every session, filters them, puts the waiting first and opens one from the keyboard', async () => {
  test.setTimeout(240_000);
  const userData = tempDir('ac-e2e-overview-');
  const folders = [tempDir('ac-e2e-alfa-'), tempDir('ac-e2e-beta-'), tempDir('ac-e2e-gama-')];
  const running = await launch(userData);
  const { page } = running;
  try {
    const alfa = await createSession(page, 'Alfa', folders[0]!);
    await runInTerminal(page, alfa, echo('alfa-linha'), '>alfa-linha<');
    await setTitle(page, '◐ alfa');
    await expect(row(page, alfa)).toHaveAttribute('data-state', 'trabalhando', { timeout: 15_000 });
    await setTitle(page, '✳ pronto');
    await expect(row(page, alfa)).toHaveAttribute('data-state', 'terminou', { timeout: 15_000 });

    const beta = await createSession(page, 'Beta', folders[1]!);
    await setTitle(page, '◐ beta');
    await expect(row(page, beta)).toHaveAttribute('data-state', 'trabalhando', { timeout: 15_000 });

    // An agent that asks permission: it waits for the user.
    const gama = await createSession(page, 'Gama', folders[2]!);
    await page.locator('.terminal-host.visible').click();
    await page.keyboard.type(`node "${MENU}" Bash npm install`);
    await page.keyboard.press('Enter');
    await expect
      .poll(() => screenText(page, gama), { timeout: 20_000 })
      .toContain('Do you want to proceed?');
    await expect(row(page, gama)).toHaveAttribute('data-state', 'aguardando');

    await page.evaluate((ids) => window.api.invoke('groups:create', 'Backend', ids), [beta, gama]);
    await row(page, alfa).click();

    await page.keyboard.press('Control+Shift+O');
    const overview = page.getByTestId('overview');
    await expect(overview).toBeVisible();
    await expect(overview.locator('.overview-card')).toHaveCount(3);
    await expect(overview.getByRole('region', { name: 'Backend' })).toBeVisible();
    await expect(card(page, alfa).getByTestId('overview-lines')).toContainText('>alfa-linha<');
    await expect(card(page, gama).getByTestId('overview-state')).toContainText(
      /Aguardando você há \d+ s/,
    );
    await expect(card(page, gama).getByTestId('permission-ask')).toContainText('npm install');
    // Sorted by attention: in its group, the one waiting comes before the one working.
    expect(await cardIds(page)).toEqual([alfa, gama, beta]);
    await overview.getByLabel('Ordenar por atenção').uncheck();
    expect(await cardIds(page)).toEqual([alfa, beta, gama]);

    // The lines follow the terminal, without it being mounted in sight.
    await page.evaluate(
      ([id, line]) => window.api.invoke('terminal:input', id!, `${line}\r`),
      [alfa, echo('ao-vivo')],
    );
    await expect(card(page, alfa).getByTestId('overview-lines')).toContainText('>ao-vivo<', {
      timeout: 10_000,
    });

    await overview.getByRole('radio', { name: /Trabalhando/ }).click();
    expect(await cardIds(page)).toEqual([beta]);
    await overview.getByRole('radio', { name: /Aguardando você/ }).click();
    expect(await cardIds(page)).toEqual([gama]);
    await overview.getByRole('radio', { name: /Todas/ }).click();
    expect(await cardIds(page)).toEqual([alfa, beta, gama]);

    // The keyboard starts on the session in sight; the arrows walk the cards; Enter opens one.
    await card(page, alfa).focus();
    await expect(card(page, alfa)).toBeFocused();
    await page.keyboard.press('ArrowRight');
    await expect(card(page, beta)).toBeFocused();
    await page.keyboard.press('Enter');
    await expect(overview).toBeHidden();
    await expect(row(page, beta)).toHaveAttribute('aria-selected', 'true');

    // The button of the list opens it on the session in sight; Esc goes back to it.
    await page.getByTestId('overview-button').click();
    await expect(overview).toBeVisible();
    await expect(card(page, beta)).toBeFocused();
    await page.keyboard.press('Escape');
    await expect(overview).toBeHidden();
    await expect(row(page, beta)).toHaveAttribute('aria-selected', 'true');

    // The shortcut opens and closes it; a session picked in the list closes it too.
    await page.keyboard.press('Control+Shift+O');
    await expect(overview).toBeVisible();
    await page.keyboard.press('Control+Shift+O');
    await expect(overview).toBeHidden();
    await page.keyboard.press('Control+Shift+O');
    await row(page, gama).click();
    await expect(overview).toBeHidden();
    await expect(row(page, gama)).toHaveAttribute('aria-selected', 'true');
  } finally {
    await running.close();
    removeDir(userData);
    for (const folder of folders) removeDir(folder);
  }
});
