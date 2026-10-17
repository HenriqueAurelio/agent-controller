// The screens of the conflicts between sessions, to attach to the pull request, as in
// `evidences.spec.ts`:
//
//   EVIDENCES=1 npx playwright test --config tests/e2e/playwright.config.ts evidences-conflito-entre-sessoes.spec.ts
//
// `EVIDENCES_PHASE=antes`, run on a build of the code as it was, takes the "before" of each pair:
// there was no such warning, so each picture is the same screen as it was then.
import fs from 'node:fs';
import path from 'node:path';
import { expect, test, type Page } from '@playwright/test';
import { git, launch, removeDir, ROOT, tempDir } from './harness';

const PHASE = process.env.EVIDENCES_PHASE === 'antes' ? 'antes' : 'depois';
const AFTER = PHASE === 'depois';
const OUT = process.env.EVIDENCES_DIR || path.join(ROOT, 'evidences', 'images');
const FOLDER = 'conflito-entre-sessoes';

test.skip(process.env.EVIDENCES !== '1', 'só com EVIDENCES=1');

const row = (page: Page, name: string) => page.locator('.session-item', { hasText: name });

async function createIsolated(page: Page, name: string, repo: string, branch: string) {
  await page.getByRole('button', { name: '+ Nova sessão' }).click();
  const dialog = page.getByRole('dialog', { name: 'Nova sessão' });
  await dialog.getByLabel('Pasta').fill(repo);
  await dialog.getByLabel('Nome').fill(name);
  await dialog.getByRole('radio', { name: /Claude Code/ }).check();
  await dialog.getByLabel('Cópia isolada (git worktree)').check();
  await dialog.getByLabel('Branch nova').fill(branch);
  await expect(dialog.getByLabel('A partir de')).toHaveValue('main');
  await dialog.getByRole('button', { name: 'Criar e iniciar' }).click();
  await expect(dialog).toBeHidden({ timeout: 30_000 });
  await expect(row(page, name)).toHaveAttribute('aria-selected', 'true');
  const id = (await row(page, name).getAttribute('data-session-id'))!;
  return page.evaluate(
    async (id) => (await window.api.invoke('sessions:list')).sessions.find((s) => s.id === id)!.cwd,
    id,
  );
}

test('evidences: conflicts between sessions', async () => {
  test.setTimeout(240_000);
  const userData = tempDir('ac-evid-data-');
  // A short, stable path: it is in the pictures.
  const base = tempDir('ac-');
  const repo = path.join(base, 'loja');
  fs.mkdirSync(repo);
  git(repo, 'init', '-q', '-b', 'main');
  git(repo, 'config', 'user.email', 'e2e@example.com');
  git(repo, 'config', 'user.name', 'E2E');
  git(repo, 'config', 'commit.gpgsign', 'false');
  git(repo, 'config', 'core.autocrlf', 'false');
  const lines = (n: number, change: Record<number, string> = {}) =>
    Array.from({ length: n }, (_, i) => change[i + 1] ?? `// linha ${i + 1}`).join('\n') + '\n';
  const write = (root: string, file: string, text: string) => {
    fs.mkdirSync(path.dirname(path.join(root, file)), { recursive: true });
    fs.writeFileSync(path.join(root, file), text);
  };
  write(repo, 'src/SessionManager.ts', lines(30));
  write(repo, 'src/ipc.ts', lines(30));
  write(repo, 'README.md', '# Loja\n');
  write(repo, 'package-lock.json', '{}\n');
  git(repo, 'add', '-A');
  git(repo, 'commit', '-q', '-m', 'base');

  const running = await launch(userData);
  const { page } = running;
  page.on('dialog', (dialog) => void dialog.accept());
  const shot = async (name: string) => {
    fs.mkdirSync(path.join(OUT, FOLDER), { recursive: true });
    await page.waitForTimeout(700);
    await page.screenshot({ path: path.join(OUT, FOLDER, `${name}-${PHASE}.png`) });
  };
  try {
    await page.evaluate(
      (folder) => window.api.invoke('worktrees:configure', { folder, setup: '' }),
      path.join(base, 'copias'),
    );
    const ipc = await createIsolated(page, 'refatorar-ipc', repo, 'ac/refatorar-ipc');
    const tests = await createIsolated(page, 'testes', repo, 'ac/testes');
    const docs = await createIsolated(page, 'docs', repo, 'ac/docs');

    // The same lines of SessionManager.ts in two copies; other lines of ipc.ts; the lockfile,
    // which the warning leaves out; and a third session that touches nothing in common.
    write(ipc, 'src/SessionManager.ts', lines(30, { 12: 'export const fila = [];' }));
    write(tests, 'src/SessionManager.ts', lines(30, { 12: 'export const fila = new Set();' }));
    write(ipc, 'src/ipc.ts', lines(30, { 3: "import { canal } from './canal';" }));
    write(tests, 'src/ipc.ts', lines(30, { 28: 'export const teste = true;' }));
    write(ipc, 'package-lock.json', '{"a":1}\n');
    write(tests, 'package-lock.json', '{"b":2}\n');
    write(tests, 'tests/fila.test.ts', "test('fila', () => {});\n");
    write(docs, 'README.md', '# Loja\n\nComo usar.\n');

    // Opening and closing the panel of one of them is what makes the app look.
    await row(page, 'refatorar-ipc').click();
    await page.keyboard.press('Control+Shift+G');
    const panel = page.getByRole('region', { name: 'Mudanças' });
    await expect(panel.locator('.change-item').first()).toBeVisible();
    if (AFTER) {
      await expect(row(page, 'testes').getByTestId('overlap-badge')).toHaveText('⚠ 2');
    } else await page.waitForTimeout(6000);
    await page.keyboard.press('Escape');

    // 01: the list. After: ⚠ 2 on the two sessions, red for the likely conflict; none on "docs".
    await shot('01-lista');

    // 02: the panel of "refatorar-ipc", with the mark on the files in common.
    await page.keyboard.press('Control+Shift+G');
    await panel.locator('.change-item[data-path="src/SessionManager.ts"]').click();
    if (AFTER) await expect(panel.getByTestId('overlap-mark')).toHaveCount(2);
    await shot('02-painel-de-mudancas');

    // 03: the same file in the other session. After: a click on the ⚠; before: the user had to
    // pick the session and look for the file.
    if (AFTER) {
      await panel
        .locator('.change-item[data-path="src/SessionManager.ts"]')
        .getByTestId('overlap-mark')
        .click();
      await expect(row(page, 'testes')).toHaveAttribute('aria-selected', 'true');
    } else {
      await page.keyboard.press('Escape');
      await row(page, 'testes').click();
      await page.keyboard.press('Control+Shift+G');
    }
    await expect(panel.locator('.change-item').first()).toBeVisible();
    await shot('03-abrir-na-outra-sessao');
    await page.keyboard.press('Escape');

    // 04: Preferences → Sessions.
    await page.locator('button[title^="Preferências"]').click();
    const prefs = page.getByRole('dialog', { name: 'Preferências' });
    await prefs.getByRole('tab', { name: 'Sessões' }).click();
    // The same place in both: the end of the tab, where the checkpoints are; after, the warning
    // is right above them.
    await prefs
      .locator('.checkpoints-settings')
      .evaluate((el) => el.scrollIntoView({ block: 'end' }));
    await shot('04-preferencias-sessoes');
    await page.keyboard.press('Escape');
  } finally {
    await running.close();
    removeDir(userData);
    removeDir(base);
  }
});
