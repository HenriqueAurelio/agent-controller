// Sonar before the pull request: the opening waits for the analysis of the commit that goes out,
// stops when the quality gate fails, and the pull request shows what Sonar said of its commit.
import fs from 'node:fs';
import path from 'node:path';
import { expect, test } from '@playwright/test';
import { fakeGitHubEnv, startFakeGitHub } from './fake-github';
import { groupOf, startFakeSonar, writeFakeScanner } from './fake-sonar';
import { git, launch, removeDir, tempDir } from './harness';
import { isolatedSession, repoWithRemote } from './copy-helpers';

test('the pull request opens only after Sonar passes the commit that goes out', async () => {
  test.setTimeout(180_000);
  const dir = tempDir('ac-e2e-sonar-pr-');
  const userData = tempDir('ac-e2e-sonar-pr-data-');
  const github = await startFakeGitHub({ 'acme/api': [] });
  const sonar = await startFakeSonar();
  sonar.issues['ac/login'] = [
    { file: 'README.md', line: 3, severity: 'MAJOR', message: 'Remove this TODO', rule: 'md:S1' },
  ];
  const scanner = writeFakeScanner(dir);
  const { repo, remote } = repoWithRemote(dir);
  const running = await launch(userData, fakeGitHubEnv(github));
  const { page } = running;
  try {
    await page.evaluate(
      (folder) => window.api.invoke('worktrees:configure', { folder, setup: '' }),
      path.join(dir, 'copias'),
    );
    const { id, cwd } = await isolatedSession(page, 'Login', repo, 'ac/login');
    const groupId = await groupOf(page, 'acme/api', [id]);
    const info = await page.evaluate((g) => window.api.invoke('sonar:group', g), groupId);
    // A Linux with no keyring keeps no token (see sonar.spec.ts); Windows always has the vault.
    test.skip(
      process.platform === 'linux' && !info.secureStorage,
      'sem cofre de senhas do sistema nesta máquina',
    );
    await page.evaluate(
      ({ groupId, url, projectKey, scanner, token }) =>
        window.api.invoke(
          'sonar:configure',
          groupId,
          {
            provider: 'sonarqube',
            url,
            projectKey,
            organization: '',
            scanner,
            enabled: true,
            branches: true,
            onTurnEnd: false,
            beforePull: true,
          },
          token,
        ),
      { groupId, url: sonar.url, projectKey: sonar.projectKey, scanner, token: sonar.token },
    );

    fs.writeFileSync(path.join(cwd, 'README.md'), '# Projeto\n\nLogin arrumado.\nTODO\n');
    git(cwd, 'add', '-A');
    git(cwd, 'commit', '-q', '-m', 'Arruma o login');

    // The dialog says Sonar comes first, and the button says so too.
    await page.getByTestId('branch-button').click();
    const dialog = page.locator('.branch-dialog');
    const gate = dialog.getByTestId('branch-sonar');
    await expect(gate).toHaveAttribute('data-status', 'pending');
    const open = dialog.getByTestId('branch-open-pull');
    await expect(open).toHaveText('Analisar no Sonar e abrir o PR');

    // A failing gate holds the pull request: nothing is pushed or opened.
    await open.click();
    await expect(gate).toHaveAttribute('data-status', 'failed', { timeout: 30_000 });
    await expect(gate).toContainText('O Sonar reprovou este código: 1 problemas');
    expect(github.writes).toEqual([]);
    expect(git(remote, 'branch', '--list', 'ac/*')).toBe('');

    // The problems go to the agent through the prompt "Fix problems".
    await dialog.getByTestId('branch-sonar-send').click();
    const prompt = page.getByRole('dialog', { name: 'Enviar prompt' });
    await expect(prompt.getByTestId('prompt-preview')).toContainText('Remove this TODO');
    await page.keyboard.press('Escape');
    await expect(prompt).toBeHidden();

    // The agent fixes it in a new commit: the old result is not about it, so Sonar runs again,
    // passes, and the pull request opens by itself.
    delete sonar.issues['ac/login'];
    fs.writeFileSync(path.join(cwd, 'README.md'), '# Projeto\n\nLogin arrumado.\n');
    git(cwd, 'add', '-A');
    git(cwd, 'commit', '-q', '-m', 'Tira o TODO');
    const head = git(cwd, 'rev-parse', 'HEAD').trim();
    await page.getByTestId('branch-button').click();
    await expect(gate).toHaveAttribute('data-status', 'pending');
    await open.click();
    await expect(dialog.getByTestId('branch-opened')).toContainText('PR #100 aberto', {
      timeout: 30_000,
    });
    await expect(gate).toHaveAttribute('data-status', 'passed');
    expect(git(remote, 'branch', '--list', 'ac/*')).toContain('ac/login');
    await dialog.getByRole('button', { name: 'Fechar', exact: true }).last().click();
    await expect(dialog).toBeHidden();

    // In the list of pull requests, the one of this commit carries what Sonar said.
    github.repos['acme/api']![0]!.sha = head;
    await page.getByTestId('pulls-button').click();
    await page.getByTestId('pulls-refresh').click();
    const row = page.locator('[data-testid="pull-row"][data-key="acme/api#100"]');
    await expect(row.getByTestId('pull-sonar')).toHaveAttribute('data-status', 'passed', {
      timeout: 20_000,
    });
    await expect(row.getByTestId('pull-sonar')).toHaveText('Sonar ✓');
  } finally {
    await running.close();
    await github.close();
    await sonar.close();
    removeDir(userData);
    removeDir(repo);
    removeDir(dir);
  }
});
