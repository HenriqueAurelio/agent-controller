// Sonar per group, with the result per session (docs/planos/sonar-por-grupo-e-worktree.md): two
// sessions of the same repository on different branches, one with problems and one without.
import fs from 'node:fs';
import path from 'node:path';
import { expect, test } from '@playwright/test';
import { groupOf, sonarProject, startFakeSonar, writeFakeScanner } from './fake-sonar';
import { createSession, launch, removeDir, tempDir } from './harness';

test('Sonar is set up once for the group, and each session gets its own result', async () => {
  test.setTimeout(150_000);
  const dir = tempDir('ac-e2e-sonar-');
  const userData = tempDir('ac-e2e-sonar-data-');
  const sonar = await startFakeSonar();
  sonar.issues['feature-a'] = [
    { file: 'src/a.ts', line: 2, severity: 'MAJOR', message: 'Remove this log', rule: 'ts:S106' },
  ];
  const scanner = writeFakeScanner(dir);
  const { repo, copy } = await sonarProject(dir);
  const running = await launch(userData);
  const { page } = running;
  try {
    const a = await createSession(page, 'A', repo);
    const b = await createSession(page, 'B', copy);
    const groupId = await groupOf(page, 'acme/api', [a, b]);

    // The connection, in the group: a wrong token is told, then the right one works.
    const header = page.locator(`[data-group-id="${groupId}"] .group-header`);
    await header.hover();
    await header.getByTestId('sonar-button').click();
    const dialog = page.locator('.sonar-dialog');
    await dialog.getByTestId('sonar-url').fill(sonar.url);
    await dialog.getByTestId('sonar-project').fill(sonar.projectKey);
    await dialog.getByTestId('sonar-scanner').fill(scanner);
    await dialog.getByTestId('sonar-token').fill('errado');
    await dialog.getByTestId('sonar-test').click();
    await expect(dialog.getByTestId('sonar-test-result')).toHaveText('O servidor recusou o token.');
    await dialog.getByTestId('sonar-token').fill(sonar.token);
    await dialog.getByTestId('sonar-test').click();
    await expect(dialog.getByTestId('sonar-test-result')).toHaveText(
      'Conexão funcionando: o token vale e o projeto existe.',
    );
    await dialog.getByTestId('sonar-save').click();
    await expect(dialog).toBeHidden();

    // The token is not in any file of the app in plain text.
    const files = fs.readdirSync(userData).filter((f) => f.startsWith('sonar'));
    for (const file of files) {
      const full = path.join(userData, file);
      if (fs.statSync(full).isFile()) {
        expect(fs.readFileSync(full, 'utf8')).not.toContain(sonar.token);
      }
    }

    // Both sessions are analysed now: one passes, the other has problems.
    await header.hover();
    await header.getByTestId('sonar-button').click();
    await dialog.getByTestId('sonar-run-group').click();
    const summary = header.getByTestId('group-sonar-summary');
    await expect(summary).toHaveAttribute('data-failed', '1', { timeout: 30_000 });
    await expect(summary).toHaveAttribute('data-passed', '1');
    await expect(summary).toHaveText('1✓1✗');

    // Session A: its problem joins the Problems tab, said to come from Sonar.
    await page.locator('.session-item', { hasText: 'A' }).first().click();
    await expect(page.getByTestId('sonar-chip')).toHaveText('Sonar: com problemas');
    await page.keyboard.press('Control+Shift+P');
    await page
      .getByRole('dialog', { name: 'Paleta de comandos' })
      .getByRole('option', { name: /^Problemas: ver os erros/ })
      .click();
    const rows = page.getByTestId('problem-row');
    await expect(rows).toHaveCount(1);
    await expect(rows.first()).toContainText('Remove this log (ts:S106)');
    await expect(rows.first()).toContainText('Sonar');

    // Session B passed, with nothing to show.
    await page.keyboard.press('Escape');
    await page.locator('.session-item', { hasText: 'B' }).first().click();
    await expect(page.getByTestId('sonar-chip')).toHaveText('Sonar: passou');
  } finally {
    await running.close();
    await sonar.close();
    removeDir(userData);
    removeDir(dir);
  }
});
