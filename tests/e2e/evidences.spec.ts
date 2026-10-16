// The screens of folders, theme of the editor, layout, settings, language, command of the agent,
// tabs of the preferences and checks at the end of a turn,
// to attach to the pull request: the same scenario photographed before and after the change. They
// go to evidences/, which git ignores. It only runs when asked:
//
//   EVIDENCES=1 npx playwright test --config tests/e2e/playwright.config.ts evidences.spec.ts
//
// `EVIDENCES_PHASE=antes`, run on a build of the code as it was, takes the "before" of each pair
// and leaves out the steps that did not exist yet.
import fs from 'node:fs';
import path from 'node:path';
import { expect, test, type Page } from '@playwright/test';
import {
  createSession,
  git,
  launch,
  makeRepo,
  removeDir,
  ROOT,
  screenText,
  setTitle,
  tempDir,
} from './harness';
import { configureSuggested, makeProject, turn } from './project';

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
    await p.locator('.session-header button', { hasText: /^(See changes|Ver mudanças)/ }).click();
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

test('evidences: see changes translated and Spanish', async () => {
  test.setTimeout(180_000);
  const userData = tempDir('ac-evid-data-');
  const loja = tempDir('ac-loja-');

  const running = await launch(userData);
  const { page } = running;
  const shot = async (name: string) => {
    fs.mkdirSync(path.join(OUT, 'ver-mudancas-e-espanhol'), { recursive: true });
    await page.waitForTimeout(700);
    await page.screenshot({
      path: path.join(OUT, 'ver-mudancas-e-espanhol', `${name}-${PHASE}.png`),
    });
  };

  try {
    await createSession(page, 'Loja', loja);

    // 1. The header of the session, in Portuguese: the button of the changes.
    const button = page.locator('.session-header button', {
      hasText: /^(See changes|Ver mudanças)/,
    });
    await button.hover();
    await shot('01-botao');

    // 2. The command palette, looking for the changes.
    await page.keyboard.press('Control+Shift+P');
    await page.keyboard.type(AFTER ? 'ver' : 'see');
    await shot('02-paleta');
    await page.keyboard.press('Escape');

    // 3. The languages to choose from, and the app in Spanish.
    await page.keyboard.press('Control+,');
    const language = page
      .getByRole('dialog', { name: 'Preferências' })
      .getByLabel('Idioma da interface');
    if (AFTER) await language.selectOption('es');
    await shot('03-preferencias');
    await page.keyboard.press('Escape');
    await shot('04-janela');
  } finally {
    await running.close();
    for (const dir of [userData, loja]) removeDir(dir);
  }
});

test('evidences: no start and stop button', async () => {
  test.setTimeout(180_000);
  const userData = tempDir('ac-evid-data-');
  const loja = tempDir('ac-loja-');

  const running = await launch(userData);
  const { page } = running;
  const shot = async (name: string) => {
    fs.mkdirSync(path.join(OUT, 'sem-iniciar-parar'), { recursive: true });
    await page.waitForTimeout(700);
    await page.screenshot({ path: path.join(OUT, 'sem-iniciar-parar', `${name}-${PHASE}.png`) });
  };

  try {
    await createSession(page, 'Loja', loja);

    // 1. The header of a running session.
    await shot('01-cabecalho');

    // 2. The agent leaves: what the terminal says about getting it back.
    await page.locator('.terminal-host.visible').click();
    await page.keyboard.type('exit');
    await page.keyboard.press('Enter');
    await page.locator('.session-item[data-state="terminou"]').waitFor();
    await shot('02-agente-saiu');
  } finally {
    await running.close();
    for (const dir of [userData, loja]) removeDir(dir);
  }
});

