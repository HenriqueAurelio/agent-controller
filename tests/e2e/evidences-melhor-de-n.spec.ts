// The screens of the experiments ("best of N"), to attach to the pull request, as in
// `evidences.spec.ts`:
//
//   EVIDENCES=1 npx playwright test --config tests/e2e/playwright.config.ts evidences-melhor-de-n.spec.ts
//
// `EVIDENCES_PHASE=antes`, run on a build of the code as it was, takes the "before" of each pair:
// the same repository and the same three attempts, made by hand, the way it had to be done.
import fs from 'node:fs';
import path from 'node:path';
import { expect, test, type Page } from '@playwright/test';
import { git, launch, removeDir, ROOT, setTitle, tempDir } from './harness';

const PHASE = process.env.EVIDENCES_PHASE === 'antes' ? 'antes' : 'depois';
const AFTER = PHASE === 'depois';
const OUT = process.env.EVIDENCES_DIR || path.join(ROOT, 'evidences', 'images');
const FOLDER = 'melhor-de-n';

test.skip(process.env.EVIDENCES !== '1', 'só com EVIDENCES=1');

const row = (page: Page, name: string) => page.locator('.session-item', { hasText: name });

const write = (root: string, file: string, text: string) => {
  fs.mkdirSync(path.dirname(path.join(root, file)), { recursive: true });
  fs.writeFileSync(path.join(root, file), text);
};

const LOGIN = [
  'export function login(user: string, password: string) {',
  '  if (!user) return false;',
  '  if (!password) return false;',
  '  const session = createSession(user);',
  '  return session !== null;',
  '}',
  '',
].join('\n');

