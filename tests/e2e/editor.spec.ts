// Open in editor: the button of the session and the one of the panel (at the cursor line), the
// shortcut, Ctrl+Shift+click on a path of the terminal, and a command of the user's own. The
// "editors" are programs that only write down what they were asked to open.
import fs from 'node:fs';
import path from 'node:path';
import { expect, test } from '@playwright/test';
import { createSession, git, launch, removeDir, tempDir, type RunningApp } from './harness';
import { calls, FAKE_EDITOR, makeFakeCode, type FakeEditor } from './editor-helpers';
import { printLine, pointAt } from './links-helpers';

let running: RunningApp | null = null;
let base: string;
let folder: string;
let userData: string;
let fake: FakeEditor;

test.beforeEach(() => {
  base = tempDir('ac-e2e-editor-');
  // A name with a space, an accent and an ampersand: what breaks a careless command line.
  folder = path.join(base, 'projeto ação & cia');
  fs.mkdirSync(path.join(folder, 'src'), { recursive: true });
  const lines = Array.from({ length: 30 }, (_, i) => `export const linha${i + 1} = ${i + 1};`);
  fs.writeFileSync(path.join(folder, 'src', 'exemplo.ts'), `${lines.join('\n')}\n`);
  git(folder, 'init', '-q', '-b', 'main');
  git(folder, 'config', 'user.email', 'e2e@example.com');
  git(folder, 'config', 'user.name', 'E2E');
  git(folder, 'config', 'commit.gpgsign', 'false');
  git(folder, 'add', '-A');
  git(folder, 'commit', '-q', '-m', 'base');
  fs.writeFileSync(path.join(folder, 'src', 'exemplo.ts'), `${lines.join('\n')}\n// mudou\n`);
  fs.writeFileSync(path.join(base, 'fora.txt'), 'fora\n');
  userData = tempDir('ac-e2e-editor-data-');
  fake = makeFakeCode();
});
test.afterEach(async () => {
  await running?.close();
  running = null;
  removeDir(userData);
  removeDir(base);
  removeDir(fake.binDir);
});

test('without an editor, the button leads to the preferences', async () => {
  running = await launch(userData, fake.env);
  const { page } = running;
  await createSession(page, 'Sem editor', folder);
  await page.getByTestId('open-in-editor').click();
  const dialog = page.getByRole('dialog', { name: 'Preferências' });
  await expect(dialog.getByTestId('external-editor-settings')).toBeVisible();
  // The fake `code` is on the PATH, so the picker says it was found.
  await expect(
    dialog.getByRole('list', { name: 'Editores encontrados nesta máquina' }),
  ).toContainText('VS Code: instalado');
  await dialog
    .getByTestId('external-editor-settings')
    .getByRole('combobox', { name: 'Editor' })
    .selectOption('vscode');
  await page.keyboard.press('Escape');
  await expect(dialog).toBeHidden();
  await page.getByTestId('open-in-editor').click();
  expect(await calls(fake.log, 1)).toEqual([[folder]]);
});

test('VS Code: the folder from the session, the file at the cursor from the panel, and the shortcut', async () => {
  test.setTimeout(120_000);
  running = await launch(userData, fake.env);
  const { page } = running;
  await createSession(page, 'Com VS Code', folder);
  await page.evaluate(() =>
    window.api.invoke('prefs:set', { externalEditor: { editor: 'vscode', command: '' } }),
  );

  await page.getByTestId('open-in-editor').click();
  expect(await calls(fake.log, 1)).toEqual([[folder]]);

  // The panel, on the file at a line (the same route a link of the terminal takes).
  await page.keyboard.press('Control+0');
  await page.keyboard.press('Control+P');
  const box = page.getByRole('dialog', { name: 'Abrir arquivo' });
  const input = box.getByRole('textbox', { name: 'Nome do arquivo' });
  await input.fill('exemplo:7');
  await expect(box.getByRole('option').first()).toContainText('exemplo.ts');
  await input.press('Enter');
  const frame = page.frameLocator('[data-testid="diff-frame"]');
  await expect(frame.locator('body[data-reveal-line="7"]')).toHaveCount(1);

  await page.getByTestId('open-in-editor-file').click();
  const second = (await calls(fake.log, 2))[1]!;
  expect(second.slice(0, 2)).toEqual([folder, '-g']);
  expect(second[2]).toBe(`${path.join(folder, 'src', 'exemplo.ts')}:7:1`);

  // The shortcut does the same: the file in sight, at the cursor.
  await page.getByTestId('open-in-editor-file').focus();
  await page.keyboard.press('Control+Alt+O');
  expect((await calls(fake.log, 3))[2]![2]).toBe(`${path.join(folder, 'src', 'exemplo.ts')}:7:1`);
});

