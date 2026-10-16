// Syntax highlighting in the changes panel: TextMate grammars picked by the file, VS Code color
// themes, Monaco's own grammar as the fallback, and the language the user picks by hand.
import fs from 'node:fs';
import path from 'node:path';
import { expect, test, type FrameLocator, type Locator, type Page } from '@playwright/test';
import { createSession, launch, makeRepo, removeDir, tempDir, type RunningApp } from './harness';

let userData: string;
let repo: string;
let running: RunningApp | null = null;
let page: Page;
let panel: Locator;
let frame: FrameLocator;
let modified: Locator;

const CODE = [
  'import { formatar } from "./formatar";',
  '',
  'export function soma(parcela: number, outra: number): string {',
  '  const total = parcela + outra;',
  '  return formatar(total);',
  '}',
  '',
].join('\n');

function write(name: string, content: string): void {
  fs.mkdirSync(path.dirname(path.join(repo, name)), { recursive: true });
  fs.writeFileSync(path.join(repo, name), content);
}

async function openFile(name: string): Promise<void> {
  await panel.locator(`.change-item[data-path="${name}"]`).click();
  await expect(panel.locator('.diff-path')).toHaveText(name);
  await frame.locator(`body[data-path="${name}"]`).waitFor();
}

const body = () => frame.locator('body');

/** The color the editor paints a word of the right side with. */
async function colorOf(word: string): Promise<string> {
  const token = modified.locator('.view-line span span', { hasText: new RegExp(`^${word}$`) });
  await token.first().waitFor();
  return token.first().evaluate((el) => getComputedStyle(el).color);
}

const editorBackground = () =>
  modified
    .locator('.monaco-editor-background')
    .evaluate((el) => getComputedStyle(el).backgroundColor);

const setPrefs = (patch: Record<string, unknown>) =>
  page.evaluate((p) => window.api.invoke('prefs:set', p), patch);

test.beforeEach(async () => {
  userData = tempDir('ac-e2e-data-');
  repo = makeRepo();
  write('funcoes.ts', CODE);
  write('script.py', 'def soma(a, b):\n    return a + b\n');
  write('Dockerfile', 'FROM node:22\nRUN npm ci\n');
  write('config.toml', '[pacote]\nnome = "teste"\n');
  write('grande.ts', 'export const x = 1;\n'.repeat(31000));
  running = await launch(userData, {
    AGENT_CONTROLLER_TEST_THEME_FILE: path.join(userData, 'tema.json'),
  });
  page = running.page;
  await createSession(page, 'Repo', repo);
  await page.keyboard.press('Control+Shift+G');
  panel = page.getByRole('region', { name: 'Mudanças' });
  frame = page.frameLocator('[data-testid="diff-frame"]');
  modified = frame.locator('.editor.modified');
});

test.afterEach(async () => {
  await running?.close();
  running = null;
  removeDir(userData);
  removeDir(repo);
});

test('funções, parâmetros e palavras-chave ganham cores próprias, como no VS Code', async () => {
  await openFile('funcoes.ts');
  await expect(body()).toHaveAttribute('data-engine', 'textmate');
  await expect(body()).toHaveAttribute('data-language', 'typescript');
  await expect(body()).toHaveAttribute('data-code-theme', 'app-dark');

  // Dark+: function names yellow, parameters light blue, `function` blue, text plain.
  const fn = await colorOf('soma');
  const parameter = await colorOf('parcela');
  const keyword = await colorOf('function');
  expect(fn).toBe('rgb(220, 220, 170)');
  expect(parameter).toBe('rgb(156, 220, 254)');
  expect(keyword).toBe('rgb(86, 156, 214)');
  // The background is still the app's.
  expect(await editorBackground()).toBe('rgb(22, 24, 29)');
});

