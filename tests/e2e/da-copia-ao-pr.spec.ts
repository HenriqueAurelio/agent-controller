// From the copy to the pull request (ADR 0029): push and open it, and bring the base in, with the
// conflict sent to the agent.
import fs from 'node:fs';
import path from 'node:path';
import { expect, test } from '@playwright/test';
import { fakeGitHubEnv, startFakeGitHub } from './fake-github';
import { git, launch, removeDir, tempDir } from './harness';
import { isolatedSession, repoWithRemote } from './copy-helpers';

test('the branch of a copy is pushed and becomes a pull request; the base comes in, with the conflict for the agent', async () => {
  test.setTimeout(180_000);
  const dir = tempDir('ac-e2e-pr-copy-');
  const userData = tempDir('ac-e2e-pr-copy-data-');
  const fake = await startFakeGitHub({ 'acme/api': [] });
  const { repo, remote } = repoWithRemote(dir);
  const running = await launch(userData, fakeGitHubEnv(fake));
  const { page } = running;
  try {
    await page.evaluate(
      (folder) => window.api.invoke('worktrees:configure', { folder, setup: '' }),
      path.join(dir, 'copias'),
    );
    const { cwd } = await isolatedSession(page, 'Login', repo, 'ac/login');
    fs.writeFileSync(path.join(cwd, 'README.md'), '# Projeto\n\nLogin arrumado.\n');
    git(cwd, 'add', '-A');
    git(cwd, 'commit', '-q', '-m', 'Arruma o login');

    // The dialog starts with the commits of the branch.
    await page.getByTestId('branch-button').click();
    const dialog = page.locator('.branch-dialog');
    await expect(dialog.getByTestId('branch-summary')).toHaveText(
      'ac/login → main: 1 commits que a base não tem · acme/api',
    );
    await expect(dialog.getByTestId('branch-title')).toHaveValue('Arruma o login');
    await expect(dialog.getByTestId('branch-body')).toHaveValue('- Arruma o login');

    // Push and open: the branch is on the remote, the PR on the service, the repository watched.
    await dialog.getByTestId('branch-open-pull').click();
    await expect(dialog.getByTestId('branch-opened')).toContainText('PR #100 aberto', {
      timeout: 30_000,
    });
    expect(git(remote, 'branch', '--list', 'ac/*')).toContain('ac/login');
    expect(fake.writes).toEqual([
      {
        method: 'POST',
        path: '/repos/acme/api/pulls',
        body: {
          title: 'Arruma o login',
          body: '- Arruma o login',
          head: 'ac/login',
          base: 'main',
          draft: false,
        },
      },
    ]);
    await expect
      .poll(async () => (await page.evaluate(() => window.api.invoke('prefs:get'))).pulls.repos)
      .toEqual(['acme/api']);

    // The base moves on the same line: the update stops on the conflict, which goes to the agent.
    fs.writeFileSync(path.join(repo, 'README.md'), '# Projeto da equipe\n');
    git(repo, 'add', '-A');
    git(repo, 'commit', '-q', '-m', 'Muda o título');
    await dialog.getByTestId('branch-update').click();
    const result = dialog.getByTestId('branch-update-result');
    await expect(result).toContainText('parou em 1 arquivos com conflito');
    await expect(result).toContainText('README.md');
    await dialog.getByTestId('branch-send-conflict').click();
    const prompt = page.getByRole('dialog', { name: 'Enviar prompt' });
    await expect(prompt.getByLabel('Texto a enviar')).toContainText('- README.md');
  } finally {
    await running.close();
    await fake.close();
    removeDir(userData);
    removeDir(repo);
    removeDir(dir);
  }
});
