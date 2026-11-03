// The screens of the scroll of every block, to attach to the pull request, as in
// `evidences.spec.ts`:
//
//   EVIDENCES=1 npx playwright test --config tests/e2e/playwright.config.ts evidences-multibuffer.spec.ts
//
// `EVIDENCES_PHASE=antes`, run on a build of the code as it was, takes the "before" of each pair:
// the same turn of four files, read one file at a time in the panel.
import fs from 'node:fs';
import path from 'node:path';
import { expect, test } from '@playwright/test';
import { createSession, git, launch, makeRepo, removeDir, ROOT, tempDir } from './harness';

const PHASE = process.env.EVIDENCES_PHASE === 'antes' ? 'antes' : 'depois';
const OUT = process.env.EVIDENCES_DIR || path.join(ROOT, 'evidences', 'images');
const FOLDER = 'multibuffer';

test.skip(process.env.EVIDENCES !== '1', 'só com EVIDENCES=1');

const body = (name: string) =>
  Array.from({ length: 40 }, (_, i) => `export const ${name}${i + 1} = ${i + 1};`);

/** A turn that touched four files, a few lines in each. */
function makeProject(): string {
  const repo = makeRepo();
  const files = ['src/core/limits.ts', 'src/core/session.ts', 'src/main/ipc.ts', 'src/ui/List.tsx'];
  for (const file of files) {
    fs.mkdirSync(path.dirname(path.join(repo, file)), { recursive: true });
    fs.writeFileSync(path.join(repo, file), `${body('v').join('\n')}\n`);
  }
  git(repo, 'add', '-A');
  git(repo, 'commit', '-q', '-m', 'projeto');
  const edit = (file: string, change: (lines: string[]) => void) => {
    const lines = body('v');
    change(lines);
    fs.writeFileSync(path.join(repo, file), `${lines.join('\n')}\n`);
  };
  edit('src/core/limits.ts', (l) => {
    l[4] = 'export const v5 = 5 * 1024 * 1024; // limite novo';
    l.splice(20, 0, 'export const MAX_FILES = 150;');
  });
  edit('src/core/session.ts', (l) => {
    l[9] = "export const v10 = 'dez';";
  });
  edit('src/main/ipc.ts', (l) => {
    l.splice(2, 1);
    l[30] = 'export const v32 = validate(32);';
  });
  edit('src/ui/List.tsx', (l) => {
    l[0] = "import { useMemo } from 'react';";
  });
  return repo;
}

test('evidences: every block in one scroll', async () => {
  test.setTimeout(180_000);
  const userData = tempDir('ac-evid-data-');
  const repo = makeProject();
  const running = await launch(userData);
  const { page } = running;
  const shot = async (name: string) => {
    fs.mkdirSync(path.join(OUT, FOLDER), { recursive: true });
    await page.waitForTimeout(800);
    await page.screenshot({ path: path.join(OUT, FOLDER, `${name}-${PHASE}.png`) });
  };

  try {
    await createSession(page, 'agent-controller', repo);
    await page.keyboard.press('Control+Shift+P');
    await page
      .getByRole('dialog', { name: 'Paleta de comandos' })
      .getByRole('option', { name: /^Ver mudanças/ })
      .click();
    const panel = page.locator('.changes-panel');
    const frame = page.frameLocator('[data-testid="diff-frame"]');
    await frame.locator('body[data-path]').waitFor({ timeout: 20_000 });

    // 1. Reading the turn: one file at a time, or every block of the four files in one scroll.
    if (PHASE === 'depois') {
      await panel.getByTestId('all-tab').click();
      await expect(page.getByTestId('multidiff-hunk')).toHaveCount(6);
    }
    await shot('01-o-turno-inteiro');

    // 2. Going through it: the next file by hand, or blocks marked as seen, one undone and one
    // commented.
    if (PHASE === 'depois') {
      const hunks = page.getByTestId('multidiff-hunk');
      await hunks.nth(0).getByTestId('multidiff-accept').click();
      await hunks.nth(0).getByTestId('multidiff-accept').click();
      await hunks.nth(0).getByTestId('multidiff-comment').click();
      const dialog = page.locator('.review-comment-dialog');
      await dialog.getByTestId('review-comment-text').fill('Use um número, como nas outras.');
      await dialog.getByTestId('review-comment-save').click();
      await expect(dialog).toBeHidden();
      await expect(page.getByTestId('multidiff-seen')).toHaveText('2 de 6 trechos vistos');
    } else {
      await panel.locator('.change-item[data-path="src/core/session.ts"]').click();
      await frame.locator('body[data-path="src/core/session.ts"]').waitFor();
    }
    await shot('02-revisando');
  } finally {
    await running.close();
    removeDir(userData);
    removeDir(repo);
  }
});
