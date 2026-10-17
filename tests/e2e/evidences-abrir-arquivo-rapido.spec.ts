// The screens of the quick open, to attach to the pull request, as in `evidences.spec.ts`:
//
//   EVIDENCES=1 npx playwright test --config tests/e2e/playwright.config.ts evidences-abrir-arquivo-rapido.spec.ts
//
// `EVIDENCES_PHASE=antes`, run on a build of the code as it was, takes the "before" of each pair:
// the same keys, on an app where Ctrl+P does nothing yet (the panel's tree is the way to a file).
import fs from 'node:fs';
import path from 'node:path';
import { expect, test } from '@playwright/test';
import { createSession, git, launch, removeDir, ROOT, tempDir } from './harness';

const PHASE = process.env.EVIDENCES_PHASE === 'antes' ? 'antes' : 'depois';
const OUT = process.env.EVIDENCES_DIR || path.join(ROOT, 'evidences', 'images');
const FOLDER = 'abrir-arquivo-rapido';

test.skip(process.env.EVIDENCES !== '1', 'só com EVIDENCES=1');

const FILES = [
  'src/core/sessions/SessionManager.ts',
  'src/core/sessions/SessionStore.ts',
  'src/core/sessions/ScreenHistory.ts',
  'src/core/git/ChangesService.ts',
  'src/core/git/FileIndex.ts',
  'src/main/ipc.ts',
  'src/main/app.ts',
  'src/shared/ipc.ts',
  'src/shared/git.ts',
  'src/renderer/src/App.tsx',
  'src/renderer/src/components/Sidebar.tsx',
  'tests/core/checks.test.ts',
  'README.md',
  'package.json',
];

const body = (name: string) =>
  [
    `// ${name}`,
    ...Array.from(
      { length: 70 },
      (_, i) => `export const valor${i + 1} = ${i + 1}; // linha ${i + 1}`,
    ),
    '',
  ].join('\n');

test('evidences: quick open', async () => {
  test.setTimeout(180_000);
  const userData = tempDir('ac-evid-data-');
  const folder = path.join(tempDir('ac-'), 'agent-controller');
  for (const file of FILES) {
    fs.mkdirSync(path.dirname(path.join(folder, file)), { recursive: true });
    fs.writeFileSync(path.join(folder, file), body(file));
  }
  git(folder, 'init', '-q', '-b', 'main');
  git(folder, 'config', 'user.email', 'e2e@example.com');
  git(folder, 'config', 'user.name', 'E2E');
  git(folder, 'config', 'commit.gpgsign', 'false');
  git(folder, 'add', '-A');
  git(folder, 'commit', '-q', '-m', 'base');
  fs.appendFileSync(path.join(folder, 'src/main/ipc.ts'), '// novo canal\n');
  fs.appendFileSync(path.join(folder, 'src/shared/ipc.ts'), '// novo canal\n');
  fs.writeFileSync(path.join(folder, 'src/core/git/Nova.ts'), body('Nova'));

  const running = await launch(userData);
  const { page } = running;
  const shot = async (name: string) => {
    fs.mkdirSync(path.join(OUT, FOLDER), { recursive: true });
    await page.waitForTimeout(700);
    await page.screenshot({ path: path.join(OUT, FOLDER, `${name}-${PHASE}.png`) });
  };
  const box = page.getByRole('dialog', { name: 'Abrir arquivo' });
  const frame = page.frameLocator('[data-testid="diff-frame"]');

  try {
    await createSession(page, 'agent-controller', folder);
    // The focus out of the terminal, where Ctrl+P belongs to the app.
    await page.keyboard.press('Control+0');

    // 1. Three letters of the name: the new build lists the files that match.
    await page.keyboard.press('Control+P');
    if (PHASE === 'depois') {
      await expect(box).toBeVisible();
      await box.getByRole('textbox', { name: 'Nome do arquivo' }).fill('sesmgr');
      await expect(box.getByRole('option').first()).toContainText('SessionManager.ts');
    } else {
      await page.keyboard.type('sesmgr');
    }
    await shot('01-buscar-pelo-nome');

    // 2. Enter, on a line: the new build opens the file there; the old one has the tree.
    if (PHASE === 'depois') {
      await box.getByRole('textbox', { name: 'Nome do arquivo' }).fill('sesmgr:42');
      await page.keyboard.press('Enter');
      await frame.locator('body[data-reveal-line="42"]').waitFor();
    } else {
      await page.keyboard.press('Control+Shift+E');
      await page.getByRole('region', { name: 'Mudanças' }).waitFor();
    }
    await shot('02-abrir-na-linha');

    // 3. The empty box: what was opened last, and what changed.
    await page.keyboard.press('Control+0');
    await page.keyboard.press('Control+P');
    if (PHASE === 'depois') {
      await expect(box.getByRole('option').first()).toContainText('SessionManager.ts');
      await expect(box.getByRole('option')).toHaveCount(4);
    }
    await shot('03-caixa-vazia-recentes-e-mudados');
  } finally {
    await running.close();
    removeDir(userData);
    removeDir(path.dirname(folder));
  }
});
