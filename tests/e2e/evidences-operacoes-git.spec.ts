// The screens of git in the changes panel, to attach to the pull request, as in
// `evidences.spec.ts`:
//
//   EVIDENCES=1 npx playwright test --config tests/e2e/playwright.config.ts evidences-operacoes-git.spec.ts
//
// `EVIDENCES_PHASE=antes`, run on a build of the code as it was, takes the "before" of each pair
// and leaves out the steps that did not exist yet.
import fs from 'node:fs';
import path from 'node:path';
import { expect, test } from '@playwright/test';
import { createSession, launch, makeRepo, removeDir, ROOT, tempDir } from './harness';

const PHASE = process.env.EVIDENCES_PHASE === 'antes' ? 'antes' : 'depois';
const AFTER = PHASE === 'depois';
const OUT = process.env.EVIDENCES_DIR || path.join(ROOT, 'evidences', 'images');

test.skip(process.env.EVIDENCES !== '1', 'só com EVIDENCES=1');

test('evidences: git in the changes panel', async () => {
  test.setTimeout(180_000);
  const userData = tempDir('ac-evid-data-');
  const base = tempDir('ac-');
  const loja = path.join(base, 'loja');
  fs.renameSync(makeRepo(), loja);
  fs.writeFileSync(path.join(loja, 'editado.ts'), 'export const valor = 2;\n');
  fs.writeFileSync(path.join(loja, 'velho.txt'), 'linha um\nlinha 2 mudou\nlinha três\n');
  fs.writeFileSync(path.join(loja, 'novo.txt'), 'novo\n');

  const running = await launch(userData);
  const { page } = running;
  const shot = async (name: string) => {
    fs.mkdirSync(path.join(OUT, 'operacoes-git'), { recursive: true });
    await page.waitForTimeout(700);
    await page.screenshot({ path: path.join(OUT, 'operacoes-git', `${name}-${PHASE}.png`) });
  };

  try {
    await createSession(page, 'Loja', loja);
    await page.keyboard.press('Control+Shift+G');
    const panel = page.getByRole('region', { name: 'Mudanças' });
    await panel.locator('.change-item', { hasText: 'editado.ts' }).click();
    await page
      .frameLocator('[data-testid="diff-frame"]')
      .locator('.view-line', { hasText: 'valor' })
      .first()
      .waitFor();

    // 1. The list of the panel: a box per file, after.
    await shot('01-lista');

    if (AFTER) {
      // 2. Two of three marked: the list split, and what goes into the commit.
      await panel.getByLabel('Marcar editado.ts para o commit').check();
      await panel.getByLabel('Marcar novo.txt para o commit').check();
      const bar = panel.getByRole('group', { name: 'Commit' });
      await expect(bar.getByTestId('commit-going-in')).toContainText('(2)');
      await bar.getByLabel('Mensagem do commit').fill('Valor novo e arquivo novo');
      await shot('02-marcados');

      // 3. Committed.
      await bar.getByRole('button', { name: 'Commit' }).click();
      await expect(panel.getByRole('status')).toContainText('feito');
      await shot('03-commit');

      // 4. The third one discarded, with undo at hand.
      page.once('dialog', (d) => void d.accept());
      await panel.locator('.change-item', { hasText: 'velho.txt' }).hover();
      await panel.getByRole('button', { name: 'Descartar as mudanças de velho.txt' }).click();
      await expect(panel.getByRole('status')).toContainText('descartadas');
      await shot('04-descartado');
    }
  } finally {
    await running.close();
    removeDir(userData);
    removeDir(base);
  }
});
