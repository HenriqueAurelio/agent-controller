// The session resumes the conversation of its agent after the app is opened again (ADR 0030).
// The tests run a shell in place of the agent: what is checked is the app's side (the id kept,
// the resume asked for, the notice), not the agent's.
import fs from 'node:fs';
import path from 'node:path';
import { expect, test, type Page } from '@playwright/test';
import { createSession, launch, removeDir, ROOT, screenText, tempDir } from './harness';

const PHASE = process.env.EVIDENCES_PHASE === 'antes' ? 'antes' : 'depois';
const OUT = process.env.EVIDENCES_DIR || path.join(ROOT, 'evidences', 'images');
const FOLDER = 'retomar-conversa';

const conversationOf = async (page: Page, id: string) =>
  (await page.evaluate(() => window.api.invoke('sessions:list'))).sessions.find((s) => s.id === id)
    ?.conversationId;

test('a session opened again resumes its conversation; "New conversation" starts over', async () => {
  test.setTimeout(120_000);
  const userData = tempDir('ac-e2e-resume-');
  const folder = tempDir('ac-e2e-resume-folder-');
  let running = await launch(userData);
  try {
    const id = await createSession(running.page, 'Login', folder);
    const first = await conversationOf(running.page, id);
    if (PHASE === 'depois') expect(first).toMatch(/^[0-9a-f-]{36}$/);
    await running.close();

    // Opened again: starting the session resumes the same conversation, and says so.
    running = await launch(userData);
    const { page } = running;
    await page.locator('.session-item', { hasText: 'Login' }).click();
    await page.locator('.terminal-host.visible').click();
    await page.keyboard.press('Enter');
    if (PHASE === 'depois') {
      await expect
        .poll(async () => (await screenText(page, id)).replace(/\s+/g, ' '), { timeout: 15_000 })
        .toContain('[Retomando a conversa anterior.]');
      expect(await conversationOf(page, id)).toBe(first);
    } else {
      await page.waitForTimeout(2500);
    }
    if (process.env.EVIDENCES === '1') {
      fs.mkdirSync(path.join(OUT, FOLDER), { recursive: true });
      await page.waitForTimeout(800);
      await page.screenshot({ path: path.join(OUT, FOLDER, `01-reabrir-o-app-${PHASE}.png`) });
    }
    if (PHASE === 'antes') return;

    // "New conversation" forgets it: the agent starts over with another id.
    await page.keyboard.press('Control+Shift+P');
    await page
      .getByRole('dialog', { name: 'Paleta de comandos' })
      .getByRole('option', { name: 'Nova conversa em “Login”' })
      .click();
    await expect.poll(() => conversationOf(page, id), { timeout: 15_000 }).not.toBe(first);
    expect(await conversationOf(page, id)).toMatch(/^[0-9a-f-]{36}$/);
  } finally {
    await running.close();
    removeDir(userData);
    removeDir(folder);
  }
});
