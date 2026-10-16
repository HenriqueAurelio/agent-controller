// The screens of sessions in a copy of the repository, to attach to the pull request, as in
// `evidences.spec.ts`:
//
//   EVIDENCES=1 npx playwright test --config tests/e2e/playwright.config.ts evidences-worktree.spec.ts
//
// `EVIDENCES_PHASE=antes`, run on a build of the code as it was, takes the "before" of each pair
// and leaves out the steps that did not exist yet.
import fs from 'node:fs';
import path from 'node:path';
import { expect, test } from '@playwright/test';
import { git, launch, makeRepo, removeDir, ROOT, tempDir } from './harness';

const PHASE = process.env.EVIDENCES_PHASE === 'antes' ? 'antes' : 'depois';
const AFTER = PHASE === 'depois';
const OUT = process.env.EVIDENCES_DIR || path.join(ROOT, 'evidences', 'images');

test.skip(process.env.EVIDENCES !== '1', 'só com EVIDENCES=1');

test('evidences: sessions in a copy of the repository', async () => {
  test.setTimeout(180_000);
  const userData = tempDir('ac-evid-data-');
  // Short, stable paths: they are in the pictures.
  const base = tempDir('ac-');
  const loja = path.join(base, 'loja');
  fs.renameSync(makeRepo(), loja);
  const copies = path.join(base, 'copias');

  const running = await launch(userData);
  const { page } = running;
  const shot = async (name: string) => {
    fs.mkdirSync(path.join(OUT, 'worktree-por-sessao'), { recursive: true });
    await page.waitForTimeout(700);
    await page.screenshot({ path: path.join(OUT, 'worktree-por-sessao', `${name}-${PHASE}.png`) });
  };
  const palette = async (option: string) => {
    await page.keyboard.press('Control+Shift+P');
    await page
      .getByRole('dialog', { name: 'Paleta de comandos' })
      .getByRole('option', { name: option })
      .click();
  };

  try {
    if (AFTER) {
      await page.evaluate(
        (folder) => window.api.invoke('worktrees:configure', { folder, setup: '' }),
        copies,
      );
    }

    // 1. A new session in a repository: the copy is offered, with its branch.
    await page.getByRole('button', { name: '+ Nova sessão' }).click();
    const dialog = page.getByRole('dialog', { name: 'Nova sessão' });
    await dialog.getByLabel('Pasta').fill(loja);
    await dialog.getByLabel('Nome').fill('Corrigir login');
    await dialog.getByRole('radio', { name: /Claude Code/ }).check();
    if (AFTER) {
      await dialog.getByLabel('Cópia isolada (git worktree)').check();
      await expect(dialog.getByLabel('Branch nova')).toHaveValue('ac/corrigir-login');
    } else {
      await page.waitForTimeout(600);
    }
    await shot('01-nova-sessao');

    // 2. The session, in its copy: the branch in the header.
    await dialog.getByRole('button', { name: 'Criar e iniciar' }).click();
    await expect(dialog).toBeHidden({ timeout: 30_000 });
    const cwd = await page.evaluate(
      async () => (await window.api.invoke('sessions:list')).sessions[0]!.cwd,
    );
    fs.writeFileSync(path.join(cwd, 'editado.ts'), 'export const valor = 2;\n');
    await shot('02-sessao');

    if (AFTER) {
      // 3. Everything the branch did since its base: a commit and what is not committed.
      fs.writeFileSync(path.join(cwd, 'login.ts'), 'export const entrar = () => true;\n');
      git(cwd, 'add', 'login.ts');
      git(cwd, '-c', 'user.email=e@x', '-c', 'user.name=E', 'commit', '-q', '-m', 'login');
      await page.keyboard.press('Control+Shift+G');
      await page
        .getByRole('region', { name: 'Mudanças' })
        .getByLabel('Comparar com')
        .selectOption({ label: 'A base da branch (main)' });
      await page.locator('.change-item', { hasText: 'login.ts' }).click();
      await page
        .frameLocator('[data-testid="diff-frame"]')
        .locator('.view-line', { hasText: 'entrar' })
        .first()
        .waitFor();
      await shot('03-comparar-com-a-base');
      await page.keyboard.press('Escape');
    }

    // 4. Closing: what happens to the copy, and why it cannot go yet.
    await palette('Fechar a sessão “Corrigir login”');
    const closing = page.getByRole('dialog', { name: 'Fechar sessão' });
    if (AFTER) await closing.getByTestId('worktree-pending').waitFor();
    await shot('04-fechar');
    await closing.getByRole('button', { name: 'Cancelar' }).click();

    // 5. Preferences: where the copies go, what prepares them, and the ones there are.
    await page.keyboard.press('Control+,');
    const prefs = page.getByRole('dialog', { name: 'Preferências' });
    if (AFTER) {
      await prefs.getByRole('tab', { name: 'Sessões' }).click();
      await prefs.locator('.worktree-copy').waitFor();
    }
    await shot('05-preferencias');
  } finally {
    await running.close();
    removeDir(userData);
    removeDir(base);
  }
});
