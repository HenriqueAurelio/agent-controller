import fs from 'node:fs';
import path from 'node:path';
import { expect, test, type Page } from '@playwright/test';
import { git, launch, makeRepo, removeDir, runInTerminal, tempDir } from './harness';

/** A session in a copy of the repository, through the dialog, as the user makes one. */
async function createIsolated(page: Page, name: string, repo: string, branch?: string) {
  await page.getByRole('button', { name: '+ Nova sessão' }).click();
  const dialog = page.getByRole('dialog', { name: 'Nova sessão' });
  await dialog.getByLabel('Pasta').fill(repo);
  await dialog.getByLabel('Nome').fill(name);
  await dialog.getByRole('radio', { name: /Claude Code/ }).check();
  await dialog.getByLabel('Cópia isolada (git worktree)').check();
  if (branch) await dialog.getByLabel('Branch nova').fill(branch);
  await expect(dialog.getByLabel('A partir de')).toHaveValue('main');
  await dialog.getByRole('button', { name: 'Criar e iniciar' }).click();
  await expect(dialog).toBeHidden({ timeout: 30_000 });
  const item = page.locator('.session-item', { hasText: name });
  await expect(item).toHaveAttribute('aria-selected', 'true');
  return (await item.getAttribute('data-session-id'))!;
}

const changedFiles = (page: Page) =>
  page
    .locator('.change-item')
    .evaluateAll((items) => items.map((i) => i.getAttribute('data-path')));

