import fs from 'node:fs';
import path from 'node:path';
import { expect, test, type Page } from '@playwright/test';
import {
  createSession,
  git,
  launch,
  makeRepo,
  removeDir,
  screenText,
  setTitle,
  tempDir,
} from './harness';

const lines = (name: string) =>
  Array.from({ length: 30 }, (_, i) => `export const ${name}${i + 1} = ${i + 1};`).join('\n');

/** A project whose "typecheck" prints what tsc prints, and whose "lint" prints file:line:col. */
export function makeProblemsProject(): string {
  const repo = makeRepo();
  fs.mkdirSync(path.join(repo, 'src'), { recursive: true });
  fs.writeFileSync(path.join(repo, 'src', 'soma.ts'), lines('soma'));
  fs.writeFileSync(path.join(repo, 'src', 'texto.ts'), lines('texto'));
  fs.writeFileSync(
    path.join(repo, 'typecheck.cjs'),
    [
      'const out = [',
      "  \"src/soma.ts(12,7): error TS2322: Type 'string' is not assignable to type 'number'.\",",
      '  "src/texto.ts(5,3): error TS2304: Cannot find name \'maiuscula\'.",',
      '  "src/soma.ts(20,1): error TS2551: Property \'total\' does not exist.",',
      "  'Found 3 errors in 2 files.',",
      '];',
      "console.log(out.join('\\n'));",
      'process.exit(2);',
      '',
    ].join('\n'),
  );
  fs.writeFileSync(
    path.join(repo, 'lint.cjs'),
    ["console.log('src/texto.ts:9:2: warning: variável sem uso');", 'process.exit(1);', ''].join(
      '\n',
    ),
  );
  git(repo, 'add', '-A');
  git(repo, 'commit', '-q', '-m', 'projeto');
  return repo;
}

export async function configureProblemChecks(page: Page, sessionId: string) {
  await page.evaluate(
    (id) =>
      window.api.invoke('checks:configure', id, [
        {
          id: 'typecheck',
          label: 'typecheck',
          command: 'node typecheck.cjs',
          timeoutSec: 60,
          onTurnEnd: false,
        },
        { id: 'lint', label: 'lint', command: 'node lint.cjs', timeoutSec: 60, onTurnEnd: false },
      ]),
    sessionId,
  );
}

test('the Problems tab lists what the checks printed, opens it on its line, and sends only the ticked ones', async () => {
  test.setTimeout(180_000);
  const userData = tempDir('ac-e2e-problems-');
  const repo = makeProblemsProject();
  const running = await launch(userData);
  const { page } = running;
  try {
    const id = await createSession(page, 'Projeto', repo);
    await configureProblemChecks(page, id);

    // From the palette: the panel opens on the tab, still empty.
    await page.keyboard.press('Control+Shift+P');
    await page
      .getByRole('dialog', { name: 'Paleta de comandos' })
      .getByRole('option', { name: /^Problemas: ver os erros/ })
      .click();
    const list = page.getByTestId('problems-list');
    await expect(list).toContainText('As verificações ainda não rodaram nesta pasta.');
    await expect(page.getByTestId('problems-tab')).toHaveAttribute('aria-pressed', 'true');

    await page.getByTestId('problems-run').click();
    const rows = page.getByTestId('problem-row');
    await expect(rows).toHaveCount(4, { timeout: 60_000 });
    await expect(page.getByTestId('problems-tab')).toHaveText('Problemas (4)');
    // By file, with the check each came from; the summary line of tsc is not a problem.
    const files = page.getByTestId('problems-file');
    await expect(files).toHaveCount(2);
    await expect(files.nth(0)).toContainText('src/soma.ts');
    await expect(files.nth(0).getByTestId('problem-row')).toHaveCount(2);
    await expect(files.nth(1).getByTestId('problem-row')).toHaveCount(2);
    await expect(rows.nth(0)).toContainText('typecheck');
    await expect(rows.nth(0)).toHaveAttribute('data-severity', 'error');
    await expect(files.nth(1).getByTestId('problem-row').nth(1)).toHaveAttribute(
      'data-severity',
      'warning',
    );

    // A click opens the file on the line, underlined like the editor's own errors.
    await rows.nth(0).getByTestId('problem-open').click();
    const frame = page.frameLocator('[data-testid="diff-frame"]');
    await expect(frame.locator('body[data-reveal-line="12"]')).toHaveCount(1, { timeout: 20_000 });
    await expect(frame.locator('body[data-reveal-path="src/soma.ts"]')).toHaveCount(1);
    await expect(frame.locator('body[data-markers="2"]')).toHaveCount(1);
    await expect(frame.locator('.squiggly-error').first()).toBeAttached();

    // Two ticked go to the agent through the prompt; the other two stay out.
    await rows.nth(0).getByTestId('problem-mark').check();
    await rows.nth(2).getByTestId('problem-mark').check();
    await page.getByTestId('problems-send-marked').click();
    const dialog = page.getByRole('dialog', { name: 'Enviar prompt' });
    const text = dialog.getByLabel('Texto a enviar');
    await expect(text).toContainText('Corrija estes problemas');
    await expect(dialog.getByTestId('prompt-preview')).toContainText('src/soma.ts:12:7 error');
    await dialog.getByRole('button', { name: 'Enviar', exact: true }).click();
    await expect(dialog).toBeHidden();
    await expect
      .poll(() => screenText(page, id), { timeout: 15_000 })
      .toContain('src/soma.ts:12:7');
    // The terminal wraps long lines: compare without the breaks.
    const screen = (await screenText(page, id)).replace(/\s+/g, '');
    expect(screen).toContain('src/texto.ts:5:3');
    expect(screen).not.toContain('src/soma.ts:20:1');
    expect(screen).not.toContain('src/texto.ts:9:2');
  } finally {
    await running.close();
    removeDir(userData);
    removeDir(repo);
  }
});

test('the list says it is from the last run while the agent works', async () => {
  test.setTimeout(180_000);
  const userData = tempDir('ac-e2e-problems-');
  const repo = makeProblemsProject();
  const running = await launch(userData);
  const { page } = running;
  try {
    const id = await createSession(page, 'Projeto', repo);
    await configureProblemChecks(page, id);
    await page.evaluate((sid) => window.api.invoke('checks:run', sid), id);
    await page.keyboard.press('Control+Shift+P');
    await page
      .getByRole('dialog', { name: 'Paleta de comandos' })
      .getByRole('option', { name: /^Problemas: ver os erros/ })
      .click();
    const rows = page.getByTestId('problem-row');
    await expect(rows).toHaveCount(4, { timeout: 60_000 });
    await expect(page.getByTestId('problems-list')).toHaveAttribute('data-stale', 'false');

    // The agent goes back to work: the list is the last run's, and says so.
    // The panel sits beside the terminal, so the terminal can be typed in.
    await page.evaluate(async () => {
      const { layout } = await window.api.invoke('prefs:get');
      await window.api.invoke('prefs:set', { layout: { ...layout, panel: 'right' } });
    });
    await setTitle(page, '◐ x');
    await expect(page.getByTestId('problems-list')).toHaveAttribute('data-stale', 'true', {
      timeout: 15_000,
    });
    await expect(page.getByTestId('problems-stale')).toBeVisible();
    await expect(rows).toHaveCount(4);
  } finally {
    await running.close();
    removeDir(userData);
    removeDir(repo);
  }
});
