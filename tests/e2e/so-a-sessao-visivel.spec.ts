import { expect, test, type Page } from '@playwright/test';
import { createSession, launch, removeDir, screenText, tempDir } from './harness';

const host = (page: Page, sessionId: string) =>
  page.locator(`.terminal-host[data-session-id="${sessionId}"]`);

test('a session out of sight is not drawn, and shows what it wrote once opened again', async () => {
  test.setTimeout(120_000);
  const userData = tempDir('ac-e2e-visivel-');
  const folder = tempDir('ac-e2e-visivel-pasta-');
  const running = await launch(userData);
  const { page } = running;
  try {
    const first = await createSession(page, 'Primeira', folder);
    await page.locator('.terminal-host.visible').click();
    // Written in two parts, so the command line itself does not hold the text looked for.
    await page.keyboard.type(`node -e "setTimeout(()=>console.log('chegou'+'-depois'),3000)"`);
    await page.keyboard.press('Enter');

    // Another session takes the screen; the first stays mounted, out of sight.
    await createSession(page, 'Segunda', folder);
    await expect(host(page, first)).toHaveCount(1);
    await expect(host(page, first)).not.toHaveClass(/visible/);
    await expect
      .poll(() => screenText(page, first), { timeout: 20_000 })
      .toContain('chegou-depois');
    // The program wrote; the terminal out of sight did not read it.
    await expect(host(page, first).locator('.xterm-rows')).not.toContainText('chegou-depois');

    await page.locator('.session-item', { hasText: 'Primeira' }).click();
    await expect(host(page, first)).toHaveClass(/visible/);
    await expect(host(page, first).locator('.xterm-rows')).toContainText('chegou-depois');
    await expect(host(page, first)).toHaveAttribute('data-resync-ms', /\d+/);
  } finally {
    await running.close();
    removeDir(userData);
    removeDir(folder);
  }
});
