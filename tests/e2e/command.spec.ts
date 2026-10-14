// The command a session runs in place of the agent: asked for when the session is created, or
// set per agent in the preferences, and run in the shell of the user.
import fs from 'node:fs';
import path from 'node:path';
import { expect, test, type Page } from '@playwright/test';
import { launch, removeDir, screenText, tempDir, type RunningApp } from './harness';

let userData: string;
let folder: string;
let home: string;
let running: RunningApp | null = null;

test.beforeEach(() => {
  userData = tempDir('ac-e2e-data-');
  folder = tempDir('ac-e2e-comando-');
  home = tempDir('ac-e2e-home-');
  // What a user keeps in the profile of their shell.
  fs.writeFileSync(path.join(home, '.bashrc'), "alias meu-agente='echo alias-rodou'\n");
});
test.afterEach(async () => {
  await running?.close();
  running = null;
  for (const dir of [userData, folder, home]) removeDir(dir);
});

// Only bash takes its profile from a folder the test can choose.
const open = async () =>
  (running = await launch(
    userData,
    process.platform === 'win32' ? {} : { HOME: home, SHELL: '/bin/bash' },
  ));
const sessionsOf = (page: Page) => page.evaluate(() => window.api.invoke('sessions:list'));
const EXITED = '[O agente saiu (código 0).]';
// Waits for the command to end. Closing the app while a session is still exiting can hang it on
// Windows, also without a command (it happens on main): a problem of its own, not tested here.
const ended = (page: Page, id: string) =>
  expect.poll(() => screenText(page, id), { timeout: 30_000 }).toContain(EXITED);

async function create(page: Page, name: string, command: string | null, agent = 'Claude Code') {
  await page.getByRole('button', { name: '+ Nova sessão' }).click();
  const dialog = page.getByRole('dialog', { name: 'Nova sessão' });
  await dialog.getByLabel('Pasta').fill(folder);
  await dialog.getByLabel('Nome').fill(name);
  await dialog.getByRole('radio', { name: new RegExp(agent) }).check();
  if (command !== null) await dialog.getByLabel('Comando').fill(command);
  await dialog.getByRole('button', { name: 'Criar e iniciar' }).click();
  await expect(dialog).toBeHidden();
  const item = page.locator('.session-item', { hasText: name });
  await expect(item).toHaveAttribute('aria-selected', 'true');
  return (await item.getAttribute('data-session-id'))!;
}

test('a session runs the command it was created with, in the shell of the user', async () => {
  let { page } = await open();
  const id = await create(page, 'Trabalho', '  echo comando-rodou  ');
  await expect.poll(() => screenText(page, id), { timeout: 30_000 }).toContain('comando-rodou');
  await expect(page.locator('.session-header')).toContainText('Claude Code · echo comando-rodou');
  // The command ended, and so did the session, with its exit code.
  await ended(page, id);

  // The copy runs the same, and the command is offered to the next session of the agent.
  await page.locator('.session-item', { hasText: 'Trabalho' }).hover();
  await page.getByRole('button', { name: 'Duplicar Trabalho' }).click();
  await page.locator('.session-item', { hasText: 'Trabalho (2)' }).waitFor();
  const copy = (await sessionsOf(page)).sessions.find((s) => s.name === 'Trabalho (2)')!;
  await ended(page, copy.id);
  expect((await sessionsOf(page)).sessions.map((s) => s.command)).toEqual([
    'echo comando-rodou',
    'echo comando-rodou',
  ]);
  await page.getByRole('button', { name: '+ Nova sessão' }).click();
  const dialog = page.getByRole('dialog', { name: 'Nova sessão' });
  await expect(dialog.locator('datalist option')).toHaveAttribute('value', 'echo comando-rodou');
  // Left empty, it says what runs: the agent itself.
  await expect(dialog.getByLabel('Comando')).toHaveAttribute('placeholder', 'claude');
  await dialog.getByRole('button', { name: 'Cancelar' }).click();

  // Kept for the next time the app opens.
  await running!.close();
  ({ page } = await open());
  expect((await sessionsOf(page)).sessions.map((s) => [s.name, s.command])).toEqual([
    ['Trabalho', 'echo comando-rodou'],
    ['Trabalho (2)', 'echo comando-rodou'],
  ]);
});

test('the preferences give each agent a command, and a session may have its own', async () => {
  const { page } = await open();
  await page.keyboard.press('Control+,');
  const prefs = page.getByRole('dialog', { name: 'Preferências' });
  await expect(prefs.getByLabel('Comando do Claude Code')).toHaveAttribute('placeholder', 'claude');
  const field = prefs.getByLabel('Comando do Codex');
  await expect(field).toHaveAttribute('placeholder', 'codex');
  await field.fill('echo padrao-rodou');
  await field.blur();
  await expect
    .poll(async () => (await page.evaluate(() => window.api.invoke('prefs:get'))).agentCommands)
    .toEqual({ 'claude-code': '', codex: 'echo padrao-rodou' });
  await prefs.getByRole('button', { name: 'Fechar' }).click();

  // A session of that agent with no command of its own runs the one of the preferences.
  const viaPrefs = await create(page, 'Padrão', null, 'Codex');
  await expect
    .poll(() => screenText(page, viaPrefs), { timeout: 30_000 })
    .toContain('padrao-rodou');
  await expect(page.locator('.session-header')).toContainText('Codex · echo padrao-rodou');
  expect((await sessionsOf(page)).sessions[0]).not.toHaveProperty('command');
  await ended(page, viaPrefs);

  // Its own command comes first.
  const own = await create(page, 'Própria', 'echo propria-rodou', 'Codex');
  await expect.poll(() => screenText(page, own), { timeout: 30_000 }).toContain('propria-rodou');
  expect(await screenText(page, own)).not.toContain('padrao-rodou');
  await ended(page, own);

  // The other agent has no command: it runs as it always did.
  await create(page, 'Sem comando', null);
  await expect(page.locator('.session-header')).not.toContainText('·');
});

test('a command that is not one line of text is refused', async () => {
  const { page } = await open();
  const refusal = await page.evaluate(
    (cwd) =>
      window.api
        .invoke('sessions:create', { name: 'x', cwd, profile: 'codex', command: 'a\nb' })
        .then(
          () => null,
          (err: Error) => err.message,
        ),
    folder,
  );
  expect(refusal).toContain('comando');
  expect((await sessionsOf(page)).sessions).toEqual([]);
});

test('an alias of the profile of the shell is a command', async () => {
  test.skip(
    process.platform === 'win32',
    'the profile of PowerShell is not in a folder of the test',
  );
  const { page } = await open();
  const id = await create(page, 'Alias', 'meu-agente');
  await expect.poll(() => screenText(page, id), { timeout: 30_000 }).toContain('alias-rodou');
});