test('evidences: experiments, best of N', async () => {
  test.setTimeout(300_000);
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
  write(repo, 'src/login.ts', LOGIN);
  write(repo, 'src/session.ts', 'export const createSession = (user: string) => ({ user });\n');
  write(repo, 'README.md', '# Loja\n');
  git(repo, 'add', '-A');
  git(repo, 'commit', '-q', '-m', 'base');

  const running = await launch(userData);
  const { page } = running;
  await page.setViewportSize({ width: 1280, height: 800 });
  const shot = async (name: string) => {
    fs.mkdirSync(path.join(OUT, FOLDER), { recursive: true });
    await page.waitForTimeout(700);
    await page.screenshot({ path: path.join(OUT, FOLDER, `${name}-${PHASE}.png`) });
  };
  const cwdOf = (name: string) =>
    page.evaluate(
      async (n) =>
        (await window.api.invoke('sessions:list')).sessions.find((s) => s.name === n)!.cwd,
      name,
    );
  try {
    await page.evaluate(
      (folder) => window.api.invoke('worktrees:configure', { folder, setup: '' }),
      path.join(base, 'copias'),
    );
    // A working agent would not turn "possibly waiting" in the middle of a picture.
    await page.evaluate(() => window.api.invoke('prefs:set', { silenceSeconds: 600 }));

    // 01: the way to ask. After: one dialog, three attempts (two Claude Code, one Codex).
    // Before: the dialog of a session, one copy at a time.
    if (AFTER) {
      await page.getByTestId('new-experiment-button').click();
      const dialog = page.getByRole('dialog', { name: 'Novo experimento' });
      await dialog.getByLabel('Pasta').fill(repo);
      await dialog.getByLabel('Nome do experimento').fill('Login');
      await expect(dialog.getByLabel('A partir de')).toHaveValue('main');
      await dialog
        .getByLabel('Pedido')
        .fill('Refatore o login: valide o usuário e a senha em um só lugar.');
      await dialog.getByRole('button', { name: 'Adicionar tentativa' }).click();
      await dialog.getByLabel('Agente da tentativa 3').selectOption({ label: 'Codex' });
      await expect(dialog.getByTestId('experiment-usage')).toContainText('3 tentativas = 3× o uso');
      await shot('01-criar');
      await dialog.getByRole('button', { name: 'Criar experimento' }).click();
      await expect(dialog).toBeHidden({ timeout: 60_000 });
    } else {
      await page.getByRole('button', { name: '+ Nova sessão' }).click();
      const dialog = page.getByRole('dialog', { name: 'Nova sessão' });
      await dialog.getByLabel('Pasta').fill(repo);
      await dialog.getByLabel('Nome').fill('Login #1');
      await dialog.getByLabel('Cópia isolada (git worktree)').check();
      await expect(dialog.getByLabel('A partir de')).toHaveValue('main');
      await shot('01-criar');
      await dialog.getByRole('button', { name: 'Cancelar' }).click();
      // The three, by hand, in a group of their own.
      const ids: string[] = [];
      for (const [index, profile] of ['claude-code', 'claude-code', 'codex'].entries()) {
        const created = await page.evaluate(
          async ([cwd, n, p]) =>
            window.api.invoke('sessions:create', {
              name: `Login #${n}`,
              cwd: cwd!,
              profile: p as 'claude-code' | 'codex',
              worktree: { branch: `ac/login-${n}`, base: 'main' },
            }),
          [repo, String(index + 1), profile] as const,
        );
        ids.push(created.id);
      }
      await page.evaluate(([...list]) => window.api.invoke('groups:create', 'Login', list), ids);
    }
    await expect(row(page, 'Login #3')).toBeVisible();
    const copies = [await cwdOf('Login #1'), await cwdOf('Login #2'), await cwdOf('Login #3')];

    // What each attempt did: three ways to the same login, and a check that says which works.
    write(
      copies[0]!,
      'src/login.ts',
      LOGIN.replace(
        '  if (!user) return false;\n  if (!password) return false;',
        '  if (!user || !password) return false;',
      ),
    );
    write(
      copies[0]!,
      'tests/login.test.ts',
      "test('login', () => {});\ntest('senha', () => {});\n",
    );
    write(
      copies[1]!,
      'src/login.ts',
      LOGIN.replace('return session !== null;', 'return Boolean(session);'),
    );
    write(
      copies[2]!,
      'src/login.ts',
      LOGIN.replace('  const session', '  validate(user, password);\n  const session'),
    );
    write(
      copies[2]!,
      'src/validate.ts',
      'export function validate(user: string, password: string) {}\n',
    );
    await page.evaluate(
      async ([a, b]) => {
        const sessions = (await window.api.invoke('sessions:list')).sessions;
        const id = (name: string) => sessions.find((s) => s.name === name)!.id;
        await window.api.invoke('checks:configure', id('Login #1'), [
          { id: 'testes', label: 'Testes', command: a!, timeoutSec: 60, onTurnEnd: true },
        ]);
        await window.api.invoke('checks:configure', id('Login #2'), [
          { id: 'testes', label: 'Testes', command: b!, timeoutSec: 60, onTurnEnd: true },
        ]);
        await window.api.invoke('checks:run', id('Login #1'));
        await window.api.invoke('checks:run', id('Login #2'));
      },
      ['exit 0', 'exit 1'],
    );

    // The states: two done (Codex does not set the title of the shell, so the third stays as it is).
    for (const name of ['Login #2', 'Login #1']) {
      await row(page, name).click();
      await setTitle(page, '◐ login');
      await expect(row(page, name)).toHaveAttribute('data-state', 'trabalhando', {
        timeout: 15_000,
      });
      await setTitle(page, '✳ pronto');
      await expect(row(page, name)).toHaveAttribute('data-state', 'terminou', {
        timeout: 15_000,
      });
    }
    await expect(row(page, 'Login #1').getByTestId('checks-badge')).toHaveAttribute(
      'data-checks',
      'passed',
      { timeout: 30_000 },
    );
    await expect(row(page, 'Login #2').getByTestId('checks-badge')).toHaveAttribute(
      'data-checks',
      'failed',
      { timeout: 30_000 },
    );

    // 02: the list. After: the group is the experiment, with ⇄ to compare. Before: a group of
    // three sessions, nothing that ties them to one request.
    await row(page, 'Login #1').click();
    await shot('02-lista');

    // 03: comparing. After: the table and one file in all three. Before: the panel of one
    // session at a time.
    if (AFTER) {
      await page.getByTestId('compare-button').click();
      const dialog = page.getByRole('dialog', { name: 'Comparar: Login' });
      await expect(dialog.getByTestId('compare-files')).toHaveText(['2', '1', '2'], {
        timeout: 20_000,
      });
      await expect(
        dialog.getByTestId('compare-row').nth(1).getByTestId('checks-badge'),
      ).toBeVisible({
        timeout: 20_000,
      });
      await dialog.getByRole('option', { name: 'src/login.ts' }).click();
      await expect(dialog.getByTestId('compare-diff')).toHaveCount(3);
      await shot('03-comparar');

      // 04: keeping one asks first, and says what happens to the others.
      await dialog.getByRole('button', { name: 'Ficar com esta: Login #2' }).click();
      await expect(dialog.getByTestId('compare-ask')).toBeVisible();
      await shot('04-ficar-com-esta');

      // 05: the copies with work that was not committed are not removed, and are listed.
      await dialog.getByRole('button', { name: 'Ficar com esta e fechar as outras' }).click();
      await expect(dialog.getByTestId('compare-kept')).toContainText('Login #1', {
        timeout: 30_000,
      });
      await shot('05-copias-que-ficaram');
    } else {
      await page.keyboard.press('Control+Shift+G');
      const panel = page.getByRole('region', { name: 'Mudanças' });
      await panel.locator('.change-item[data-path="src/login.ts"]').click();
      await expect(panel.locator('.change-item').first()).toBeVisible();
      await shot('03-comparar');
      await page.keyboard.press('Escape');

      // 04 and 05: closing the others, one by one, each with its own question.
      await row(page, 'Login #1').hover();
      await row(page, 'Login #1').locator('.close-button').click();
      await expect(page.getByRole('dialog')).toBeVisible();
      await shot('04-ficar-com-esta');
      await page.keyboard.press('Escape');
      await shot('05-copias-que-ficaram');
    }
  } finally {
    await running.close();
    removeDir(userData);
    removeDir(base);
  }
});
