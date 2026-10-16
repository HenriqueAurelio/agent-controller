// Shortcuts the user chooses, and the tree with every file of the folder, hidden ones included.
import fs from 'node:fs';
import path from 'node:path';
import { expect, test, type Locator, type Page } from '@playwright/test';
import { createSession, launch, makeRepo, removeDir, tempDir, type RunningApp } from './harness';

let userData: string;
let work: string;
let repo: string;
let running: RunningApp | null = null;

test.beforeEach(() => {
  userData = tempDir('ac-e2e-data-');
  work = tempDir('ac-e2e-work-');
  repo = makeRepo();
  fs.writeFileSync(path.join(repo, '.gitignore'), 'build/\n');
  fs.writeFileSync(path.join(repo, '.env'), 'SEGREDO=1\n');
  fs.mkdirSync(path.join(repo, 'build'));
  fs.writeFileSync(path.join(repo, 'build', 'saida.js'), 'gerado();\n');
});
test.afterEach(async () => {
  await running?.close();
  running = null;
  for (const dir of [userData, work, repo]) removeDir(dir);
});

const open = async () => (running = await launch(userData));
const selectedSession = (page: Page) => page.locator('.session-item[aria-selected="true"]');
const row = (dialog: Locator, action: string) =>
  dialog.locator(`.shortcut-list li[data-action="${action}"]`);

