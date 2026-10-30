// What a program receives from a multi-line paste, photographed before and after the ConPTY
// change. It only runs when asked:
//
//   EVIDENCES=1 npx playwright test --config tests/e2e/playwright.config.ts evidences-conpty.spec.ts
//
// `EVIDENCES_PHASE=antes`, run on a build of the code as it was, takes the "before".
import fs from 'node:fs';
import path from 'node:path';
import { expect, test } from '@playwright/test';
import { createSession, launch, removeDir, ROOT, screenText, tempDir } from './harness';

const PHASE = process.env.EVIDENCES_PHASE === 'antes' ? 'antes' : 'depois';
const OUT = path.join(
  process.env.EVIDENCES_DIR || path.join(ROOT, 'evidences', 'images'),
  'conpty',
);
const SHOW_INPUT = path.join(ROOT, 'tests', 'fixtures', 'show-input.cjs');

test.skip(process.env.EVIDENCES !== '1', 'só com EVIDENCES=1');

test('evidences: a multi-line paste as the program receives it', async () => {
  test.setTimeout(120_000);
  const userData = tempDir('ac-evid-data-');
  const work = tempDir('ac-');
  const running = await launch(userData);
  const { page, app } = running;
  try {
    const id = await createSession(page, 'Colagem', work);
    await page.locator('.terminal-host.visible').click();
    await page.keyboard.type(`node "${SHOW_INPUT}"`);
    await page.keyboard.press('Enter');
    await expect.poll(() => screenText(page, id), { timeout: 20_000 }).toContain('pronto');
    await app.evaluate(({ clipboard }) =>
      clipboard.writeText('corrija o teste\nsem mudar a API\ne rode o lint'),
    );
    await page.keyboard.press(process.platform === 'win32' ? 'Control+V' : 'Control+Shift+V');
    await expect.poll(() => screenText(page, id), { timeout: 10_000 }).toContain('recebido');
    await page.waitForTimeout(1000);
    fs.mkdirSync(OUT, { recursive: true });
    await page.screenshot({ path: path.join(OUT, `01-colagem-de-varias-linhas-${PHASE}.png`) });
    await page.keyboard.press('q');
  } finally {
    await running.close();
    removeDir(userData);
    removeDir(work);
  }
});