test('evidences: checks at the end of a turn', async () => {
  test.setTimeout(240_000);
  const userData = tempDir('ac-evid-data-');
  const repo = makeProject();
  const running = await launch(userData);
  const { page } = running;
  const shot = async (name: string) => {
    fs.mkdirSync(path.join(OUT, 'verificacoes'), { recursive: true });
    await page.waitForTimeout(700);
    await page.screenshot({ path: path.join(OUT, 'verificacoes', `${name}-${PHASE}.png`) });
  };
  const header = () =>
    page.locator('.session-header').getByRole('button', { name: /^Verificações/ });
  const badge = page.locator('.session-item').getByTestId('checks-badge');

  try {
    const id = await createSession(page, 'Projeto', repo);

    // 1. Before anything else, the checks of the folder: the ones package.json suggests, saved.
    if (AFTER) {
      const dialog = await configureSuggested(page);
      await shot('01-configurar');
      await dialog.getByRole('button', { name: 'Fechar' }).click();
    }

    // 2. A turn of the agent that changed a file, with a test that fails.
    await turn(page, id);
    if (AFTER) await badge.and(page.locator('[data-checks="failed"]')).waitFor({ timeout: 90_000 });
    await shot('02-fim-do-turno');

    if (AFTER) {
      // 3. What failed, and why.
      await header().click();
      await page
        .getByTestId('checks-run')
        .locator('[data-outcome="failed"] .checks-output')
        .waitFor();
      await shot('03-resultado');

      // 4. The failure in the agent's prompt, waiting for Enter.
      await page.getByRole('button', { name: 'Mandar o erro ao agente' }).click();
      await expect.poll(() => screenText(page, id), { timeout: 15_000 }).toContain('esperava 5');
      await shot('04-erro-no-agente');

      // 5. Fixed and checked again.
      fs.writeFileSync(path.join(repo, 'soma.cjs'), 'module.exports = (a, b) => a + b;\n');
      await page.evaluate((s) => window.api.invoke('checks:run', s), id);
      await badge.and(page.locator('[data-checks="passed"]')).waitFor({ timeout: 90_000 });
      await shot('05-tudo-passou');
    }
  } finally {
    await running.close();
    for (const dir of [userData, repo]) removeDir(dir);
  }
});

test('evidences: saved prompts', async () => {
  test.setTimeout(240_000);
  const userData = tempDir('ac-evid-data-');
  const base = tempDir('ac-');
  const folders = ['api', 'web', 'docs'].map((name) => path.join(base, name));
  for (const folder of folders) fs.mkdirSync(folder);
  const running = await launch(userData);
  const { page } = running;
  const shot = async (name: string) => {
    fs.mkdirSync(path.join(OUT, 'prompts'), { recursive: true });
    await page.waitForTimeout(700);
    await page.screenshot({ path: path.join(OUT, 'prompts', `${name}-${PHASE}.png`) });
  };

  try {
    const ids: string[] = [];
    for (const [index, name] of ['API', 'Web', 'Docs'].entries()) {
      ids.push(await createSession(page, name, folders[index]!));
    }

    // 1. Preferences: where the prompts are kept. Before, the tab did not exist.
    await page.keyboard.press('Control+,');
    const prefs = page.getByRole('dialog', { name: 'Preferências' });
    if (AFTER) {
      await prefs.getByRole('tab', { name: 'Prompts' }).click();
      await prefs.getByRole('option', { name: 'Escrever testes' }).click();
    }
    await shot('01-preferencias');
    await prefs.getByRole('button', { name: 'Fechar' }).click();

    // 2. Three sessions picked with Ctrl+click, and the prompt on its way to all of them.
    if (AFTER) {
      await page.locator('.session-item', { hasText: 'API' }).click({ modifiers: ['Control'] });
      await page.locator('.session-item', { hasText: 'Web' }).click({ modifiers: ['Control'] });
      await page.getByRole('button', { name: 'Enviar prompt' }).click();
      const dialog = page.getByRole('dialog', { name: 'Enviar prompt' });
      await dialog
        .getByLabel('Texto a enviar')
        .fill('Rode os testes de {sessao} e diga o que quebrou. Foco: {?Foco}');
      await dialog.getByLabel('Foco').fill('login');
      await expect(dialog.getByTestId('prompt-preview')).toContainText('testes de API');
    }
    await shot('02-enviar-a-varias');

    // 3. What reached the terminal of one of them, waiting for Enter.
    if (AFTER) {
      await page
        .getByRole('dialog', { name: 'Enviar prompt' })
        .getByRole('button', { name: 'Enviar a 3 sessões' })
        .click();
      await expect
        .poll(() => screenText(page, ids[1]!), { timeout: 15_000 })
        .toContain('Foco: login');
      await page.locator('.session-item', { hasText: 'Web' }).click();
    }
    await shot('03-no-terminal');

    // 4. A prompt for a session whose agent is working waits for the end of the turn.
    await page.locator('.session-item', { hasText: 'API' }).click();
    await setTitle(page, '◐ tarefa');
    await expect(page.locator('.session-item', { hasText: 'API' })).toHaveAttribute(
      'data-state',
      'trabalhando',
      { timeout: 15_000 },
    );
    if (AFTER) {
      await page.evaluate(
        (s) =>
          window.api.invoke(
            'terminal:sendText',
            [s],
            { text: 'Atualize o README.' },
            { submit: false },
          ),
        ids[0]!,
      );
      await page.locator('.session-item', { hasText: 'API' }).getByTestId('pending-send').waitFor();
    }
    await shot('04-esperando-o-turno');
  } finally {
    await running.close();
    for (const dir of [userData, base]) removeDir(dir);
  }
});