test('two sessions in copies of the same repository each see only their own work', async () => {
  test.setTimeout(180_000);
  const userData = tempDir('ac-e2e-wt-');
  const copies = tempDir('ac-e2e-wt-copias-');
  const repo = makeRepo();
  const running = await launch(userData);
  const { page } = running;
  try {
    // The copies go to a throwaway folder, not to the home of whoever runs the tests.
    await page.evaluate(
      (folder) => window.api.invoke('worktrees:configure', { folder, setup: '' }),
      copies,
    );

    // A folder outside any repository does not offer it.
    await page.getByRole('button', { name: '+ Nova sessão' }).click();
    let dialog = page.getByRole('dialog', { name: 'Nova sessão' });
    await dialog.getByLabel('Pasta').fill(copies);
    await page.waitForTimeout(600);
    await expect(dialog.getByLabel('Cópia isolada (git worktree)')).toHaveCount(0);
    await dialog.getByLabel('Pasta').fill(repo);
    await expect(dialog.getByLabel('Cópia isolada (git worktree)')).toBeVisible();
    // The branch follows the name of the session until it is edited.
    await dialog.getByLabel('Nome').fill('Corrigir Login');
    await dialog.getByLabel('Cópia isolada (git worktree)').check();
    await expect(dialog.getByLabel('Branch nova')).toHaveValue('ac/corrigir-login');
    await expect(dialog).toContainText(`A cópia fica em ${copies}.`);
    await dialog.getByRole('button', { name: 'Cancelar' }).click();

    const login = await createIsolated(page, 'Login', repo);
    const header = page.locator('.session-header');
    await expect(header.getByTestId('session-worktree')).toHaveText('⑂ ac/login');
    await runInTerminal(page, login, 'echo login> login.txt', 'echo login');

    const report = await createIsolated(page, 'Relatório', repo, 'ac/relatorio');
    await expect(header.getByTestId('session-worktree')).toHaveText('⑂ ac/relatorio');
    await runInTerminal(page, report, 'echo relatorio> relatorio.txt', 'echo relatorio');

    // Each panel shows only what its own session did.
    const panel = page.getByRole('region', { name: 'Mudanças' });
    await page.keyboard.press('Control+Shift+G');
    await expect.poll(() => changedFiles(page)).toEqual(['relatorio.txt']);
    await page.keyboard.press('Escape');
    await page.locator('.session-item', { hasText: 'Login' }).click();
    await page.keyboard.press('Control+Shift+G');
    await expect.poll(() => changedFiles(page)).toEqual(['login.txt']);
    // The original repository is untouched.
    expect(git(repo, 'status', '--porcelain')).toBe('');

    // Committed in the copy, the work shows against the base of the branch.
    const loginCwd = await page.evaluate(
      async (id) =>
        (await window.api.invoke('sessions:list')).sessions.find((s) => s.id === id)!.cwd,
      login,
    );
    git(loginCwd, 'add', '-A');
    git(
      loginCwd,
      '-c',
      'user.email=e2e@example.com',
      '-c',
      'user.name=E2E',
      'commit',
      '-q',
      '-m',
      'login',
    );
    await expect.poll(() => changedFiles(page)).toEqual([]);
    await panel.getByLabel('Comparar com').selectOption({ label: 'A base da branch (main)' });
    await expect.poll(() => changedFiles(page)).toEqual(['login.txt']);
    await page.keyboard.press('Escape');

    // Closing with something not committed: the copy cannot go, and stays.
    fs.writeFileSync(path.join(loginCwd, 'pendente.txt'), 'x\n');
    await page.locator('.session-item', { hasText: 'Login' }).click();
    await page.keyboard.press('Control+Shift+P');
    await page
      .getByRole('dialog', { name: 'Paleta de comandos' })
      .getByRole('option', { name: 'Fechar a sessão “Login”' })
      .click();
    dialog = page.getByRole('dialog', { name: 'Fechar sessão' });
    await expect(dialog.getByTestId('worktree-pending')).toContainText('pendente.txt');
    await expect(dialog.getByRole('radio', { name: /Remover a cópia/ })).toBeDisabled();
    await expect(dialog.getByRole('radio', { name: /Manter a cópia/ })).toBeChecked();
    await dialog.getByRole('button', { name: 'Encerrar e fechar' }).click();
    await expect(page.locator('.session-item', { hasText: 'Login' })).toHaveCount(0);
    expect(fs.existsSync(path.join(loginCwd, 'pendente.txt'))).toBe(true);

    // Preferences → Sessions lists both copies; the free one can be removed once clean.
    fs.rmSync(path.join(loginCwd, 'pendente.txt'));
    await page.keyboard.press('Control+,');
    const prefs = page.getByRole('dialog', { name: 'Preferências' });
    await prefs.getByRole('tab', { name: 'Sessões' }).click();
    const list = prefs.getByRole('list', { name: 'Cópias' });
    await expect(list.locator('.worktree-copy')).toHaveCount(2);
    await expect(list.locator('.worktree-copy', { hasText: 'ac/relatorio' })).toContainText(
      'usada por Relatório',
    );
    await expect(
      prefs.getByRole('button', { name: 'Remover a cópia ac/relatorio' }),
    ).toBeDisabled();
    page.once('dialog', (d) => void d.accept());
    await prefs.getByRole('button', { name: 'Remover a cópia ac/login' }).click();
    await expect(list.locator('.worktree-copy')).toHaveCount(1);
    expect(fs.existsSync(loginCwd)).toBe(false);
    expect(git(repo, 'branch', '--list', 'ac/login')).toContain('ac/login');
  } finally {
    await running.close();
    removeDir(userData);
    removeDir(copies);
    removeDir(repo);
  }
});

test('a copy that cannot be made says why, and no session is created', async () => {
  test.setTimeout(120_000);
  const userData = tempDir('ac-e2e-wt-erro-');
  const copies = tempDir('ac-e2e-wt-erro-copias-');
  const repo = makeRepo();
  const running = await launch(userData);
  const { page } = running;
  try {
    await page.evaluate(
      (folder) => window.api.invoke('worktrees:configure', { folder, setup: '' }),
      copies,
    );
    await page.getByRole('button', { name: '+ Nova sessão' }).click();
    const dialog = page.getByRole('dialog', { name: 'Nova sessão' });
    await dialog.getByLabel('Pasta').fill(repo);
    await dialog.getByLabel('Nome').fill('Ruim');
    await dialog.getByRole('radio', { name: /Claude Code/ }).check();
    await dialog.getByLabel('Cópia isolada (git worktree)').check();
    await dialog.getByLabel('Branch nova').fill('main');
    await dialog.getByRole('button', { name: 'Criar e iniciar' }).click();
    await expect(dialog.getByRole('alert')).toContainText('A branch main já existe');
    await expect(page.locator('.session-item')).toHaveCount(0);
  } finally {
    await running.close();
    removeDir(userData);
    removeDir(copies);
    removeDir(repo);
  }
});
