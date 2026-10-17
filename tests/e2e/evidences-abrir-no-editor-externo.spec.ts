// The screens of "Open in editor", to attach to the pull request, as in `evidences.spec.ts`:
//
//   EVIDENCES=1 npx playwright test --config tests/e2e/playwright.config.ts evidences-abrir-no-editor-externo.spec.ts
//
// `EVIDENCES_PHASE=antes`, run on a build of the code as it was, takes the "before" of each pair:
// the same screens, on an app that has no button and no setting for an external editor yet.
import fs from 'node:fs';
import path from 'node:path';
import { expect, test } from '@playwright/test';
import { createSession, git, launch, removeDir, ROOT, tempDir } from './harness';

const PHASE = process.env.EVIDENCES_PHASE === 'antes' ? 'antes' : 'depois';
const OUT = process.env.EVIDENCES_DIR || path.join(ROOT, 'evidences', 'images');
const FOLDER = 'editor-externo';

test.skip(process.env.EVIDENCES !== '1', 'só com EVIDENCES=1');

test('evidences: open in the external editor', async () => {
  test.setTimeout(180_000);
  const userData = tempDir('ac-evid-data-');
  const folder = path.join(tempDir('ac-'), 'agent-controller');
  const file = 'src/core/sessions/SessionManager.ts';
  fs.mkdirSync(path.dirname(path.join(folder, file)), { recursive: true });
  const code = Array.from({ length: 60 }, (_, i) => `export const valor${i + 1} = ${i + 1};`);
  fs.writeFileSync(path.join(folder, file), `${code.join('\n')}\n`);
  git(folder, 'init', '-q', '-b', 'main');
  git(folder, 'config', 'user.email', 'e2e@example.com');
  git(folder, 'config', 'user.name', 'E2E');
  git(folder, 'config', 'commit.gpgsign', 'false');
  git(folder, 'add', '-A');
  git(folder, 'commit', '-q', '-m', 'base');
  fs.appendFileSync(path.join(folder, file), '// mudou\n');

  const running = await launch(userData);
  const { page } = running;
  const shot = async (name: string) => {
    fs.mkdirSync(path.join(OUT, FOLDER), { recursive: true });
    await page.waitForTimeout(700);
    await page.screenshot({ path: path.join(OUT, FOLDER, `${name}-${PHASE}.png`) });
  };

  try {
    await createSession(page, 'agent-controller', folder);

    // 1. The file of the panel at a line: after, with the button of the session and the one
    // beside the name of the file.
    await page.keyboard.press('Control+0');
    await page.keyboard.press('Control+P');
    const box = page.getByRole('dialog', { name: 'Abrir arquivo' });
    await expect(box).toBeVisible();
    const input = box.getByRole('textbox', { name: 'Nome do arquivo' });
    await input.fill('sesmgr:21');
    await expect(box.getByRole('option').first()).toContainText('SessionManager.ts');
    await input.press('Enter');
    await page
      .frameLocator('[data-testid="diff-frame"]')
      .locator('body[data-reveal-line="21"]')
      .waitFor();
    await shot('01-botoes-no-topo-e-no-painel');
    await page.keyboard.press('Escape');

    // 2. Preferences → Editor: after, the external editor with what was found, and "Other".
    await page.getByRole('button', { name: '⚙' }).click();
    const dialog = page.getByRole('dialog', { name: 'Preferências' });
    await expect(dialog).toBeVisible();
    await dialog.getByRole('tab', { name: 'Editor' }).click();
    if (PHASE === 'depois') {
      const settings = dialog.getByTestId('external-editor-settings');
      await settings.getByRole('combobox', { name: 'Editor' }).selectOption('other');
      const command = settings.getByRole('textbox', { name: 'Comando do editor' });
      await command.fill('notepad++ {arquivo} -n{linha}');
      await command.blur();
    }
    await shot('02-preferencias-editor-externo');
  } finally {
    await running.close();
    removeDir(userData);
    removeDir(path.dirname(folder));
  }
});