test('evidences: groups of sessions', async () => {
  test.setTimeout(180_000);
  const userData = tempDir('ac-evid-data-');
  // Short, stable paths: they are in the pictures.
  const base = tempDir('ac-');
  for (const dir of ['api-repo', 'web-repo', 'docs']) fs.mkdirSync(path.join(base, dir));
  const folder = (name: string) => path.join(base, name);
  const running = await launch(userData);
  const { page } = running;
  const shot = async (name: string) => {
    fs.mkdirSync(path.join(OUT, 'grupos'), { recursive: true });
    await page.waitForTimeout(700);
    await page.screenshot({ path: path.join(OUT, 'grupos', `${name}-${PHASE}.png`) });
  };
  const select = (name: string) =>
    page
      .locator('.session-item', { has: page.locator('.session-name', { hasText: name }) })
      .click();

  try {
    // Sessions of two repositories, opened in the order work came up: mixed in the list.
    await createSession(page, 'Back', folder('api-repo'));
    await createSession(page, 'Loja', folder('web-repo'));
    await createSession(page, 'Front', folder('api-repo'));
    await createSession(page, 'Admin', folder('web-repo'));
    await createSession(page, 'Docs', folder('docs'));

    if (AFTER) {
      // 2. A new group from a session of the repository: its name and its sessions come ready.
      await select('Loja');
      await page.getByRole('button', { name: /^Novo grupo/ }).click();
      await shot('02-novo-grupo');
      const dialog = page.getByRole('dialog', { name: 'Novo grupo' });
      await dialog.getByLabel('Nome do grupo').fill('WEB-REPO');
      await dialog.getByRole('button', { name: 'Criar grupo' }).click();
      await select('Back');
      await page.getByRole('button', { name: /^Novo grupo/ }).click();
      await dialog.getByLabel('Nome do grupo').fill('API-REPO');
      await dialog.getByRole('button', { name: 'Criar grupo' }).click();
      await expect(dialog).toBeHidden();
    }
    // 1. The list: mixed before, one group per repository after.
    await select('Docs');
    await shot('01-lista');

    if (AFTER) {
      // 3. A group folded: its count stays in sight.
      await page.getByRole('group', { name: 'WEB-REPO' }).locator('.group-header').click();
      await shot('03-grupo-recolhido');
      await page.getByRole('group', { name: 'WEB-REPO' }).locator('.group-header').click();
    }

    // 4. A new session, from the group's header: it goes into the group.
    if (AFTER) {
      await page.getByRole('group', { name: 'API-REPO' }).locator('.group-header').hover();
      await page.getByRole('button', { name: 'Nova sessão em API-REPO' }).click();
    } else {
      await page.getByRole('button', { name: '+ Nova sessão' }).click();
    }
    await page
      .getByRole('dialog', { name: 'Nova sessão' })
      .getByLabel('Pasta')
      .fill(folder('api-repo'));
    await shot('04-nova-sessao');
    await page
      .getByRole('dialog', { name: 'Nova sessão' })
      .getByRole('button', { name: 'Cancelar' })
      .click();

    // 5. Sessions on top: the groups run sideways too.
    await page.evaluate(() =>
      window.api.invoke('prefs:set', {
        layout: { sessions: 'top', panel: 'cover', files: 'left' },
      } as never),
    );
    await shot('05-sessoes-em-cima');
  } finally {
    await running.close();
    for (const dir of [userData, base]) removeDir(dir);
  }
});

