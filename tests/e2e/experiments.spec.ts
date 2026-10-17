import fs from 'node:fs';
import path from 'node:path';
import { expect, test, type Page } from '@playwright/test';
import { git, launch, makeRepo, removeDir, runInTerminal, setTitle, tempDir } from './harness';

const row = (page: Page, name: string) => page.locator('.session-item', { hasText: name });

const sessionCwd = (page: Page, name: string) =>
  page.evaluate(
    async (n) => (await window.api.invoke('sessions:list')).sessions.find((s) => s.name === n)!.cwd,
    name,
  );

/** The experiment dialog, as the user fills it: a folder, a name, a request and two attempts. */
async function createExperiment(page: Page, repo: string, prompt: string) {
  await page.getByTestId('new-experiment-button').click();
  const dialog = page.getByRole('dialog', { name: 'Novo experimento' });
  await dialog.getByLabel('Pasta').fill(repo);
  await dialog.getByLabel('Nome do experimento').fill('Login');
  await expect(dialog.getByLabel('A partir de')).toHaveValue('main');
  await dialog.getByLabel('Pedido').fill(prompt);
  await expect(dialog.getByTestId('experiment-usage')).toContainText('2 tentativas = 2× o uso');
  await dialog.getByRole('button', { name: 'Adicionar tentativa' }).click();
  await expect(dialog.getByTestId('experiment-usage')).toContainText('3 tentativas = 3× o uso');
  await dialog.getByRole('button', { name: 'Remover a tentativa 3' }).click();
  await dialog.getByRole('button', { name: 'Criar experimento' }).click();
  await expect(dialog).toBeHidden({ timeout: 60_000 });
}

/** Both attempts have the request in their copy: the test shell ran it. */
async function sendReady(page: Page, name: string, folder: string) {
  await row(page, name).click();
  // The shell of the test sets no title: say "ready" the way an agent would.
  await setTitle(page, '✳ pronto');
  await expect
    .poll(() => fs.existsSync(path.join(folder, 'pedido.txt')), { timeout: 30_000 })
    .toBe(true);
}

test('an experiment makes the copies, sends the request, compares and keeps one', async () => {
  test.setTimeout(240_000);
  const userData = tempDir('ac-e2e-exp-');
  const copies = tempDir('ac-e2e-exp-copias-');
  const repo = makeRepo();
  const running = await launch(userData);
  const { page } = running;
  try {
    await page.evaluate(
      (folder) => window.api.invoke('worktrees:configure', { folder, setup: '' }),
      copies,
    );
    await createExperiment(page, repo, 'echo pedido> pedido.txt');

    // One group with an attempt per line, each in a copy and branch of its own.
    await expect(page.locator('.session-group', { hasText: 'Login' })).toBeVisible();
    await expect(row(page, 'Login #1')).toBeVisible();
    await expect(row(page, 'Login #2')).toBeVisible();
    const one = await sessionCwd(page, 'Login #1');
    const two = await sessionCwd(page, 'Login #2');
    expect(one).not.toBe(two);
    expect(git(one, 'branch', '--show-current').trim()).toBe('ac/login-1');
    expect(git(two, 'branch', '--show-current').trim()).toBe('ac/login-2');

    await sendReady(page, 'Login #2', two);
    await sendReady(page, 'Login #1', one);

    // Each one then does something of its own.
    await runInTerminal(
      page,
      (await row(page, 'Login #1').getAttribute('data-session-id'))!,
      'echo um> a.txt',
      'echo um',
    );
    await row(page, 'Login #2').click();
    await runInTerminal(
      page,
      (await row(page, 'Login #2').getAttribute('data-session-id'))!,
      'echo dois> b.txt',
      'echo dois',
    );

    await page.getByTestId('compare-button').click();
    const dialog = page.getByRole('dialog', { name: 'Comparar: Login' });
    await expect(dialog.getByTestId('compare-row')).toHaveCount(2);
    await expect(dialog.getByTestId('compare-files')).toHaveText(['2', '2'], { timeout: 15_000 });
    await expect(dialog.getByRole('option')).toHaveText(['a.txt', 'b.txt', 'pedido.txt']);

    // The file in every attempt: the one that wrote it shows it, the other says it did not.
    await dialog.getByRole('option', { name: 'a.txt' }).click();
    await expect(dialog.getByTestId('compare-diff')).toHaveCount(1);
    await expect(dialog.getByTestId('compare-diff')).toContainText('+um');
    await expect(dialog.locator('.compare-column').nth(1)).toContainText(
      'Não mexeu neste arquivo.',
    );

    // The second attempt is committed, so its copy may go; the first is kept.
    git(two, '-c', 'user.email=e@e', '-c', 'user.name=e', 'add', '-A');
    git(two, '-c', 'user.email=e@e', '-c', 'user.name=e', 'commit', '-q', '-m', 'dois');
    await dialog.getByRole('button', { name: 'Ficar com esta: Login #1' }).click();
    await expect(dialog.getByTestId('compare-ask')).toContainText('As outras 1 tentativas');
    await dialog.getByRole('button', { name: 'Ficar com esta e fechar as outras' }).click();
    await expect(dialog).toBeHidden({ timeout: 30_000 });

    await expect(row(page, 'Login #2')).toHaveCount(0);
    await expect(row(page, 'Login #1')).toHaveCount(1);
    await expect(page.locator('.session-group')).toHaveCount(0);
    expect(fs.existsSync(two)).toBe(false);
    expect(fs.existsSync(one)).toBe(true);
    // No branch is ever deleted.
    expect(git(repo, 'branch', '--list', 'ac/*')).toContain('ac/login-2');
  } finally {
    await running.close();
    removeDir(userData);
    removeDir(copies);
    removeDir(repo);
  }
});

test('keeping one lists the copies that could not be removed, and leaves them open', async () => {
  test.setTimeout(240_000);
  const userData = tempDir('ac-e2e-exp2-');
  const copies = tempDir('ac-e2e-exp2-copias-');
  const repo = makeRepo();
  const running = await launch(userData);
  const { page } = running;
  try {
    await page.evaluate(
      (folder) => window.api.invoke('worktrees:configure', { folder, setup: '' }),
      copies,
    );
    await createExperiment(page, repo, 'echo pedido> pedido.txt');
    const two = await sessionCwd(page, 'Login #2');
    await sendReady(page, 'Login #2', two);

    await page.getByTestId('compare-button').click();
    const dialog = page.getByRole('dialog', { name: 'Comparar: Login' });
    await dialog.getByRole('button', { name: 'Ficar com esta: Login #1' }).click();
    await dialog.getByRole('button', { name: 'Ficar com esta e fechar as outras' }).click();

    // The second copy has the request's file, not committed: it stays, and the dialog says so.
    const kept = dialog.getByTestId('compare-kept');
    await expect(kept).toContainText('Login #2', { timeout: 30_000 });
    await expect(kept).toContainText('sem commit');
    expect(fs.existsSync(path.join(two, 'pedido.txt'))).toBe(true);
    await expect(row(page, 'Login #2')).toHaveCount(1);
  } finally {
    await running.close();
    removeDir(userData);
    removeDir(copies);
    removeDir(repo);
  }
});
