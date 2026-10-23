// Renaming a session by double click and by the context menu, photographed before and after.
// It only runs when asked:
//
//   EVIDENCES=1 npx playwright test --config tests/e2e/playwright.config.ts evidences-renomear-sessao.spec.ts
//
// `EVIDENCES_PHASE=antes`, run on a build of the code as it was, takes the "before" of each pair.
import fs from 'node:fs';
import path from 'node:path';
import { test } from '@playwright/test';
import { createSession, launch, removeDir, ROOT, tempDir } from './harness';

const PHASE = process.env.EVIDENCES_PHASE === 'antes' ? 'antes' : 'depois';
const OUT = path.join(
  process.env.EVIDENCES_DIR || path.join(ROOT, 'evidences', 'images'),
  'renomear-sessao',
);

test.skip(process.env.EVIDENCES !== '1', 'só com EVIDENCES=1');

test('evidences: rename a session', async () => {
  test.setTimeout(120_000);
  const userData = tempDir('ac-evid-data-');
  const work = tempDir('ac-');
  const running = await launch(userData);
  const { page } = running;
  const shot = async (name: string) => {
    fs.mkdirSync(OUT, { recursive: true });
    await page.waitForTimeout(700);
    await page.screenshot({ path: path.join(OUT, `${name}-${PHASE}.png`) });
  };
  const item = (name: string) => page.locator('.session-item', { hasText: name });

  try {
    await createSession(page, 'API', work, 'Codex');
    await createSession(page, 'Minha sessão', work);

    // 1. Double click on the name: the field has to stay open.
    await item('Minha sessão').locator('.session-name').dblclick();
    await shot('01-duplo-clique');
    await page.keyboard.press('Escape');

    // 2. Right click on the session: the menu offers renaming.
    await item('Minha sessão').click({ button: 'right' });
    await shot('02-menu-botao-direito');
    const rename = page.getByRole('menuitem', { name: 'Renomear' });
    if (await rename.count()) {
      await rename.click();
      await page.keyboard.type('Pagamentos');
      await page.keyboard.press('Enter');
    } else {
      await page.mouse.click(5, 5);
      // The only way left before: double click, and try to type before the field closes.
      await item('Minha sessão').locator('.session-name').dblclick();
      await page.keyboard.type('Pagamentos');
      await page.keyboard.press('Enter');
    }
    // 3. The name the user chose, or what is left of it.
    await shot('03-nome-escolhido');
  } finally {
    await running.close();
    removeDir(userData);
    removeDir(work);
  }
});