test('evidences: syntax highlighting and code themes', async () => {
  test.setTimeout(180_000);
  const userData = tempDir('ac-evid-data-');
  const repo = makeRepo();
  const write = (name: string, text: string) => fs.writeFileSync(path.join(repo, name), text);
  write(
    'funcoes.ts',
    [
      "import { formatar } from './formatar';",
      '',
      'interface Pedido {',
      '  itens: number[];',
      '  desconto?: number;',
      '}',
      '',
      '/** Soma os itens do pedido. */',
      'export function total(pedido: Pedido): string {',
      '  const bruto = pedido.itens.reduce((soma, item) => soma + item, 0);',
      '  return formatar(bruto);',
      '}',
      '',
    ].join('\n'),
  );
  write('config.toml', '[pacote]\nnome = "loja"\nversao = "1.0.0"\n');
  git(repo, 'add', '-A');
  git(repo, 'commit', '-q', '-m', 'base');
  write(
    'funcoes.ts',
    [
      "import { formatar } from './formatar';",
      '',
      'interface Pedido {',
      '  itens: number[];',
      '  desconto?: number;',
      '}',
      '',
      '/** Soma os itens do pedido. */',
      'export function total(pedido: Pedido): string {',
      '  const bruto = pedido.itens.reduce((soma, item) => soma + item, 0);',
      '  const liquido = bruto * (1 - (pedido.desconto ?? 0));',
      '  return formatar(liquido, { casas: 2 });',
      '}',
      '',
    ].join('\n'),
  );
  write('config.toml', '[pacote]\nnome = "loja"\nversao = "1.1.0"\n\n[deps]\nzod = "3"\n');

  const running = await launch(userData);
  const { page } = running;
  const frame = page.frameLocator('[data-testid="diff-frame"]');
  // `editor`: only the editor, where the colors are; otherwise the whole window.
  const shot = async (name: string, editor = false) => {
    fs.mkdirSync(path.join(OUT, 'realce-de-sintaxe'), { recursive: true });
    await page.waitForTimeout(900);
    const file = path.join(OUT, 'realce-de-sintaxe', `${name}-${PHASE}.png`);
    if (editor) await page.locator('[data-testid="diff-frame"]').screenshot({ path: file });
    else await page.screenshot({ path: file });
  };
  const setPrefs = (patch: object) =>
    page.evaluate((p) => window.api.invoke('prefs:set', p as never), patch);
  const open = async (name: string, text: string) => {
    await page.locator('.change-item', { hasText: name }).click();
    await frame.locator('.view-line', { hasText: text }).first().waitFor();
    if (AFTER) await frame.locator('body[data-engine="textmate"]').waitFor();
  };

  try {
    await createSession(page, 'Loja', repo);
    // Larger letters and the diff in one column, so whole lines and their colors show.
    await setPrefs({ fontSize: 19 });
    await page.keyboard.press('Control+Shift+G');
    await page.getByRole('button', { name: 'Lado a lado' }).click();

    // 1. TypeScript: functions, parameters, properties and types.
    await open('funcoes.ts', 'liquido');
    await shot('01-typescript-escuro', true);

    // 2. TOML, which Monaco has no grammar for.
    await open('config.toml', 'zod');
    await shot('02-toml', true);

    // 3. The light theme of the app.
    await setPrefs({ theme: 'light' });
    await open('funcoes.ts', 'liquido');
    await shot('03-typescript-claro', true);
    await setPrefs({ theme: 'dark' });

    // 4. Another code theme (new: before, the only one there was).
    if (AFTER) {
      await setPrefs({ codeThemeDark: 'monokai' });
      await frame.locator('body[data-code-theme="monokai"]').waitFor();
    }
    await shot('04-tema-monokai');
    if (AFTER) {
      await setPrefs({ codeThemeDark: 'one-dark-pro' });
      await frame.locator('body[data-code-theme="one-dark-pro"]').waitFor();
    }
    await shot('05-tema-one-dark-pro');
    if (AFTER) await setPrefs({ codeThemeDark: 'app-dark' });

    // 5. Where it is chosen (new: before, the preferences had no such tab).
    await page.keyboard.press('Control+,');
    const prefs = page.getByRole('dialog', { name: 'Preferências' });
    if (AFTER) {
      await prefs.getByRole('tab', { name: 'Editor' }).click();
      await prefs.getByLabel('Com o app escuro').selectOption({ label: 'Dracula' });
      await prefs
        .frameLocator('[data-testid="code-theme-preview"]')
        .locator('body[data-code-theme="dracula"]')
        .waitFor();
    }
    await shot('06-preferencias-editor');
  } finally {
    await running.close();
    removeDir(userData);
    removeDir(repo);
  }
});