test('a linguagem vem do nome do arquivo, inclusive sem extensão e sem gramática do Monaco', async () => {
  await openFile('script.py');
  await expect(body()).toHaveAttribute('data-language', 'python');
  await expect(body()).toHaveAttribute('data-engine', 'textmate');

  await openFile('Dockerfile');
  await expect(body()).toHaveAttribute('data-language', 'docker');
  await expect(body()).toHaveAttribute('data-engine', 'textmate');

  // TOML: Monaco has no grammar of its own for it, so it used to be plain text.
  await openFile('config.toml');
  await expect(body()).toHaveAttribute('data-language', 'toml');
  await expect(body()).toHaveAttribute('data-engine', 'textmate');
  await expect(panel.getByLabel('Linguagem do arquivo')).toHaveValue('');
  await expect(panel.getByLabel('Linguagem do arquivo').locator('option').first()).toHaveText(
    'Automático: TOML',
  );
});

test('arquivo grande demais fica com a gramática do Monaco', async () => {
  await openFile('grande.ts');
  await expect(body()).toHaveAttribute('data-language', 'typescript');
  await expect(body()).toHaveAttribute('data-engine', 'monarch');
});

test('a linguagem escolhida à mão vale para aquele arquivo', async () => {
  await openFile('funcoes.ts');
  await expect(body()).toHaveAttribute('data-engine', 'textmate');
  const picker = panel.getByLabel('Linguagem do arquivo');

  await picker.selectOption('plaintext');
  await expect(body()).toHaveAttribute('data-engine', 'plain');
  // Plain text: one color for the whole line (the brackets are still drawn apart).
  const line = modified.locator('.view-line', { hasText: 'export function soma' });
  await expect
    .poll(() =>
      line.evaluate(
        (el) =>
          new Set([...el.querySelectorAll('span span')].map((s) => s.className.split(' ')[0])).size,
      ),
    )
    .toBe(1);

  await picker.selectOption('python');
  await expect(body()).toHaveAttribute('data-language', 'python');

  await picker.selectOption('');
  await expect(body()).toHaveAttribute('data-language', 'typescript');

  // Another file keeps its own language.
  await openFile('script.py');
  await expect(picker).toHaveValue('');
});

test('a associação por padrão de nome vence a extensão', async () => {
  await setPrefs({ fileAssociations: { '*.toml': 'ini' } });
  await openFile('config.toml');
  await expect(body()).toHaveAttribute('data-language', 'ini');
});

test('o tema do código muda o painel aberto e acompanha o tema do app', async () => {
  await openFile('funcoes.ts');
  await expect(body()).toHaveAttribute('data-code-theme', 'app-dark');

  await setPrefs({ codeThemeDark: 'monokai' });
  await expect(body()).toHaveAttribute('data-code-theme', 'monokai');
  await expect.poll(editorBackground).toBe('rgb(39, 40, 34)');
  // Monokai: function names green.
  await expect.poll(() => colorOf('soma')).toBe('rgb(166, 226, 46)');

  await setPrefs({ theme: 'light', codeThemeLight: 'github-light' });
  await expect(body()).toHaveAttribute('data-code-theme', 'github-light');
  await expect.poll(editorBackground).toBe('rgb(255, 255, 255)');
});

test('um tema do VS Code importado entra na lista e colore o painel', async () => {
  fs.writeFileSync(
    path.join(userData, 'tema.json'),
    `{
      // Comments and trailing commas, as VS Code writes its themes.
      "name": "Meu Tema",
      "type": "dark",
      "colors": { "editor.background": "#102030", "editor.foreground": "#eeeeee", },
      "tokenColors": [
        { "scope": "entity.name.function", "settings": { "foreground": "#ff0000" } },
        { "scope": ["keyword", "storage.type"], "settings": { "foreground": "#00ff00", "fontStyle": "bold" } },
      ],
    }`,
  );
  const imported = await page.evaluate(() => window.api.invoke('themes:import'));
  expect(imported).toEqual({ id: 'custom-meu-tema', name: 'Meu Tema', kind: 'dark', custom: true });

  await openFile('funcoes.ts');
  await setPrefs({ codeThemeDark: 'custom-meu-tema' });
  await expect(body()).toHaveAttribute('data-code-theme', 'custom-meu-tema');
  await expect.poll(editorBackground).toBe('rgb(16, 32, 48)');
  await expect.poll(() => colorOf('soma')).toBe('rgb(255, 0, 0)');
});

