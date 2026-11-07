// The history of a file from the editor of the panel: its commits, what each changed, and who
// changed the line of the cursor.
import fs from 'node:fs';
import path from 'node:path';
import { expect, test } from '@playwright/test';
import { createSession, git, launch, makeRepo, removeDir, ROOT, tempDir } from './harness';

const PHASE = process.env.EVIDENCES_PHASE === 'antes' ? 'antes' : 'depois';

test('the history of a file lists its commits and says who changed the line of the cursor', async () => {
  test.setTimeout(120_000);
  const userData = tempDir('ac-e2e-history-');
  const repo = makeRepo();
  const file = path.join(repo, 'src', 'app.ts');
  fs.writeFileSync(file, 'const total = 10;\nconsole.log(total);\n');
  git(repo, 'commit', '-q', '-am', 'Total de dez');
  git(repo, 'config', 'user.name', 'Bruno');
  fs.writeFileSync(file, 'const total = 20;\nconsole.log(total);\n');
  git(repo, 'commit', '-q', '-am', 'Total de vinte');
  // The agent changes it again, not committed yet.
  fs.writeFileSync(file, 'const total = 30;\nconsole.log(total);\n');
  const running = await launch(userData);
  const { page } = running;
  const shot = async (name: string) => {
    if (process.env.EVIDENCES !== '1') return;
    const out = process.env.EVIDENCES_DIR || path.join(ROOT, 'evidences', 'images');
    fs.mkdirSync(path.join(out, 'historico-do-arquivo'), { recursive: true });
    await page.waitForTimeout(800);
    await page.screenshot({ path: path.join(out, 'historico-do-arquivo', `${name}-${PHASE}.png`) });
  };
  try {
    await createSession(page, 'Projeto', repo);
    await page.keyboard.press('Control+Shift+G');
    const panel = page.locator('.changes-panel');
    await panel.locator('.change-item[data-path="src/app.ts"]').click();
    const frame = page.frameLocator('[data-testid="diff-frame"]');
    await frame.locator('body[data-path="src/app.ts"]').waitFor();
    // The cursor on the second line, which the last commit did not touch.
    await frame.locator('.editor.modified .view-line', { hasText: 'console.log' }).click();
    if (PHASE === 'antes') {
      await shot('01-historico');
      return;
    }
    await panel.getByTestId('diff-history').click();
    const dialog = page.locator('.history-dialog');
    await expect(dialog.getByTestId('history-commit')).toHaveCount(3);
    await expect(dialog.getByTestId('history-commit').first()).toContainText('Total de vinte');
    await expect(dialog.getByTestId('history-blame')).toContainText('Linha 2: E2E');
    await expect(dialog.getByTestId('history-blame')).toContainText('Total de dez');
    // The commit of the line is picked, with what it changed in the file.
    // Its diff loaded (it adds both lines) before the click: while it loads the list may move.
    await expect(dialog.getByTestId('history-diff').locator('.line-add')).toHaveCount(2);
    await expect(dialog.getByTestId('history-diff')).toContainText('const total = 10;');
    await dialog.getByTestId('history-commit').first().click();
    await expect(dialog.getByTestId('history-commit').first()).toHaveClass(/current/);
    // What the main process gives for that commit, apart from the dialog: when the two disagree,
    // the message says which side is wrong, with what git itself says.
    const head = git(repo, 'rev-parse', 'HEAD').trim();
    const sessionId = await page
      .locator('.session-item[aria-selected="true"]')
      .getAttribute('data-session-id');
    const fromMain = await page.evaluate(
      ([id, sha]) => window.api.invoke('git:commitDiff', id!, 'src/app.ts', sha!),
      [sessionId, head],
    );
    const added = fromMain.flatMap((h) =>
      h.lines.filter((l) => l.kind === 'add').map((l) => l.text),
    );
    expect(
      added,
      `git:commitDiff(${head}): ${JSON.stringify(fromMain)}\n` +
        git(repo, 'log', '--follow', '-p', '--format=%H %s', '-1', head, '--', 'src/app.ts'),
    ).toContain('const total = 20;');
    await expect(dialog.getByTestId('history-diff').locator('.line-add')).toContainText(
      'const total = 20;',
    );
    await shot('01-historico');
  } finally {
    await running.close();
    removeDir(userData);
    removeDir(repo);
  }
});
