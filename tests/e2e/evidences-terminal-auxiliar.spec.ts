// The screens of the side terminal, to attach to the pull request, as in `evidences.spec.ts`:
//
//   EVIDENCES=1 npx playwright test --config tests/e2e/playwright.config.ts evidences-terminal-auxiliar.spec.ts
//
// `EVIDENCES_PHASE=antes`, run on a build of the code as it was, takes the "before" of each pair
// and leaves out the steps that did not exist yet.
import fs from 'node:fs';
import path from 'node:path';
import { expect, test } from '@playwright/test';
import { createSession, launch, removeDir, ROOT, screenText, tempDir } from './harness';

const PHASE = process.env.EVIDENCES_PHASE === 'antes' ? 'antes' : 'depois';
const AFTER = PHASE === 'depois';
const OUT = process.env.EVIDENCES_DIR || path.join(ROOT, 'evidences', 'images');

test.skip(process.env.EVIDENCES !== '1', 'só com EVIDENCES=1');

test('evidences: side terminal', async () => {
  test.setTimeout(180_000);
  const userData = tempDir('ac-evid-data-');
  // Short, stable path: it is in the pictures.
  const base = tempDir('ac-');
  const api = path.join(base, 'api');
  fs.mkdirSync(api);
  fs.writeFileSync(path.join(api, 'servidor.js'), 'console.log("ouvindo na porta 3000");\n');

  const running = await launch(userData);
  const { page } = running;
  const shot = async (name: string) => {
    fs.mkdirSync(path.join(OUT, 'terminal-auxiliar'), { recursive: true });
    await page.waitForTimeout(700);
    await page.screenshot({ path: path.join(OUT, 'terminal-auxiliar', `${name}-${PHASE}.png`) });
  };
  const type = async (id: string, line: string, expected: string) => {
    await page.keyboard.type(line);
    await page.keyboard.press('Enter');
    await expect.poll(() => screenText(page, id), { timeout: 20_000 }).toContain(expected);
  };

  try {
    const id = await createSession(page, 'API', api);
    await page.locator('.terminal-host.visible').click();
    await type(id, 'echo o agente trabalha aqui', 'o agente trabalha aqui');

    // 1. The session: with the button of the side terminal in the header, after.
    await shot('01-sessao');

    if (AFTER) {
      // 2. Open beneath the agent, running something of its own.
      await page.keyboard.press('Control+Shift+Quote');
      await page.locator('.aux-pane .terminal-host').waitFor();
      await expect
        .poll(() => page.evaluate(() => document.activeElement?.closest('.aux-pane') !== null))
        .toBe(true);
      await type(`${id}:aux`, 'node servidor.js', 'ouvindo na porta 3000');
      await shot('02-auxiliar-embaixo');

      // 3. To the right, as the layout allows.
      await page.evaluate(() =>
        window.api.invoke('prefs:set', {
          layout: { sessions: 'left', panel: 'cover', files: 'left', aux: 'right' },
        }),
      );
      await page.waitForTimeout(500);
      await shot('03-auxiliar-a-direita');
      await page.keyboard.press('Control+Shift+Quote');
      await page.locator('.aux-pane').waitFor({ state: 'detached' });
    }

    // 4. Preferences → Layout: the place of the side terminal, after. With the panel beside the
    // terminal, so the miniature shows the terminals.
    await page.evaluate(() =>
      window.api.invoke('prefs:set', {
        layout: { sessions: 'left', panel: 'bottom', files: 'left', aux: 'right' },
      }),
    );
    await page.keyboard.press('Control+,');
    const prefs = page.getByRole('dialog', { name: 'Preferências' });
    await prefs.getByRole('tab', { name: 'Layout' }).click();
    await shot('04-layout');
  } finally {
    await running.close();
    removeDir(userData);
    removeDir(base);
  }
});