test('shortcuts are chosen in the preferences, used everywhere and kept', async () => {
  let { page } = await open();
  await createSession(page, 'Um', work);
  await createSession(page, 'Dois', work, 'Codex');

  await page.keyboard.press('Control+,');
  let prefs = page.getByRole('dialog', { name: 'Preferências' });
  // The preferences open in "Geral"; the shortcuts have a tab of their own.
  await expect(prefs.getByRole('tab', { name: 'Geral' })).toHaveAttribute('aria-selected', 'true');
  await expect(prefs.getByLabel('Tema')).toBeVisible();
  await expect(prefs.locator('.shortcut-list')).toBeHidden();
  await page.keyboard.press('ArrowRight');
  await expect(prefs.getByRole('tab', { name: 'Agentes' })).toHaveAttribute(
    'aria-selected',
    'true',
  );
  await page.keyboard.press('ArrowRight');
  await expect(prefs.getByRole('tab', { name: 'Editor' })).toHaveAttribute('aria-selected', 'true');
  await page.keyboard.press('ArrowRight');
  await expect(prefs.getByRole('tab', { name: 'Atalhos' })).toHaveAttribute(
    'aria-selected',
    'true',
  );
  await expect(prefs.getByLabel('Tema')).toBeHidden();
  await expect(row(prefs, 'newSession').locator('kbd')).toHaveText(['Ctrl+Shift+N×']);

  // A new shortcut is recorded by pressing it; the existing ones do not fire meanwhile.
  await prefs.getByRole('button', { name: 'Adicionar atalho para Nova sessão' }).click();
  await page.keyboard.press('Control+Shift+P');
  await expect(page.getByRole('dialog', { name: 'Paleta de comandos' })).toBeHidden();
  // It belonged to the palette, and moved.
  await expect(row(prefs, 'newSession').locator('kbd')).toHaveText([
    'Ctrl+Shift+N×',
    'Ctrl+Shift+P×',
  ]);
  await expect(row(prefs, 'palette')).toContainText('sem atalho');
  await expect(prefs.locator('.shortcut-note')).toContainText('estava em “Paleta de comandos”');

  // What the terminal needs is refused, and Esc gives up without closing the preferences.
  await prefs.getByRole('button', { name: 'Adicionar atalho para Paleta de comandos' }).click();
  await page.keyboard.press('Control+c');
  await expect(prefs.locator('.shortcut-note')).toContainText('usado pelo terminal');
  await page.keyboard.press('a');
  await expect(prefs.locator('.shortcut-note')).toContainText('Use Ctrl, Alt');
  await page.keyboard.press('Escape');
  await expect(prefs).toBeVisible();
  await expect(row(prefs, 'palette')).toContainText('sem atalho');

  // The palette gets another one, and the old shortcut of "nova sessão" is removed.
  await prefs.getByRole('button', { name: 'Adicionar atalho para Paleta de comandos' }).click();
  await page.keyboard.press('Control+k');
  await expect(row(prefs, 'palette').locator('kbd')).toHaveText(['Ctrl+K×']);
  await prefs.getByRole('button', { name: 'Remover Ctrl+Shift+N de Nova sessão' }).click();
  await prefs
    .getByRole('button', { name: 'Adicionar atalho para Próxima sessão', exact: true })
    .click();
  await page.keyboard.press('Alt+ArrowDown');
  await prefs.getByRole('button', { name: 'Fechar', exact: true }).click();
  await expect(prefs).toBeHidden();

  // They work, from the terminal.
  await page.keyboard.press('Control+k');
  const palette = page.getByRole('dialog', { name: 'Paleta de comandos' });
  await expect(palette).toBeVisible();
  // The palette shows the shortcut each command has now.
  await expect(palette.locator('li', { hasText: 'Nova sessão' }).locator('kbd')).toHaveText(
    'Ctrl+Shift+P',
  );
  await page.keyboard.press('Control+k');
  await expect(palette).toBeHidden();

  await page.keyboard.press('Control+Shift+N');
  await expect(page.getByRole('dialog', { name: 'Nova sessão' })).toBeHidden();
  await page.keyboard.press('Control+Shift+P');
  await expect(page.getByRole('dialog', { name: 'Nova sessão' })).toBeVisible();
  await page.keyboard.press('Escape');

  await expect(selectedSession(page)).toContainText('Dois');
  await page.keyboard.press('Alt+ArrowDown');
  await expect(selectedSession(page)).toContainText('Um');
  await page.keyboard.press('Control+Tab');
  await expect(selectedSession(page)).toContainText('Dois');
  await page.keyboard.press('Control+1');
  await expect(selectedSession(page)).toContainText('Um');

  // Navigation: to the list of sessions and back to the terminal.
  await page.keyboard.press('Control+0');
  await expect(selectedSession(page)).toBeFocused();
  await page.keyboard.press('Control+Shift+T');
  await expect(page.locator('.terminal-host.visible .xterm-helper-textarea')).toBeFocused();

  // After a restart they are still there.
  await running!.close();
  ({ page } = await open());
  await page.keyboard.press('Control+k');
  await expect(page.getByRole('dialog', { name: 'Paleta de comandos' })).toBeVisible();
  await page.keyboard.press('Escape');

  // And the defaults come back when asked.
  await page.keyboard.press('Control+,');
  prefs = page.getByRole('dialog', { name: 'Preferências' });
  await prefs.getByRole('tab', { name: 'Atalhos' }).click();
  await expect(row(prefs, 'palette').locator('kbd')).toHaveText(['Ctrl+K×']);
  await prefs.getByRole('button', { name: 'Restaurar padrões' }).click();
  await expect(row(prefs, 'palette').locator('kbd')).toHaveText(['Ctrl+Shift+P×']);
  await expect(row(prefs, 'newSession').locator('kbd')).toHaveText(['Ctrl+Shift+N×']);
  await prefs.getByRole('button', { name: 'Fechar', exact: true }).click();
  await page.keyboard.press('Control+Shift+P');
  await expect(page.getByRole('dialog', { name: 'Paleta de comandos' })).toBeVisible();
});

