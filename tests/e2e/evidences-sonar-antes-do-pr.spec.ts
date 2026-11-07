// The screens of Sonar before the pull request, to attach to the pull request, as in
// `evidences.spec.ts`:
//
//   EVIDENCES=1 npx playwright test --config tests/e2e/playwright.config.ts evidences-sonar-antes-do-pr.spec.ts
//
// `EVIDENCES_PHASE=antes`, run on a build of the code as it was, takes the "before" of each pair:
// the same copy with a problem Sonar knows, where the pull request opens with no analysis at all.
import fs from 'node:fs';
import path from 'node:path';
import { expect, test } from '@playwright/test';
import { fakeGitHubEnv, startFakeGitHub } from './fake-github';
import { groupOf, startFakeSonar, writeFakeScanner } from './fake-sonar';
import { git, launch, removeDir, ROOT, tempDir } from './harness';
import { isolatedSession, repoWithRemote } from './copy-helpers';

const PHASE = process.env.EVIDENCES_PHASE === 'antes' ? 'antes' : 'depois';
const AFTER = PHASE === 'depois';
const OUT = process.env.EVIDENCES_DIR || path.join(ROOT, 'evidences', 'images');
const FOLDER = 'sonar-antes-do-pr';

test.skip(process.env.EVIDENCES !== '1', 'só com EVIDENCES=1');

test('evidences: Sonar before the pull request', async () => {
  test.setTimeout(180_000);
  const dir = tempDir('ac-evid-sonar-pr-');
  const userData = tempDir('ac-evid-sonar-pr-data-');
  const github = await startFakeGitHub({ 'acme/api': [] });
  const sonar = await startFakeSonar();
  sonar.issues['ac/login'] = [
    {
      file: 'src/login.ts',
      line: 4,
      severity: 'CRITICAL',
      message: 'Make sure this password is not hard-coded',
      rule: 'ts:S2068',
    },
    {
      file: 'src/login.ts',
      line: 7,
      severity: 'MAJOR',
      message: 'Remove this log',
      rule: 'ts:S106',
    },
  ];
  const scanner = writeFakeScanner(dir);
  const { repo } = repoWithRemote(dir);
  const running = await launch(userData, fakeGitHubEnv(github));
  const { page } = running;
  const shot = async (name: string) => {
    fs.mkdirSync(path.join(OUT, FOLDER), { recursive: true });
    await page.waitForTimeout(800);
    await page.screenshot({ path: path.join(OUT, FOLDER, `${name}-${PHASE}.png`) });
  };
  try {
    await page.evaluate(
      (folder) => window.api.invoke('worktrees:configure', { folder, setup: '' }),
      path.join(dir, 'copias'),
    );
    const { id, cwd } = await isolatedSession(page, 'Login', repo, 'ac/login');
    const groupId = await groupOf(page, 'acme/api', [id]);
    const config = {
      provider: 'sonarqube' as const,
      url: sonar.url,
      projectKey: sonar.projectKey,
      organization: '',
      scanner,
      enabled: true,
      branches: true,
      onTurnEnd: false,
      beforePull: true,
    };
    await page.evaluate(
      ({ groupId, config, token }) => window.api.invoke('sonar:configure', groupId, config, token),
      { groupId, config, token: sonar.token },
    );

    // 1. The setup of Sonar of the group: the new option, on by default.
    const header = page.locator(`[data-group-id="${groupId}"] .group-header`);
    await header.hover();
    await header.getByTestId('sonar-button').click();
    await expect(page.locator('.sonar-dialog')).toBeVisible();
    await shot('01-configuracao');
    await page.locator('.sonar-dialog').getByRole('button', { name: 'Cancelar' }).click();

    fs.mkdirSync(path.join(cwd, 'src'), { recursive: true });
    fs.writeFileSync(
      path.join(cwd, 'src', 'login.ts'),
      "export function login(user: string) {\n  const senha = 'admin123';\n  return user === 'admin' && senha;\n}\n",
    );
    git(cwd, 'add', '-A');
    git(cwd, 'commit', '-q', '-m', 'Login com senha');

    // 2. The dialog of the pull request, before the click.
    await page.getByTestId('branch-button').click();
    const dialog = page.locator('.branch-dialog');
    await expect(dialog.getByTestId('branch-title')).toHaveValue('Login com senha');
    await shot('02-dialogo-do-pr');

    // 3. The click: before, the PR opens with the problems in it; now Sonar holds it.
    await dialog.getByTestId('branch-open-pull').click();
    if (AFTER) {
      await expect(dialog.getByTestId('branch-sonar')).toHaveAttribute('data-status', 'failed', {
        timeout: 30_000,
      });
    } else {
      await expect(dialog.getByTestId('branch-opened')).toBeVisible({ timeout: 30_000 });
    }
    await shot('03-ao-clicar');

    // 4. Fixed in a new commit: Sonar passes and the PR opens (before, it was already open).
    if (AFTER) {
      delete sonar.issues['ac/login'];
      fs.writeFileSync(
        path.join(cwd, 'src', 'login.ts'),
        'export function login(user: string, senha: string) {\n  return user === senha;\n}\n',
      );
      git(cwd, 'add', '-A');
      git(cwd, 'commit', '-q', '-m', 'Tira a senha do código');
      await dialog.getByRole('button', { name: 'Fechar', exact: true }).last().click();
      await page.getByTestId('branch-button').click();
      await dialog.getByTestId('branch-open-pull').click();
      await expect(dialog.getByTestId('branch-opened')).toBeVisible({ timeout: 30_000 });
      await shot('04-depois-da-correcao');
    }
    const head = git(cwd, 'rev-parse', 'HEAD').trim();
    await dialog.getByRole('button', { name: 'Fechar', exact: true }).last().click();
    await expect(dialog).toBeHidden();

    // 5. The list of pull requests: the PR of this commit says what Sonar found.
    github.repos['acme/api']![0]!.sha = head;
    await page.getByTestId('pulls-button').click();
    await page.getByTestId('pulls-refresh').click();
    const row = page.locator('[data-testid="pull-row"]').first();
    await expect(row).toBeVisible({ timeout: 20_000 });
    if (AFTER) await expect(row.getByTestId('pull-sonar')).toBeVisible({ timeout: 20_000 });
    await shot('05-lista-de-prs');
  } finally {
    await running.close();
    await github.close();
    await sonar.close();
    removeDir(userData);
    removeDir(repo);
    removeDir(dir);
  }
});
