// Stacked work: a copy started from the branch of another copy, which brings in what moved there.
import fs from 'node:fs';
import path from 'node:path';
import { expect, test, type Page } from '@playwright/test';
import { git, launch, makeRepo, removeDir, ROOT, tempDir } from './harness';

const PHASE = process.env.EVIDENCES_PHASE === 'antes' ? 'antes' : 'depois';

/** A session in a copy, from the base picked by its label in the list. */
async function stackedSession(
  page: Page,
  name: string,
  repo: string,
  branch: string,
  base?: RegExp,
) {
  await page.getByRole('button', { name: '+ Nova sessão' }).click();
  const dialog = page.getByRole('dialog', { name: 'Nova sessão' });
  await dialog.getByLabel('Pasta').fill(repo);
  await dialog.getByLabel('Nome').fill(name);
  await dialog.getByRole('radio', { name: /Claude Code/ }).check();
  await dialog.getByLabel('Cópia isolada (git worktree)').check();
  await dialog.getByLabel('Branch nova').fill(branch);
  if (base) {
    const select = dialog.getByLabel('A partir de');
    const label = await select.locator('option').filter({ hasText: base }).first().textContent();
    await select.selectOption({ label: label! });
  }
  if (process.env.EVIDENCES === '1' && base) {
    const out = process.env.EVIDENCES_DIR || path.join(ROOT, 'evidences', 'images');
    fs.mkdirSync(path.join(out, 'features-empilhadas'), { recursive: true });
    await dialog.getByLabel('A partir de').focus();
    await page.waitForTimeout(500);
    await page.screenshot({
      path: path.join(out, 'features-empilhadas', `01-nova-copia-sobre-outra-${PHASE}.png`),
    });
  }
  await dialog.getByRole('button', { name: 'Criar e iniciar' }).click();
  await expect(dialog).toBeHidden({ timeout: 30_000 });
  const item = page.locator('.session-item', { hasText: name });
  const id = (await item.getAttribute('data-session-id'))!;
  const sessions = await page.evaluate(() => window.api.invoke('sessions:list'));
  return sessions.sessions.find((s) => s.id === id)!.cwd;
}

test('a copy stacked on another one knows it, sees when the lower one moves, and brings it in', async () => {
  test.setTimeout(180_000);
  const dir = tempDir('ac-e2e-stack-');
  const userData = tempDir('ac-e2e-stack-data-');
  const repo = makeRepo();
  const running = await launch(userData);
  const { page } = running;
  try {
    await page.evaluate(
      (folder) => window.api.invoke('worktrees:configure', { folder, setup: '' }),
      path.join(dir, 'copias'),
    );
    const lower = await stackedSession(page, 'Modelo', repo, 'ac/modelo');
    fs.writeFileSync(path.join(lower, 'modelo.ts'), 'export interface Pedido {}\n');
    git(lower, 'add', '-A');
    git(lower, 'commit', '-q', '-m', 'Modelo do pedido');

    // The list names the branch of the other copy.
    const upper = await stackedSession(page, 'Tela', repo, 'ac/tela', /^ac\/modelo/);
    if (PHASE === 'antes') return;
    expect(fs.existsSync(path.join(upper, 'modelo.ts'))).toBe(true);

    // The lower one moves on: the upper one says so, and brings it in.
    fs.writeFileSync(path.join(lower, 'modelo.ts'), 'export interface Pedido { id: string }\n');
    git(lower, 'commit', '-q', '-am', 'Pedido com id');
    await page.getByTestId('branch-button').click();
    const dialog = page.locator('.branch-dialog');
    await expect(dialog.getByTestId('branch-stacked')).toContainText('cópia de “Modelo”');
    await expect(dialog.getByTestId('branch-behind')).toHaveText(
      'ac/modelo tem 1 commits que esta cópia ainda não tem.',
    );
    if (process.env.EVIDENCES === '1') {
      const out = process.env.EVIDENCES_DIR || path.join(ROOT, 'evidences', 'images');
      await page.waitForTimeout(500);
      await page.screenshot({
        path: path.join(out, 'features-empilhadas', '02-a-de-baixo-andou-depois.png'),
      });
    }
    await dialog.getByTestId('branch-update').click();
    await expect(dialog.getByTestId('branch-update-result')).toContainText('entrou na cópia');
    expect(fs.readFileSync(path.join(upper, 'modelo.ts'), 'utf8')).toContain('id: string');
    await expect(dialog.getByTestId('branch-behind')).toHaveCount(0);
  } finally {
    await running.close();
    removeDir(userData);
    removeDir(repo);
    removeDir(dir);
  }
});
