import path from 'node:path';
import { expect, test } from '@playwright/test';
import { createSession, launch, removeDir, ROOT, screenText, tempDir } from './harness';

const SHOW_INPUT = path.join(ROOT, 'tests', 'fixtures', 'show-input.cjs');

// A program that turned bracketed paste on gets the paste between its markers, as in any other
// terminal: that is what tells it a line break inside the text from an Enter. The ConPTY built
// into Windows 10 dropped the markers; the one shipped with node-pty keeps them.
test('a multi-line paste reaches the program between the bracketed paste markers', async () => {
  const userData = tempDir('ac-e2e-conpty-');
  const work = tempDir('ac-e2e-conpty-work-');
  const running = await launch(userData);
  const { page, app } = running;
  try {
    const id = await createSession(page, 'Colagem', work);
    await page.locator('.terminal-host.visible').click();
    await page.keyboard.type(`"${process.execPath}" "${SHOW_INPUT}"`);
    await page.keyboard.press('Enter');
    await expect.poll(() => screenText(page, id), { timeout: 20_000 }).toContain('pronto');

    await app.evaluate(({ clipboard }) => clipboard.writeText('linha um\nlinha dois'));
    await page.keyboard.press(process.platform === 'win32' ? 'Control+V' : 'Control+Shift+V');
    await expect
      .poll(async () => (await screenText(page, id)).replace(/\r?\n/g, ''), { timeout: 10_000 })
      .toContain('recebido');
    await page.waitForTimeout(500);
    const screen = (await screenText(page, id)).replace(/\r?\n/g, '');
    expect(screen).toContain('\\u001b[200~linha um');
    expect(screen).toContain('linha dois\\u001b[201~');
    await page.keyboard.press('q');
  } finally {
    await running.close();
    removeDir(userData);
    removeDir(work);
  }
});