test('Ctrl+Shift+click on a path of the terminal opens it in the editor', async () => {
  test.setTimeout(120_000);
  running = await launch(userData, fake.env);
  const { page } = running;
  const id = await createSession(page, 'Link', folder);
  await page.evaluate(() =>
    window.api.invoke('prefs:set', { externalEditor: { editor: 'vscode', command: '' } }),
  );
  const { row } = await printLine(page, id, 'src/exemplo.ts:12:3 quebrou');
  const host = page.locator('.terminal-host.visible');
  await host.click();
  const point = await pointAt(page, host, row, 6);
  await page.mouse.move(point.x, point.y + 120);
  await page.mouse.move(point.x - 3, point.y);
  await page.keyboard.down('Control');
  await page.keyboard.down('Shift');
  await page.mouse.move(point.x, point.y, { steps: 3 });
  await page.waitForTimeout(500);
  await page.mouse.down();
  await page.mouse.up();
  await page.keyboard.up('Shift');
  await page.keyboard.up('Control');
  const [call] = await calls(fake.log, 1);
  expect(call).toEqual([folder, '-g', `${path.join(folder, 'src', 'exemplo.ts')}:12:3`]);
  // The panel did not open: this click was for the editor.
  await expect(page.getByRole('region', { name: 'Mudanças' })).toHaveCount(0);
});

test('"Other": the command of the user runs with the values as single arguments', async () => {
  test.setTimeout(120_000);
  const log = path.join(base, 'other.log');
  running = await launch(userData);
  const { page } = running;
  const id = await createSession(page, 'Outro', folder);
  const command = `node "${FAKE_EDITOR}" "${log}" {pasta} {arquivo} {linha} {coluna}`;
  await page.evaluate(
    (cmd) => window.api.invoke('prefs:set', { externalEditor: { editor: 'other', command: cmd } }),
    command,
  );
  await page.getByTestId('open-in-editor').click();
  // Windows PowerShell 5.1 drops an empty argument; the others pass it on.
  expect(await calls(log, 1)).toEqual([
    process.platform === 'win32' ? [folder] : [folder, '', '', ''],
  ]);

  const file = path.join(folder, 'src', 'exemplo.ts');
  await page.evaluate(
    (sessionId) =>
      window.api.invoke('editor:open', sessionId, { file: 'src/exemplo.ts', line: 4, column: 2 }),
    id,
  );
  expect((await calls(log, 2))[1]).toEqual([folder, file, '4', '2']);
});

test('a file outside the session folder, or a bad line, is refused', async () => {
  running = await launch(userData, fake.env);
  const { page } = running;
  const id = await createSession(page, 'Valida', folder);
  await page.evaluate(() =>
    window.api.invoke('prefs:set', { externalEditor: { editor: 'vscode', command: '' } }),
  );
  const open = (input: object) =>
    page.evaluate(
      async ([sessionId, value]) => {
        try {
          await window.api.invoke('editor:open', sessionId as string, value as never);
          return 'ok';
        } catch (err) {
          return (err as Error).message;
        }
      },
      [id, input] as const,
    );
  expect(await open({ file: '../fora.txt' })).toMatch(/não é um arquivo da pasta da sessão/);
  expect(await open({ file: path.join(base, 'fora.txt') })).toMatch(/não é um arquivo/);
  expect(await open({ file: 'src/nao-existe.ts' })).toMatch(/não é um arquivo/);
  expect(await open({ file: 'src/exemplo.ts', line: -3 })).toMatch(/Argumento inválido/);
  expect(await open({ file: 'src/exemplo.ts', line: 1.5 })).toMatch(/Argumento inválido/);
  // Nothing of that reached the editor.
  expect(fs.existsSync(fake.log)).toBe(false);
});
