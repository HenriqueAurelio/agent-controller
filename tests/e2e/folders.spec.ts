import fs from 'node:fs';
import path from 'node:path';
import { expect, test } from '@playwright/test';
import {
  createSession,
  launch,
  removeDir,
  runInTerminal,
  tempDir,
  type RunningApp,
} from './harness';

let userData: string;
let first: string;
let second: string;
let running: RunningApp | null = null;

test.beforeEach(() => {
  userData = tempDir('ac-e2e-data-');
  first = tempDir('ac-e2e-um-');
  second = tempDir('ac-e2e-dois-');
});
test.afterEach(async () => {
  await running?.close();
  running = null;
  // Only after the app is gone: its shells hold these folders open.
  for (const dir of [userData, first, second]) removeDir(dir);
});

const open = async () => (running = await launch(userData));
// Prints the folder the shell is in, with a marker that the typed command does not contain.
const PWD = process.platform === 'win32' ? 'echo aqui=[%CD%]' : 'echo "aqui=[$PWD]"';

test('a new session starts from the latest folder, with the recent ones one click away', async () => {
  let { page } = await open();
  const newSession = page.getByRole('button', { name: '+ Nova sessão' });
  const dialog = page.getByRole('dialog', { name: 'Nova sessão' });
  const folder = dialog.getByLabel('Pasta');
  const recent = dialog.getByRole('list', { name: 'Recentes' });

  // Nothing to offer on a first run.
  await newSession.click();
  await expect(folder).toHaveValue('');
  await expect(recent).toBeHidden();
  await page.keyboard.press('Escape');

  await createSession(page, 'Um', first);
  await createSession(page, 'Dois', second);

  await newSession.click();
  await expect(folder).toHaveValue(second);
  await expect(dialog.getByLabel('Nome')).toHaveValue(path.basename(second));
  await expect(recent.getByRole('button')).toContainText([first]);
  await recent.getByRole('button', { name: first }).click();
  await expect(folder).toHaveValue(first);
  await expect(dialog.getByLabel('Nome')).toHaveValue(path.basename(first));
  await expect(recent.getByRole('button')).toContainText([second]);
  await page.keyboard.press('Escape');

  // The list is kept between runs, without the folders that are gone.
  await running!.close();
  removeDir(second);
  ({ page } = await open());
  await page.getByRole('button', { name: '+ Nova sessão' }).click();
  await expect(page.getByRole('dialog', { name: 'Nova sessão' }).getByLabel('Pasta')).toHaveValue(
    first,
  );
  await expect(page.getByRole('list', { name: 'Recentes' })).toBeHidden();
  fs.mkdirSync(second);
});

test('the initial folder of the preferences comes before the latest one', async () => {
  const { page } = await open();
  await createSession(page, 'Um', first);

  await page.evaluate(
    (folder) => window.api.invoke('prefs:set', { defaultFolder: folder }),
    second,
  );
  await page.getByRole('button', { name: '+ Nova sessão' }).click();
  const dialog = page.getByRole('dialog', { name: 'Nova sessão' });
  await expect(dialog.getByLabel('Pasta')).toHaveValue(second);
  await expect(dialog.getByRole('list', { name: 'Recentes' }).getByRole('button')).toContainText([
    first,
  ]);
  await dialog.getByRole('button', { name: 'Criar e iniciar' }).click();
  await expect(page.locator('.session-item', { hasText: path.basename(second) })).toHaveAttribute(
    'aria-selected',
    'true',
  );

  // Shown, and editable, in the preferences.
  await page.keyboard.press('Control+,');
  await page.getByRole('tab', { name: 'Agentes' }).click();
  const field = page.getByLabel('Pasta inicial das novas sessões');
  await expect(field).toHaveValue(second);
  await field.fill('');
  await field.blur();
  await expect
    .poll(() => page.evaluate(() => window.api.invoke('prefs:get').then((p) => p.defaultFolder)))
    .toBe('');
});

