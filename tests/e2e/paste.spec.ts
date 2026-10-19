import { expect, test } from '@playwright/test';
import { createSession, launch, removeDir, tempDir } from './harness';

test('a large terminal paste has a compact progress notice', async () => {
  const userData = tempDir('ac-e2e-paste-');
  const folder = tempDir('ac-e2e-paste-work-');
  const running = await launch(userData);
  try {
    const { page } = running;
    await createSession(page, 'Colagem', folder);

    await page.locator('.terminal-host.visible').evaluate((host) => {
      host.dispatchEvent(
        new CustomEvent('aurelium:large-paste', {
          bubbles: true,
          detail: { lines: 42, characters: 8_120 },
        }),
      );
    });

    const notice = page.getByTestId('terminal-paste-notice');
    await expect(notice).toHaveText('Colando 42 linhas (8120 caracteres)');
    await expect(notice).toBeHidden({ timeout: 4_000 });
  } finally {
    await running.close();
    removeDir(userData);
    removeDir(folder);
  }
});
