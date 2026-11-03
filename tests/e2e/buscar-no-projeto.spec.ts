// Searching the project from the panel: results by file, opened on their line, sent to the agent.
import fs from 'node:fs';
import path from 'node:path';
import { expect, test } from '@playwright/test';
import { createSession, git, launch, makeRepo, removeDir, ROOT, tempDir } from './harness';

const PHASE = process.env.EVIDENCES_PHASE === 'antes' ? 'antes' : 'depois';

test('Ctrl+Shift+F searches the project, opens a result on its line and sends them to the agent', async () => {
  test.setTimeout(120_000);
  const userData = tempDir('ac-e2e-search-');
  const repo = makeRepo();
  fs.mkdirSync(path.join(repo, 'src', 'core'), { recursive: true });
  const body = (n: number, extra: string) =>
    Array.from({ length: 30 }, (_, i) => (i === n ? extra : `export const v${i} = ${i};`)).join(
      '\n',
    );
  fs.writeFileSync(path.join(repo, 'src', 'core', 'pedido.ts'), body(12, "console.log('debug');"));
  fs.writeFileSync(path.join(repo, 'src', 'core', 'cliente.ts'), body(4, "console.log('x');"));
  fs.writeFileSync(path.join(repo, 'src', 'core', 'cliente.test.ts'), "console.log('teste');\n");
  git(repo, 'add', '-A');
  git(repo, 'commit', '-q', '-m', 'projeto');
  const running = await launch(userData);
  const { page } = running;
  const shot = async (name: string) => {
    if (process.env.EVIDENCES !== '1') return;
    const out = process.env.EVIDENCES_DIR || path.join(ROOT, 'evidences', 'images');
    fs.mkdirSync(path.join(out, 'buscar-no-projeto'), { recursive: true });
    await page.waitForTimeout(800);
    await page.screenshot({ path: path.join(out, 'buscar-no-projeto', `${name}-${PHASE}.png`) });
  };
  try {
    await createSession(page, 'Projeto', repo);
    if (PHASE === 'antes') {
      // Before, the closest was the tree of all files, where nothing searched the text.
      await page.keyboard.press('Control+Shift+E');
      await expect(page.locator('.changes-panel')).toBeVisible();
      await shot('01-buscar-console-log');
      return;
    }
    await page.keyboard.press('Control+Shift+F');
    const list = page.getByTestId('search-list');
    await expect(list).toBeVisible();
    await list.getByTestId('search-text').fill('console.log');
    await list.getByLabel('Excluir (*.test.ts)').fill('*.test.ts');
    await list.getByTestId('search-text').press('Enter');
    await expect(list.getByTestId('search-count')).toHaveText('3 resultados em 3 arquivos');

    // A click opens the file on its line.
    await list.getByTestId('search-row').filter({ hasText: 'debug' }).click();
    const frame = page.frameLocator('[data-testid="diff-frame"]');
    await expect(frame.locator('body[data-reveal-line="13"]')).toHaveCount(1, { timeout: 20_000 });
    await expect(frame.locator('body[data-reveal-path="src/core/pedido.ts"]')).toHaveCount(1);
    await shot('01-buscar-console-log');

    // The results go to the agent as file:line: text.
    await list.getByTestId('search-send').click();
    const prompt = page.getByRole('dialog', { name: 'Enviar prompt' });
    const text = prompt.getByLabel('Texto a enviar');
    await expect(text).toContainText('src/core/pedido.ts:13: console.log');
    await expect(text).toContainText('src/core/cliente.ts:5: console.log');
    await expect(text).not.toContainText('cliente.test.ts');
  } finally {
    await running.close();
    removeDir(userData);
    removeDir(repo);
  }
});