test('duplicating opens another session in the same folder', async () => {
  const { page } = await open();
  const original = await createSession(page, 'API', first);
  await createSession(page, 'Outra', second);

  // The buttons of a session show up on it when it is pointed at.
  await page.locator('.session-item', { hasText: 'API' }).hover();
  await page.getByRole('button', { name: 'Duplicar API' }).click();
  const copy = page.locator('.session-item', { hasText: 'API (2)' });
  await expect(copy).toHaveAttribute('aria-selected', 'true');
  await expect(copy).not.toHaveAttribute('data-state', 'parada');
  await expect(page.locator('.session-name')).toHaveText(['API', 'API (2)', 'Outra']);

  const id = (await copy.getAttribute('data-session-id'))!;
  expect(id).not.toBe(original);
  await runInTerminal(page, id, PWD, `aqui=[${first}]`);
});

test('a session changes folder, and a running agent is opened again in the new one', async () => {
  const { page } = await open();
  const id = await createSession(page, 'Móvel', first);
  await runInTerminal(page, id, PWD, `aqui=[${first}]`);
  const item = page.locator('.session-item', { hasText: 'Móvel' });
  const header = page.getByRole('button', { name: 'Trocar a pasta da sessão' });
  const dialog = page.getByRole('dialog', { name: 'Trocar pasta' });

  // A folder that cannot be used is refused, and the running agent is left alone.
  await header.click();
  await expect(dialog.getByLabel('Pasta')).toHaveValue(first);
  await expect(dialog.getByText('está rodando')).toBeVisible();
  const confirm = dialog.getByRole('button', { name: 'Encerrar e trocar' });
  await expect(confirm).toBeDisabled();
  await dialog.getByLabel('Pasta').fill(path.join(first, 'nao-existe'));
  await confirm.click();
  await expect(dialog.getByRole('alert')).toContainText('A pasta não existe');
  await dialog.getByRole('button', { name: 'Cancelar' }).click();

  await expect(item).not.toHaveAttribute('data-state', 'parada');
  await expect(header).toHaveText(first);

  // Stopped: nothing to end, the folder just changes.
  await page.getByRole('button', { name: 'Parar', exact: true }).click();
  await expect(item).toHaveAttribute('data-state', 'parada');
  await header.click();
  await expect(dialog.getByText('está rodando')).toBeHidden();
  await dialog.getByLabel('Pasta').fill(second);
  await dialog.getByRole('button', { name: 'Trocar pasta' }).click();
  await expect(dialog).toBeHidden();
  await expect(header).toHaveText(second);
  await expect(item).toHaveAttribute('data-state', 'parada');

  await page.getByRole('button', { name: 'Iniciar', exact: true }).click();
  await expect(item).not.toHaveAttribute('data-state', 'parada');
  await runInTerminal(page, id, PWD, `aqui=[${second}]`);

  // Running: the agent is ended and opened again in the new folder, in one step.
  await header.click();
  await dialog.getByRole('list', { name: 'Recentes' }).getByRole('button', { name: first }).click();
  await dialog.getByRole('button', { name: 'Encerrar e trocar' }).click();
  await expect(dialog).toBeHidden();
  await expect(header).toHaveText(first);
  await expect(item).not.toHaveAttribute('data-state', 'parada');
  await runInTerminal(page, id, PWD, `aqui=[${first}]`);
});

test('a dropped path stands for its folder', async () => {
  const { page } = await open();
  const file = path.join(first, 'arquivo.txt');
  fs.writeFileSync(file, 'x');
  const resolve = (dropped: string) =>
    page.evaluate((p) => window.api.invoke('folders:resolve', p), dropped);
  expect(await resolve(first)).toBe(first);
  expect(await resolve(file)).toBe(first);
  expect(await resolve(path.join(first, 'nao-existe'))).toBeNull();
});
