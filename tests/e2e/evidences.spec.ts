// The screens of folders, theme of the editor, layout and settings, to attach to the pull
// request: the same scenario photographed before and after the change. They go to evidences/,
// which git ignores. It only runs when asked:
//
//   EVIDENCES=1 npx playwright test --config tests/e2e/playwright.config.ts evidences.spec.ts
//
// `EVIDENCES_PHASE=antes`, run on a build of the code as it was, takes the "before" of each pair
// and leaves out the steps that did not exist yet.
import fs from 'node:fs';
import path from 'node:path';
import { test, type Page } from '@playwright/test';
import { createSession, launch, makeRepo, removeDir, ROOT, tempDir } from './harness';

const PHASE = process.env.EVIDENCES_PHASE === 'antes' ? 'antes' : 'depois';
const AFTER = PHASE === 'depois';
const OUT = process.env.EVIDENCES_DIR || path.join(ROOT, 'evidences', 'images');

test.skip(process.env.EVIDENCES !== '1', 'só com EVIDENCES=1');

test('evidences: folders, theme of the editor, layout and settings', async () => {
  test.setTimeout(180_000);
  const userData = tempDir('ac-evid-data-');
  // Short, stable paths: they are in the pictures.
  const base = tempDir('ac-');
  const repo = makeRepo();
  const loja = path.join(base, 'loja');
  const api = path.join(base, 'api');
  fs.renameSync(repo, loja);
  fs.mkdirSync(api);
  fs.writeFileSync(
    path.join(loja, 'velho.txt'),
    'linha um\nlinha 2 mudou\nlinha três\nlinha nova\n',
  );
  fs.writeFileSync(path.join(loja, 'editado.ts'), 'export const valor = 2;\n');

  const running = await launch(userData);
  const { page } = running;
  const shot = async (group: string, name: string) => {
    fs.mkdirSync(path.join(OUT, group), { recursive: true });
    // Tooltips and the blinking cursor are not part of what is being shown.
    await page.waitForTimeout(700);
    await page.screenshot({ path: path.join(OUT, group, `${name}-${PHASE}.png`) });
  };
  const setPrefs = (patch: object) =>
    page.evaluate((p) => window.api.invoke('prefs:set', p as never), patch);
  const closeDialog = (name: string) =>
    page
      .getByRole('dialog', { name })
      .getByRole('button', { name: /Cancelar|Fechar/ })
      .click();
  const openChanges = async (p: Page) => {
    await p.locator('.session-header button[title^="See changes"]').click();
    await p.locator('.change-item', { hasText: 'velho.txt' }).click();
    await p
      .frameLocator('[data-testid="diff-frame"]')
      .locator('.view-line', { hasText: 'linha nova' })
      .first()
      .waitFor();
  };

  try {
    await createSession(page, 'API', api, 'Codex');
    await createSession(page, 'Loja', loja);
    // Unknown to the code of before, which drops it.
    await setPrefs({ favoriteFolders: [api] });

    // 1. Folders: a new session.
    await page.getByRole('button', { name: '+ Nova sessão' }).click();
    await shot('pastas', '01-nova-sessao');
    await closeDialog('Nova sessão');

    // 2. Folders: another folder for a session that exists.
    if (AFTER) await page.getByRole('button', { name: 'Trocar a pasta da sessão' }).click();
    await shot('pastas', '02-trocar-pasta');
    if (AFTER) await closeDialog('Trocar pasta');

    // 3. Theme of the editor, dark and light.
    await openChanges(page);
    await shot('tema-do-editor', '01-escuro');
    await setPrefs({ theme: 'light' });
    await shot('tema-do-editor', '02-claro');
    await setPrefs({ theme: 'dark' });

    // 4. Layout: the default, and then what the preferences can make of it.
    await shot('layout', '01-sessoes-em-cima-painel-a-direita');
    if (AFTER) {
      await setPrefs({ layout: { sessions: 'top', panel: 'right', files: 'bottom' } });
      await shot('layout', '01-sessoes-em-cima-painel-a-direita');
      await setPrefs({ layout: { sessions: 'right', panel: 'bottom', files: 'right' } });
      await shot('layout', '02-sessoes-a-direita-painel-embaixo');
      await setPrefs({ layout: { sessions: 'bottom', panel: 'left', files: 'top' } });
      await shot('layout', '03-sessoes-embaixo-painel-a-esquerda');
      await setPrefs({ layout: { sessions: 'left', panel: 'cover', files: 'left' } });
    }
    await page.locator('.changes-panel').press('Escape');

    // 5. Preferences: the tabs, and what "Geral" has.
    await page.keyboard.press('Control+,');
    const prefs = page.getByRole('dialog', { name: 'Preferências' });
    await shot('preferencias', '01-geral');
    if (AFTER) {
      await prefs.getByRole('button', { name: 'Exportar…' }).scrollIntoViewIfNeeded();
      await shot('preferencias', '02-favoritas-e-exportar');
      await prefs.getByRole('tab', { name: 'Layout' }).click();
      await shot('preferencias', '03-layout');
    }
    await closeDialog('Preferências');

    // 6. Folders: a session duplicated.
    if (AFTER) {
      await page.locator('.session-item', { hasText: 'Loja' }).hover();
      await page.getByRole('button', { name: 'Duplicar Loja' }).click();
      await page.locator('.session-item', { hasText: 'Loja (2)' }).waitFor();
    }
    await shot('pastas', '03-duplicar');
  } finally {
    await running.close();
    for (const dir of [userData, base]) removeDir(dir);
  }
});