test.describe('all files', () => {
  const paths = (page: Page) =>
    page
      .locator('.file-item')
      .evaluateAll((items) => items.map((el) => (el as HTMLElement).dataset.path));

  test('lists every file of the repository, hidden ones when asked, and edits them', async () => {
    const { page } = await open();
    await createSession(page, 'Repo', repo);
    fs.writeFileSync(path.join(repo, 'editado.ts'), 'export const valor = 2;\n');

    await page.keyboard.press('Control+Shift+E');
    const panel = page.getByRole('region', { name: 'Mudanças' });
    const tree = panel.getByRole('tree', { name: 'Todos os arquivos' });
    await expect(tree).toBeFocused();
    // Not only what changed; hidden files stay out until asked for.
    await expect
      .poll(() => paths(page))
      .toEqual(['src', 'editado.ts', 'removido.txt', 'velho.txt']);
    await expect(panel.locator('.file-item[data-path="editado.ts"] .change-kind')).toHaveText('M');

    // Hidden files: by the checkbox of the panel, or by shortcut.
    await panel.getByLabel('Ocultos').check();
    await expect
      .poll(() => paths(page))
      .toEqual([
        '.git',
        'build',
        'src',
        '.env',
        '.gitignore',
        'editado.ts',
        'removido.txt',
        'velho.txt',
      ]);
    await expect(panel.locator('.file-item[data-path="build"]')).toHaveAttribute(
      'data-hidden',
      'true',
    );
    await page.keyboard.press('Control+Shift+H');
    await expect(panel.locator('.file-item[data-path=".env"]')).toBeHidden();
    await page.keyboard.press('Control+Shift+H');
    await expect(panel.locator('.file-item[data-path=".env"]')).toBeVisible();

    // The tree is walked with the keyboard: folders open in place.
    await tree.focus();
    await page.keyboard.press('Home');
    await page.keyboard.press('ArrowDown');
    await page.keyboard.press('ArrowRight');
    await expect(panel.locator('.file-item[data-path="build/saida.js"]')).toBeVisible();
    await page.keyboard.press('ArrowRight');
    await page.keyboard.press('Enter');
    await expect(panel.locator('.diff-path')).toHaveText('build/saida.js');
    const editor = page.frameLocator('[data-testid="diff-frame"]');
    await expect(editor.locator('.editor.modified')).toContainText('gerado();');
    await tree.focus();
    await page.keyboard.press('ArrowLeft');
    await page.keyboard.press('ArrowLeft');
    await expect(panel.locator('.file-item[data-path="build/saida.js"]')).toBeHidden();

    // A hidden file opens and is saved like any other.
    await panel.locator('.file-item[data-path=".env"]').click();
    await editor.locator('body[data-path=".env"]').waitFor();
    await expect(editor.locator('.editor.modified')).toContainText('SEGREDO=1');
    await editor
      .locator('.editor.modified')
      .locator('.native-edit-context, textarea.inputarea')
      .first()
      .focus();
    await page.keyboard.press('Control+End');
    await page.keyboard.type('OUTRO=2');
    await expect(panel.getByText('Edições não salvas')).toBeVisible();
    await page.keyboard.press('Control+s');
    await expect(panel.getByText('Edições não salvas')).toBeHidden();
    expect(fs.readFileSync(path.join(repo, '.env'), 'utf8')).toBe('SEGREDO=1\nOUTRO=2');

    // A file created meanwhile shows up by itself.
    fs.writeFileSync(path.join(repo, 'novo.txt'), 'chegou\n');
    await expect(panel.locator('.file-item[data-path="novo.txt"]')).toBeVisible({ timeout: 5000 });

    // The shortcuts of the app work from inside the editor; the same one closes the panel.
    await page.keyboard.press('Control+Shift+G');
    await expect(panel.getByRole('listbox', { name: 'Arquivos modificados' })).toBeVisible();
    await expect(tree).toBeHidden();
    await page.keyboard.press('Control+Shift+E');
    await expect(tree).toBeVisible();
    await page.keyboard.press('Control+Shift+E');
    await expect(panel).toBeHidden();

    // The choice about hidden files is a preference.
    await page.keyboard.press('Control+,');
    await expect(
      page
        .getByRole('dialog', { name: 'Preferências' })
        .getByRole('checkbox', { name: /arquivos ocultos/ }),
    ).toBeChecked();
  });

  test('works in a folder without git', async () => {
    fs.writeFileSync(path.join(work, 'notas.txt'), 'sem git\n');
    fs.writeFileSync(path.join(work, '.segredo'), 'oculto\n');
    const { page } = await open();
    await createSession(page, 'Sem git', work);

    await page.getByRole('button', { name: 'Arquivos', exact: true }).click();
    const panel = page.getByRole('region', { name: 'Mudanças' });
    await expect.poll(() => paths(page)).toEqual(['notas.txt']);
    await panel.getByLabel('Ocultos').check();
    await expect.poll(() => paths(page)).toEqual(['.segredo', 'notas.txt']);

    await panel.locator('.file-item[data-path=".segredo"]').click();
    const editor = page.frameLocator('[data-testid="diff-frame"]');
    await expect(editor.locator('.editor.modified')).toContainText('oculto');
    await expect(panel.locator('.diff-note')).toBeHidden();

    // The list of changes still explains why it has nothing.
    await panel.getByRole('button', { name: 'Todos os arquivos' }).click();
    await expect(panel.getByText('Esta pasta não é um repositório git')).toBeVisible();
  });
});
