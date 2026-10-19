import fs from 'node:fs';
import path from 'node:path';
import { expect, test } from '@playwright/test';
import { launch, removeDir, ROOT, tempDir } from './harness';

const PHASE = process.env.EVIDENCES_PHASE === 'antes' ? 'antes' : 'depois';
const OUT = process.env.EVIDENCES_DIR || path.join(ROOT, 'evidences', 'images');
const expectedTitle = PHASE === 'antes' ? 'Agent Controller' : 'Aurelium';
const expectedAppName = PHASE === 'antes' ? 'Agent Controller' : 'Aurelium';

test('shows the product name in the application and window title', async () => {
  const userData = tempDir('ac-brand-data-');
  const running = await launch(userData);

  try {
    await expect(running.page).toHaveTitle(expectedTitle);
    await expect(running.app.evaluate(({ app }) => app.getName())).resolves.toBe(expectedAppName);

    if (process.env.EVIDENCES === '1') {
      const directory = path.join(OUT, 'identidade');
      fs.mkdirSync(directory, { recursive: true });
      await running.page.waitForTimeout(700);
      await running.page.screenshot({ path: path.join(directory, `01-janela-${PHASE}.png`) });
    }
  } finally {
    await running.close();
    removeDir(userData);
  }
});
