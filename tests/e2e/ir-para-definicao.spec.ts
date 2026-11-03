// F12 in the editor of the panel goes to where the name under the cursor is declared.
import fs from 'node:fs';
import path from 'node:path';
import { expect, test } from '@playwright/test';
import { createSession, git, launch, makeRepo, removeDir, ROOT, tempDir } from './harness';

test('F12 on a name opens the file where it is declared, on its line', async () => {
  test.setTimeout(120_000);
  const userData = tempDir('ac-e2e-definition-');
  const repo = makeRepo();
  fs.mkdirSync(path.join(repo, 'src', 'core'), { recursive: true });
  fs.writeFileSync(
    path.join(repo, 'src', 'core', 'preco.ts'),
    'export const imposto = 0.1;\n\nexport function calcularPreco(base: number): number {\n  return base * (1 + imposto);\n}\n',
  );
  git(repo, 'add', '-A');
  git(repo, 'commit', '-q', '-m', 'preço');
  // The agent uses it in a file of its turn.
  fs.writeFileSync(
    path.join(repo, 'src', 'app.ts'),
    "import { calcularPreco } from './core/preco';\nconsole.log(calcularPreco(10));\n",
  );
  const running = await launch(userData);
  const { page } = running;
  try {
    await createSession(page, 'Projeto', repo);
    await page.keyboard.press('Control+Shift+G');
    const panel = page.locator('.changes-panel');
    await panel.locator('.change-item[data-path="src/app.ts"]').click();
    const frame = page.frameLocator('[data-testid="diff-frame"]');
    await frame.locator('body[data-path="src/app.ts"]').waitFor();
    // The cursor on the name, in the line that uses it.
    const line = frame.locator('.editor.modified .view-line', { hasText: 'console.log' });
    await line.locator('span', { hasText: 'calcularPreco' }).first().click();
    await page.keyboard.press('F12');
    await expect(frame.locator('body[data-reveal-path="src/core/preco.ts"]')).toHaveCount(1, {
      timeout: 20_000,
    });
    await expect(frame.locator('body[data-reveal-line="3"]')).toHaveCount(1);
    if (process.env.EVIDENCES === '1') {
      const out = process.env.EVIDENCES_DIR || path.join(ROOT, 'evidences', 'images');
      fs.mkdirSync(path.join(out, 'ir-para-definicao'), { recursive: true });
      await page.waitForTimeout(800);
      await page.screenshot({ path: path.join(out, 'ir-para-definicao', '01-f12-depois.png') });
    }
  } finally {
    await running.close();
    removeDir(userData);
    removeDir(repo);
  }
});
