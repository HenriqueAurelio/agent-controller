import fs from 'node:fs';
import path from 'node:path';
import { expect, test, type Page } from '@playwright/test';
import { git, launch, makeRepo, removeDir, tempDir } from './harness';

/** A session in a new copy of the repository, without starting its agent. */
const createInCopy = (page: Page, name: string, repo: string, branch: string) =>
  page.evaluate(
    ({ name, repo, branch }) =>
      window.api.invoke('sessions:create', {
        name,
        cwd: repo,
        profile: 'claude-code',
        worktree: { branch, base: 'main' },
      }),
    { name, repo, branch },
  );

const row = (page: Page, id: string) => page.locator(`.session-item[data-session-id="${id}"]`);

test('two sessions in copies of one repository are warned of the files both change', async () => {
  test.setTimeout(150_000);
  const userData = tempDir('ac-e2e-overlap-');
  const copies = tempDir('ac-e2e-overlap-copias-');
  const repo = makeRepo();
  const running = await launch(userData);
  const { page } = running;
  try {
    await page.evaluate(
      (folder) => window.api.invoke('worktrees:configure', { folder, setup: '' }),
      copies,
    );
    const login = await createInCopy(page, 'Login', repo, 'ac/login');
    const report = await createInCopy(page, 'Relatório', repo, 'ac/relatorio');

    // The same line of one file, and other lines of another.
    fs.writeFileSync(path.join(login.cwd, 'editado.ts'), 'export const valor = 2;\n');
    fs.writeFileSync(path.join(report.cwd, 'editado.ts'), 'export const valor = 3;\n');
    fs.writeFileSync(path.join(login.cwd, 'velho.txt'), 'linha UM\nlinha dois\nlinha três\n');
    fs.writeFileSync(path.join(report.cwd, 'velho.txt'), 'linha um\nlinha dois\nlinha TRÊS\n');
    // Only in one of them: no warning.
    fs.writeFileSync(path.join(report.cwd, 'so-aqui.txt'), 'só no relatório\n');

    // Opening the panel looks again: both sessions get the warning, from the same look.
    await row(page, login.id).click();
    await page.keyboard.press('Control+Shift+G');
    const panel = page.getByRole('region', { name: 'Mudanças' });
    const loginBadge = row(page, login.id).getByTestId('overlap-badge');
    await expect(loginBadge).toHaveText('⚠ 2');
    await expect(loginBadge).toHaveClass(/likely/);
    await expect(loginBadge).toHaveAttribute(
      'title',
      '2 arquivo(s) também mudado(s) em “Relatório”; 1 com provável conflito',
    );
    await expect(row(page, report.id).getByTestId('overlap-badge')).toHaveText('⚠ 2');

    // In the panel: the mark on each file in common, stronger on the same lines.
    const mark = (file: string) =>
      panel.locator(`.change-item[data-path="${file}"]`).getByTestId('overlap-mark');
    await expect(mark('editado.ts')).toHaveAttribute('data-likely', 'true');
    await expect(mark('editado.ts')).toHaveAttribute(
      'title',
      'Provável conflito: as mesmas linhas também mudaram em “Relatório”. Clique para abrir o arquivo lá.',
    );
    await expect(mark('velho.txt')).toHaveAttribute('data-likely', 'false');

    // A click opens the same file in the other session.
    await mark('velho.txt').click();
    await expect(row(page, report.id)).toHaveAttribute('aria-selected', 'true');
    await expect(panel.locator('.change-item.selected')).toHaveAttribute('data-path', 'velho.txt');
    await expect(panel.locator('.change-item[data-path="so-aqui.txt"]')).toBeVisible();
    await expect(
      panel.locator('.change-item[data-path="so-aqui.txt"]').getByTestId('overlap-mark'),
    ).toHaveCount(0);

    // Committed in the copy, the work still counts: it is compared since the base of the branch,
    // and the file is opened over there against that base.
    git(login.cwd, 'add', '-A');
    git(login.cwd, '-c', 'user.email=e2e@example.com', '-c', 'user.name=E2E', 'commit', '-qm', 'x');
    fs.writeFileSync(path.join(report.cwd, 'velho.txt'), 'linha um\nlinha dois\nlinha 3\n');
    await expect(mark('editado.ts')).toHaveAttribute('data-likely', 'true');
    await mark('editado.ts').click();
    await expect(row(page, login.id)).toHaveAttribute('aria-selected', 'true');
    await expect(panel.getByLabel('Comparar com')).toHaveValue('branchBase');
    await expect(panel.locator('.change-item.selected')).toHaveAttribute('data-path', 'editado.ts');
    await expect(row(page, login.id).getByTestId('overlap-badge')).toHaveText('⚠ 2');

    // The warning can be turned off.
    await page.evaluate(async () => {
      const prefs = await window.api.invoke('prefs:get');
      await window.api.invoke('prefs:set', { overlaps: { ...prefs.overlaps, enabled: false } });
    });
    await expect(page.getByTestId('overlap-badge')).toHaveCount(0, { timeout: 20_000 });
    await expect(panel.getByTestId('overlap-mark')).toHaveCount(0);
  } finally {
    await running.close();
    removeDir(userData);
    removeDir(copies);
    removeDir(repo);
  }
});
