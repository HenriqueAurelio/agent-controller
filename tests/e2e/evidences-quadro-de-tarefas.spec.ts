// The screens of the task board, to attach to the pull request, as in `evidences.spec.ts`:
//
//   EVIDENCES=1 npx playwright test --config tests/e2e/playwright.config.ts evidences-quadro-de-tarefas.spec.ts
//
// `EVIDENCES_PHASE=antes`, run on a build of the code as it was, takes the "before" of each pair:
// the same repository and the same three pieces of work, as sessions made by hand, with the list of
// tasks somewhere else.
import fs from 'node:fs';
import path from 'node:path';
import { expect, test, type Page } from '@playwright/test';
import {
  createSession,
  git,
  launch,
  removeDir,
  ROOT,
  screenText,
  setTitle,
  tempDir,
} from './harness';

const PHASE = process.env.EVIDENCES_PHASE === 'antes' ? 'antes' : 'depois';
const AFTER = PHASE === 'depois';
const OUT = process.env.EVIDENCES_DIR || path.join(ROOT, 'evidences', 'images');
const FOLDER = 'quadro-de-tarefas';
const MENU = path.join(ROOT, 'tests', 'fixtures', 'permission-menu.cjs');

test.skip(process.env.EVIDENCES !== '1', 'só com EVIDENCES=1');

const row = (page: Page, name: string) => page.locator('.session-item', { hasText: name });
const board = (page: Page) => page.getByTestId('task-board');

test('evidences: task board', async () => {
  test.setTimeout(300_000);
  const userData = tempDir('ac-evid-data-');
  const base = tempDir('ac-');
  const repo = path.join(base, 'loja');
  fs.mkdirSync(repo);
  git(repo, 'init', '-q', '-b', 'main');
  git(repo, 'config', 'user.email', 'e2e@example.com');
  git(repo, 'config', 'user.name', 'E2E');
  git(repo, 'config', 'commit.gpgsign', 'false');
  git(repo, 'config', 'core.autocrlf', 'false');
  fs.writeFileSync(path.join(repo, 'README.md'), '# Loja\n');
  git(repo, 'add', '-A');
  git(repo, 'commit', '-q', '-m', 'base');

  const running = await launch(userData);
  const { page } = running;
  await page.setViewportSize({ width: 1400, height: 800 });
  const shot = async (name: string) => {
    fs.mkdirSync(path.join(OUT, FOLDER), { recursive: true });
    await page.waitForTimeout(800);
    await page.screenshot({ path: path.join(OUT, FOLDER, `${name}-${PHASE}.png`) });
  };
  const titles = ['Corrigir o login', 'Migrar o IPC', 'Revisar permissões'];
  try {
    await page.evaluate(
      (folder) => window.api.invoke('worktrees:configure', { folder, setup: '' }),
      path.join(base, 'copias'),
    );
    await page.evaluate(() => window.api.invoke('prefs:set', { silenceSeconds: 600 }));

    if (!AFTER) {
      // By hand: one session and one copy per piece of work; the list of what is left is elsewhere.
      for (const title of titles) {
        await page.evaluate(
          async ([name, cwd]) => {
            await window.api.invoke('sessions:create', {
              name: name!,
              cwd: cwd!,
              profile: 'claude-code',
              worktree: {
                branch: `ac/${name!.toLowerCase().replace(/[^a-z]+/g, '-')}`,
                base: 'main',
              },
            });
          },
          [title, repo],
        );
      }
      await row(page, titles[0]!).click();
      await setTitle(page, '◐ trabalhando');
      await page.waitForTimeout(1500);
      await setTitle(page, '✳ pronto');
      await page.waitForTimeout(1500);
      await row(page, titles[1]!).click();
      await setTitle(page, '◐ trabalhando');
      await page.waitForTimeout(1500);
      await page.keyboard.press('Control+Shift+B');
      await shot('01-quadro');
      await row(page, titles[2]!).click();
      await page.getByRole('button', { name: '+ Nova sessão' }).click();
      await shot('02-novo-cartao');
      return;
    }

    await createSession(page, 'Base', repo);
    const made = await page.evaluate(
      async ([cwd, all]) =>
        (
          await window.api.invoke('tasks:create', {
            cwd: cwd!,
            profile: 'claude-code',
            isolated: true,
            base: 'main',
            drafts: (JSON.parse(all!) as string[]).map((title) => ({ title, description: '' })),
          })
        ).tasks.length,
      [
        repo,
        JSON.stringify([
          ...titles,
          'Limpar os testes',
          'Atualizar o README',
          'Remover código morto',
        ]),
      ],
    );
    expect(made).toBe(6);
    const ids = await page.evaluate(
      async (cwd) => (await window.api.invoke('tasks:list', cwd)).tasks.map((t) => t.id),
      repo,
    );
    await page.evaluate((list) => window.api.invoke('tasks:start', list), ids.slice(0, 3));
    for (const title of titles) await expect(row(page, title)).toBeVisible({ timeout: 60_000 });
    await page.evaluate((id) => window.api.invoke('tasks:done', id, true), ids[5]!);
    await page.waitForTimeout(4000);

    await row(page, titles[0]!).click();
    await setTitle(page, '◐ trabalhando');
    await page.waitForTimeout(1500);
    await setTitle(page, '✳ pronto');
    await page.waitForTimeout(1500);
    await row(page, titles[1]!).click();
    await setTitle(page, '◐ trabalhando');
    await page.waitForTimeout(1500);
    await row(page, titles[2]!).click();
    await page.locator('.terminal-host.visible').click();
    await page.keyboard.type(`node "${MENU}" Bash npm install`);
    await page.keyboard.press('Enter');
    const id = (await row(page, titles[2]!).getAttribute('data-session-id'))!;
    await expect
      .poll(() => screenText(page, id), { timeout: 20_000 })
      .toContain('Do you want to proceed?');
    await expect(row(page, titles[2]!)).toHaveAttribute('data-state', 'aguardando');

    await page.keyboard.press('Control+Shift+B');
    await expect(board(page)).toBeVisible();
    await expect(board(page).getByTestId('board-card')).toHaveCount(6);
    await shot('01-quadro');

    await board(page).getByTestId('board-new').click();
    const dialog = page.getByRole('dialog', { name: 'Novo cartão' });
    await dialog
      .getByLabel('Título (uma linha por cartão)')
      .fill('Adicionar testes de login\nTrocar a biblioteca de datas\nDocumentar a API');
    await expect(dialog.getByTestId('task-many')).toBeVisible();
    await shot('02-novo-cartao');
  } finally {
    await running.app.close();
    for (const dir of [userData, base]) removeDir(dir);
  }
});
