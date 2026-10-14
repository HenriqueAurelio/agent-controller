// The screens of folders, theme of the editor, layout, settings, language, command of the agent and
// tabs of the preferences,
// to attach to the pull request: the same scenario photographed before and after the change. They
// go to evidences/, which git ignores. It only runs when asked:
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
      await prefs.getByRole('tab', { name: 'Importar e exportar' }).click();
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

test('evidences: language of the interface', async () => {
  test.setTimeout(180_000);
  const userData = tempDir('ac-evid-data-');
  const base = tempDir('ac-');
  const loja = path.join(base, 'loja');
  fs.renameSync(makeRepo(), loja);
  fs.writeFileSync(path.join(loja, 'editado.ts'), 'export const valor = 2;\n');
  const exported = path.join(base, 'configuracoes.json');

  const running = await launch(userData, { AGENT_CONTROLLER_TEST_PREFS_FILE: exported });
  const { page } = running;
  const shot = async (name: string) => {
    fs.mkdirSync(path.join(OUT, 'idioma'), { recursive: true });
    await page.waitForTimeout(700);
    await page.screenshot({ path: path.join(OUT, 'idioma', `${name}-${PHASE}.png`) });
  };
  // The code of before only speaks Portuguese: each step names both.
  const say = (portuguese: string, english: string) => (AFTER ? english : portuguese);

  try {
    await createSession(page, 'Loja', loja);

    // 1. Where the language is chosen: the first thing in "Geral".
    await page.keyboard.press('Control+,');
    await shot('01-preferencias-geral');
    if (AFTER) {
      await page
        .getByRole('dialog', { name: 'Preferências' })
        .getByLabel('Idioma da interface')
        .selectOption('en');
    }
    const prefs = page.getByRole('dialog', { name: say('Preferências', 'Preferences') });

    // 2. The preferences, in the language chosen.
    await shot('02-preferencias-no-idioma');
    await prefs.getByRole('tab', { name: say('Atalhos', 'Shortcuts') }).click();
    await shot('03-preferencias-atalhos');

    // 3. The language goes out with the exported settings.
    await prefs.getByRole('tab', { name: say('Importar e exportar', 'Import and export') }).click();
    await prefs.getByRole('button', { name: say('Exportar…', 'Export…') }).click();
    await prefs.getByRole('status').scrollIntoViewIfNeeded();
    await shot('04-exportar');
    await prefs.getByRole('button', { name: say('Fechar', 'Close') }).click();

    // 4. The window: sessions, state, header of the session.
    await shot('05-janela');

    // 5. A new session, with a message that comes from the main process.
    await page.getByRole('button', { name: say('+ Nova sessão', '+ New session') }).click();
    const dialog = page.getByRole('dialog', { name: say('Nova sessão', 'New session') });
    await dialog.getByLabel(say('Pasta', 'Folder')).fill(path.join(base, 'nao-existe'));
    await dialog.getByRole('button', { name: say('Criar e iniciar', 'Create and start') }).click();
    await dialog.getByRole('alert').waitFor();
    await shot('06-nova-sessao');
    await dialog.getByRole('button', { name: say('Cancelar', 'Cancel') }).click();

    // 6. The command palette.
    await page.keyboard.press('Control+Shift+P');
    await shot('07-paleta-de-comandos');
    await page.keyboard.press('Escape');

    // 7. The changes panel.
    await page.locator('.session-header button[title^="See changes"]').click();
    await page.locator('.change-item', { hasText: 'editado.ts' }).click();
    await page
      .frameLocator('[data-testid="diff-frame"]')
      .locator('.view-line', { hasText: 'valor' })
      .first()
      .waitFor();
    await shot('08-painel-de-mudancas');
  } finally {
    await running.close();
    for (const dir of [userData, base]) removeDir(dir);
  }
});

test('evidences: command of the agent', async () => {
  test.setTimeout(180_000);
  const userData = tempDir('ac-evid-data-');
  const base = tempDir('ac-');
  const loja = path.join(base, 'loja');
  fs.mkdirSync(loja);

  const running = await launch(userData);
  const { page } = running;
  const shot = async (name: string) => {
    fs.mkdirSync(path.join(OUT, 'comando-do-agente'), { recursive: true });
    await page.waitForTimeout(700);
    await page.screenshot({ path: path.join(OUT, 'comando-do-agente', `${name}-${PHASE}.png`) });
  };

  try {
    // 1. A new session: the command it runs in place of the agent.
    await page.getByRole('button', { name: '+ Nova sessão' }).click();
    const dialog = page.getByRole('dialog', { name: 'Nova sessão' });
    await dialog.getByLabel('Pasta').fill(loja);
    await dialog.getByLabel('Nome').fill('Trabalho');
    if (AFTER) await dialog.getByLabel('Comando').fill('echo claude-work');
    await shot('01-nova-sessao');

    // 2. The session: what it ran, and the command beside the name of the agent.
    await dialog.getByRole('button', { name: 'Criar e iniciar' }).click();
    await page.locator('.session-item', { hasText: 'Trabalho' }).waitFor();
    await page.waitForTimeout(AFTER ? 6000 : 1500);
    await shot('02-sessao');

    // 3. The preferences: a command per agent.
    await page.keyboard.press('Control+,');
    const prefs = page.getByRole('dialog', { name: 'Preferências' });
    if (AFTER) {
      await prefs.getByRole('tab', { name: 'Agentes' }).click();
      await prefs.getByLabel('Comando do Claude Code').fill('claude-personal');
      await prefs.getByLabel('Comando do Codex').scrollIntoViewIfNeeded();
    } else {
      await prefs.getByText('Mostrar também os arquivos ocultos').scrollIntoViewIfNeeded();
    }
    await shot('03-preferencias-agentes');
  } finally {
    await running.close();
    for (const dir of [userData, base]) removeDir(dir);
  }
});

test('evidences: tabs of the preferences', async () => {
  test.setTimeout(180_000);
  const userData = tempDir('ac-evid-data-');
  const base = tempDir('ac-');
  const loja = path.join(base, 'loja');
  const api = path.join(base, 'api');
  for (const dir of [loja, api]) fs.mkdirSync(dir);

  const running = await launch(userData);
  const { page } = running;
  const shot = async (name: string) => {
    fs.mkdirSync(path.join(OUT, 'abas-preferencias'), { recursive: true });
    await page.waitForTimeout(700);
    await page.screenshot({ path: path.join(OUT, 'abas-preferencias', `${name}-${PHASE}.png`) });
  };

  try {
    // The same choices on both sides, so the fields that moved have something in them.
    await page.evaluate((patch) => window.api.invoke('prefs:set', patch), {
      defaultFolder: loja,
      favoriteFolders: [loja, api],
      agentCommands: { 'claude-code': 'claude-work', codex: '' },
    });
    await page.keyboard.press('Control+,');
    const prefs = page.getByRole('dialog', { name: 'Preferências' });

    // 1. "Geral": what is left of it.
    await shot('01-geral');

    // 2. Folders, sessions and the commands of the agents.
    if (AFTER) await prefs.getByRole('tab', { name: 'Agentes' }).click();
    else await prefs.getByLabel('Pasta inicial das novas sessões').scrollIntoViewIfNeeded();
    await shot('02-agentes');

    // 3. Exporting and importing the settings.
    if (AFTER) await prefs.getByRole('tab', { name: 'Importar e exportar' }).click();
    else await prefs.getByRole('button', { name: 'Exportar…' }).scrollIntoViewIfNeeded();
    await shot('03-importar-exportar');
  } finally {
    await running.close();
    for (const dir of [userData, base]) removeDir(dir);
  }
});
