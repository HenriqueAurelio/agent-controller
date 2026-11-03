// The screens of Sonar per group, to attach to the pull request, as in `evidences.spec.ts`:
//
//   EVIDENCES=1 npx playwright test --config tests/e2e/playwright.config.ts evidences-sonar.spec.ts
//
// `EVIDENCES_PHASE=antes`, run on a build of the code as it was, takes the "before" of each pair:
// the same group of two sessions, with no Sonar to set up and only the checks in the Problems tab.
import fs from 'node:fs';
import path from 'node:path';
import { expect, test } from '@playwright/test';
import { groupOf, sonarProject, startFakeSonar, writeFakeScanner } from './fake-sonar';
import { createSession, launch, removeDir, ROOT, tempDir } from './harness';

const PHASE = process.env.EVIDENCES_PHASE === 'antes' ? 'antes' : 'depois';
const OUT = process.env.EVIDENCES_DIR || path.join(ROOT, 'evidences', 'images');
const FOLDER = 'sonar';

test.skip(process.env.EVIDENCES !== '1', 'só com EVIDENCES=1');

test('evidences: Sonar per group, result per session', async () => {
  test.setTimeout(150_000);
  const dir = tempDir('ac-evid-sonar-');
  const userData = tempDir('ac-evid-data-');
  const sonar = await startFakeSonar();
  sonar.issues['feature-a'] = [
    { file: 'src/a.ts', line: 2, severity: 'MAJOR', message: 'Remove this log', rule: 'ts:S106' },
    {
      file: 'src/a.ts',
      line: 1,
      severity: 'MINOR',
      message: 'Rename "a" to match the camelCase pattern',
      rule: 'ts:S100',
    },
  ];
  const scanner = writeFakeScanner(dir);
  const { repo, copy } = await sonarProject(dir);
  const running = await launch(userData);
  const { page } = running;
  const shot = async (name: string) => {
    fs.mkdirSync(path.join(OUT, FOLDER), { recursive: true });
    await page.waitForTimeout(800);
    await page.screenshot({ path: path.join(OUT, FOLDER, `${name}-${PHASE}.png`) });
  };
  try {
    const a = await createSession(page, 'feature-a', repo);
    const b = await createSession(page, 'feature-b', copy);
    const groupId = await groupOf(page, 'acme/api', [a, b]);
    const header = page.locator(`[data-group-id="${groupId}"] .group-header`);

    // 1. The group: nothing to set up, or the connection of Sonar, tested.
    await header.hover();
    if (PHASE === 'depois') {
      await header.getByTestId('sonar-button').click();
      const dialog = page.locator('.sonar-dialog');
      await dialog.getByTestId('sonar-url').fill(sonar.url);
      await dialog.getByTestId('sonar-project').fill(sonar.projectKey);
      await dialog.getByTestId('sonar-scanner').fill(scanner);
      await dialog.getByTestId('sonar-token').fill(sonar.token);
      await dialog.getByTestId('sonar-turn-end').check();
      await dialog.getByTestId('sonar-test').click();
      await expect(dialog.getByTestId('sonar-test-result')).toBeVisible();
    }
    await shot('01-conexao-no-grupo');

    // 2. After an analysis: the Problems tab of the session on feature-a, with only the checks,
    // or with the issues of Sonar of its own branch, and the summary of the group.
    if (PHASE === 'depois') {
      const dialog = page.locator('.sonar-dialog');
      await dialog.getByTestId('sonar-save').click();
      await header.hover();
      await header.getByTestId('sonar-button').click();
      await dialog.getByTestId('sonar-run-group').click();
      const summary = header.getByTestId('group-sonar-summary');
      await expect(summary).toHaveAttribute('data-failed', '1', { timeout: 30_000 });
      await expect(summary).toHaveAttribute('data-passed', '1');
      await expect(summary).toHaveText('1✓1✗');
    }
    await page.locator('.session-item', { hasText: 'feature-a' }).first().click();
    await page.keyboard.press('Control+Shift+P');
    await page
      .getByRole('dialog', { name: 'Paleta de comandos' })
      .getByRole('option', { name: /^Problemas: ver os erros/ })
      .click();
    if (PHASE === 'depois') await expect(page.getByTestId('problem-row')).toHaveCount(2);
    await shot('02-resultado-da-sessao');
  } finally {
    await running.close();
    await sonar.close();
    removeDir(userData);
    removeDir(dir);
  }
});
