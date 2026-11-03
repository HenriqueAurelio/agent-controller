// The screens of the review (comments on the diff), to attach to the pull request, as in
// `evidences.spec.ts`:
//
//   EVIDENCES=1 npx playwright test --config tests/e2e/playwright.config.ts evidences-comentar-no-diff.spec.ts
//
// `EVIDENCES_PHASE=antes`, run on a build of the code as it was, takes the "before" of each pair:
// the same project and the same changes, where the only way to point the agent at a line was to
// select it and send it alone with a prompt.
import fs from 'node:fs';
import path from 'node:path';
import { expect, test, type FrameLocator, type Page } from '@playwright/test';
import { createSession, git, launch, makeRepo, removeDir, ROOT, tempDir } from './harness';

const PHASE = process.env.EVIDENCES_PHASE === 'antes' ? 'antes' : 'depois';
const OUT = process.env.EVIDENCES_DIR || path.join(ROOT, 'evidences', 'images');
const FOLDER = 'comentar-no-diff';

test.skip(process.env.EVIDENCES !== '1', 'só com EVIDENCES=1');

const BEFORE = `import { runGit } from './GitService';

const MAX_FILE_SIZE = 4 * 1024 * 1024;

export async function readSide(cwd: string, file: string): Promise<string> {
  const { stdout } = await runGit(cwd, ['show', \`HEAD:\${file}\`]);
  if (stdout.length > MAX_FILE_SIZE) throw new Error('too large');
  return stdout.toString('utf8');
}

export function isBinary(buffer: Buffer): boolean {
  return buffer.subarray(0, 8000).includes(0);
}
`;

const AFTER = `import { runGit } from './GitService';

const MAX_FILE_SIZE = 4 * 1024 * 1024;

export async function readSide(cwd: string, file: string): Promise<string> {
  const { stdout } = await runGit(cwd, ['show', \`HEAD:\${file}\`]);
  if (stdout.length > 4 * 1024 * 1024) throw new Error('too large');
  console.log('lido', file, stdout.length);
  return stdout.toString('utf8');
}

export function isBinary(buffer: Buffer): boolean {
  return buffer.includes(0);
}
`;

function makeProject(): string {
  const repo = makeRepo();
  const file = path.join(repo, 'src', 'core', 'git', 'readSide.ts');
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, BEFORE);
  git(repo, 'add', '-A');
  git(repo, 'commit', '-q', '-m', 'projeto');
  fs.writeFileSync(file, AFTER);
  return repo;
}

const lineOf = (frame: FrameLocator, text: string) =>
  frame.locator('.editor.modified .view-line', { hasText: text }).first();

async function comment(page: Page, frame: FrameLocator, text: string, body: string) {
  await lineOf(frame, text).click();
  await page.getByTestId('diff-comment').click();
  const dialog = page.locator('.review-comment-dialog');
  await dialog.getByTestId('review-comment-text').fill(body);
  await dialog.getByTestId('review-comment-save').click();
  await expect(dialog).toBeHidden();
}

test('evidences: comments on the diff', async () => {
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
    await frame.locator('body[data-path="src/core/git/readSide.ts"]').waitFor({ timeout: 20_000 });

    // 1. The diff with two remarks: nowhere to write them, or each under its line.
    if (PHASE === 'depois') {
      await comment(
        page,
        frame,
        '4 * 1024 * 1024)',
        'Use a constante MAX_FILE_SIZE em vez de repetir o limite.',
      );
      await comment(page, frame, "console.log('lido'", 'Tire este log de depuração.');
      await comment(
        page,
        frame,
        'buffer.includes(0)',
        'Volte a olhar só os primeiros 8000 bytes: o arquivo inteiro é lento.',
      );
      await expect(frame.locator('body[data-comments="3"]')).toHaveCount(1);
    }
    await shot('01-comentarios-no-diff');

    // 2. The list of what to change: the tab of the review, or nothing but the changed files.
    if (PHASE === 'depois') {
      await panel.getByTestId('review-tab').click();
      await expect(page.getByTestId('review-row')).toHaveCount(3);
      await page.getByTestId('review-row').nth(1).getByTestId('review-open').click();
      await frame.locator('body[data-reveal-line="8"]').waitFor({ timeout: 20_000 });
    }
    await shot('02-aba-revisao');

    // 3. What reaches the agent: one prompt with every remark and its place, or one selection
    // with no line number, to be explained by hand.
    if (PHASE === 'depois') {
      await page.getByTestId('review-send').click();
      await expect(page.getByTestId('prompt-preview')).toContainText('readSide.ts:13');
    } else {
      await lineOf(frame, '4 * 1024 * 1024)').click({ clickCount: 3 });
      await panel.getByRole('button', { name: 'Mandar ao agente com o prompt…' }).click();
      await expect(page.getByTestId('prompt-preview')).toBeVisible();
    }
    await shot('03-prompt-para-o-agente');
  } finally {
    await running.close();
    removeDir(userData);
    removeDir(repo);
  }
});
