// The screens of the way from a copy to its pull request, to attach to the pull request, as in
// `evidences.spec.ts`:
//
//   EVIDENCES=1 npx playwright test --config tests/e2e/playwright.config.ts evidences-da-copia-ao-pr.spec.ts
//
// `EVIDENCES_PHASE=antes`, run on a build of the code as it was, takes the "before" of each pair:
// the same session in a copy, with its commit, and no way out of the app to a pull request.
import fs from 'node:fs';
import path from 'node:path';
import { expect, test } from '@playwright/test';
import { isolatedSession, repoWithRemote } from './copy-helpers';
import { fakeGitHubEnv, startFakeGitHub } from './fake-github';
import { git, launch, removeDir, ROOT, tempDir } from './harness';

const PHASE = process.env.EVIDENCES_PHASE === 'antes' ? 'antes' : 'depois';
const OUT = process.env.EVIDENCES_DIR || path.join(ROOT, 'evidences', 'images');
const FOLDER = 'da-copia-ao-pr';

test.skip(process.env.EVIDENCES !== '1', 'só com EVIDENCES=1');

test('evidences: from the copy to the pull request', async () => {
  test.setTimeout(180_000);
  const dir = tempDir('ac-evid-pr-copy-');
  const userData = tempDir('ac-evid-data-');
  const fake = await startFakeGitHub({ 'acme/api': [] });
  const { repo } = repoWithRemote(dir);
  const running = await launch(userData, fakeGitHubEnv(fake));
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
    const { cwd } = await isolatedSession(page, 'login', repo, 'ac/12-login-quebra');
    fs.writeFileSync(path.join(cwd, 'login.ts'), 'export const ok = true;\n');
    git(cwd, 'add', '-A');
    git(cwd, 'commit', '-q', '-m', 'Arruma o login no Safari');
    fs.writeFileSync(path.join(cwd, 'login.test.ts'), 'test("ok", () => {});\n');
    git(cwd, 'add', '-A');
    git(cwd, 'commit', '-q', '-m', 'Teste do login');

    // 1. The session in its copy: no way to the pull request, or the dialog with the commits.
    if (PHASE === 'depois') {
      await page.getByTestId('branch-button').click();
      await expect(page.locator('.branch-dialog').getByTestId('branch-title')).toHaveValue(
        'Arruma o login no Safari',
      );
    }
    await shot('01-a-copia-com-commits');

    // 2. Pushed and opened, without a terminal or the site.
    if (PHASE === 'depois') {
      const dialog = page.locator('.branch-dialog');
      await dialog.getByTestId('branch-open-pull').click();
      await expect(dialog.getByTestId('branch-opened')).toBeVisible({ timeout: 30_000 });
      await shot('02-pr-aberto');
    }
  } finally {
    await running.close();
    await fake.close();
    removeDir(userData);
    removeDir(repo);
    removeDir(dir);
  }
});