test('Preferências → Editor: tema por modo do app, prévia, importar e remover, associações', async () => {
  await openFile('funcoes.ts');
  await page.keyboard.press('Control+,');
  const prefs = page.getByRole('dialog', { name: 'Preferências' });
  await prefs.getByRole('tab', { name: 'Editor' }).click();

  const preview = prefs.frameLocator('[data-testid="code-theme-preview"]').locator('body');
  await expect(preview).toHaveAttribute('data-code-theme', 'app-dark');
  await expect(preview).toHaveAttribute('data-engine', 'textmate');

  // The dark list only has dark themes; picking one changes the preview and the open panel.
  const dark = prefs.getByLabel('Com o app escuro');
  await expect(dark.locator('option', { hasText: 'GitHub Light' })).toHaveCount(0);
  await dark.selectOption({ label: 'Dracula' });
  await expect(preview).toHaveAttribute('data-code-theme', 'dracula');
  await expect(body()).toHaveAttribute('data-code-theme', 'dracula');

  const light = prefs.getByLabel('Com o app claro');
  await light.selectOption({ label: 'Solarized Light' });
  await expect(preview).toHaveAttribute('data-code-theme', 'solarized-light');

  // Import: the theme becomes the one of its kind, and can be taken out again.
  fs.writeFileSync(
    path.join(userData, 'tema.json'),
    JSON.stringify({
      name: 'Tema Claro Meu',
      colors: { 'editor.background': '#fafafa' },
      tokenColors: [{ scope: 'entity.name.function', settings: { foreground: '#aa0000' } }],
    }),
  );
  await prefs.getByRole('button', { name: 'Importar tema do VS Code…' }).click();
  await expect(prefs.getByRole('status')).toHaveText('Tema “Tema Claro Meu” importado.');
  await expect(light).toHaveValue('custom-tema-claro-meu');
  await expect(preview).toHaveAttribute('data-code-theme', 'custom-tema-claro-meu');
  await prefs.getByRole('button', { name: 'Remover o tema “Tema Claro Meu”' }).click();
  await expect(prefs.getByText('Nenhum tema importado.')).toBeVisible();
  await expect(light).toHaveValue('app-light');

  // A file that is not a theme says so.
  fs.writeFileSync(path.join(userData, 'tema.json'), '{ "nada": true }');
  await prefs.getByRole('button', { name: 'Importar tema do VS Code…' }).click();
  await expect(prefs.getByRole('alert')).toHaveText('O arquivo não é um tema de cores do VS Code.');

  // Associations: a line that cannot be read is pointed out, the rest is kept.
  const associations = prefs.getByLabel('Linguagem por arquivo');
  await associations.fill('*.toml = yaml\nisto não vale');
  await associations.blur();
  await expect(prefs.getByText('Linhas ignoradas: isto não vale')).toBeVisible();
  await prefs.getByRole('button', { name: 'Fechar' }).click();
  await openFile('config.toml');
  await expect(body()).toHaveAttribute('data-language', 'yaml');

  // The palette switches the code theme of the current kind.
  await page.keyboard.press('Control+Shift+P');
  const palette = page.getByRole('dialog', { name: 'Paleta de comandos' });
  await palette.getByRole('textbox').fill('tema do código nord');
  await palette.getByRole('option', { name: 'Tema do código: Nord' }).click();
  await expect(body()).toHaveAttribute('data-code-theme', 'nord');
});
