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

const MENU = path.join(ROOT, 'tests', 'fixtures', 'permission-menu.cjs');

const board = (page: Page) => page.getByTestId('task-board');
const column = (page: Page, name: string) => board(page).getByTestId(`board-column-${name}`);
const card = (page: Page, title: string) =>
  board(page).locator('.board-card', { hasText: title }).first();
const row = (page: Page, name: string) => page.locator('.session-item', { hasText: name });

const openBoard = async (page: Page) => {
  await page.keyboard.press('Control+Shift+B');
  await expect(board(page)).toBeVisible();
};

/** The cards of the board of `repo` as the main process keeps them. */
const cards = (page: Page, repo: string) =>
  page.evaluate(async (folder) => (await window.api.invoke('tasks:list', folder)).tasks, repo);

/** Opens the session of a card, tells the shell what an agent would, and comes back to the board. */
async function say(page: Page, title: string, ...titles: string[]) {
  await card(page, title).getByTestId('board-open').click();
  await expect(board(page)).toBeHidden();
  for (const text of titles) {
    await setTitle(page, text);
    await page.waitForTimeout(400);
  }
  await openBoard(page);
}

test('three pasted lines become cards; started ones move by themselves; done asks about the copy', async () => {
  test.setTimeout(300_000);
  const userData = tempDir('ac-e2e-quadro-');
  const copies = tempDir('ac-e2e-quadro-copias-');
  const repo = makeRepo();
  const running = await launch(userData);
  const { page } = running;
  try {
    await page.evaluate(
      (folder) => window.api.invoke('worktrees:configure', { folder, setup: '' }),
      copies,
    );
    await page.evaluate(() => window.api.invoke('prefs:set', { silenceSeconds: 600 }));
    // The board opens on the repository of the session in sight.
    await createSession(page, 'Base', repo);
    await openBoard(page);
    await expect(board(page).getByTestId('board-empty')).toBeVisible();

    // Pasting a list: one card per line.
    await board(page).getByTestId('board-new').click();
    const dialog = page.getByRole('dialog', { name: 'Novo cartão' });
    await dialog
      .getByLabel('Título (uma linha por cartão)')
      .fill('Corrigir o login\nMigrar o IPC\nLimpar testes');
    await expect(dialog.getByTestId('task-many')).toContainText('3 cartões');
    await dialog.getByRole('button', { name: 'Criar 3 cartões' }).click();
    await expect(dialog).toBeHidden();
    await expect(column(page, 'todo').getByTestId('board-card')).toHaveCount(3);

    // Starting more than four at once is refused by the button, not by an error afterwards.
    await board(page).getByLabel('Selecionar Corrigir o login').check();
    await board(page).getByLabel('Selecionar Migrar o IPC').check();
    await expect(board(page).getByTestId('board-usage')).toContainText('2 tentativas = 2× o uso');
    await board(page).getByTestId('board-start-selected').click();

    // Each started card got a session, a copy and a branch of its own, and the board stays open.
    await expect(board(page)).toBeVisible();
    await expect(column(page, 'todo').getByTestId('board-card')).toHaveCount(1);
    await expect(row(page, 'Corrigir o login')).toBeVisible({ timeout: 60_000 });
    await expect(row(page, 'Migrar o IPC')).toBeVisible({ timeout: 60_000 });
    const started = (await cards(page, repo)).filter((t) => t.sessionId);
    expect(started.map((t) => t.branch).sort()).toEqual(['ac/corrigir-o-login', 'ac/migrar-o-ipc']);
    expect(git(repo, 'branch', '--list', 'ac/*')).toContain('ac/migrar-o-ipc');

    // On Windows a new shell is already "ready" and takes the request by itself; typing a title
    // at the same time would garble it.
    await page.waitForTimeout(4000);
    // The agent says "ready", the request reaches it, and the turn that follows ends: review.
    await say(page, 'Corrigir o login', '✳ pronto');
    await expect
      .poll(
        async () => (await cards(page, repo)).find((t) => t.title === 'Corrigir o login')?.sentAt,
      )
      .toBeDefined();
    await say(page, 'Corrigir o login', '◐ trabalhando');
    await expect(card(page, 'Corrigir o login')).toHaveAttribute('data-column', 'doing');
    await say(page, 'Corrigir o login', '✳ pronto');
    await expect(card(page, 'Corrigir o login')).toHaveAttribute('data-column', 'review');

    // The other one asks for a permission: it needs the user.
    await say(page, 'Migrar o IPC', '✳ pronto');
    await expect
      .poll(async () => (await cards(page, repo)).find((t) => t.title === 'Migrar o IPC')?.sentAt)
      .toBeDefined();
    await card(page, 'Migrar o IPC').getByTestId('board-open').click();
    await page.locator('.terminal-host.visible').click();
    await page.keyboard.type(`node "${MENU}" Bash npm install`);
    await page.keyboard.press('Enter');
    const migrar = (await row(page, 'Migrar o IPC').getAttribute('data-session-id'))!;
    await expect
      .poll(() => screenText(page, migrar), { timeout: 20_000 })
      .toContain('Do you want to proceed?');
    await openBoard(page);
    await expect(card(page, 'Migrar o IPC')).toHaveAttribute('data-column', 'attention');
    await expect(column(page, 'attention').getByTestId('board-card')).toHaveCount(1);

    // The columns that follow the session cannot be forced: the card is not draggable there.
    await expect(card(page, 'Migrar o IPC')).toHaveAttribute('draggable', 'false');
    await expect(card(page, 'Corrigir o login')).toHaveAttribute('draggable', 'false');

    // "Done" asks what to do with the session and its copy.
    const copy = await page.evaluate(
      async (name) =>
        (await window.api.invoke('sessions:list')).sessions.find((s) => s.name === name)!.cwd,
      'Corrigir o login',
    );
    await card(page, 'Corrigir o login').getByTestId('board-done').click();
    const close = page.getByRole('dialog', { name: 'Fechar sessão' });
    await expect(close).toBeVisible();
    await close.getByLabel(/Remover a cópia/).check({ timeout: 20_000 });
    await close.getByRole('button', { name: /Encerrar e fechar/ }).click();
    await expect(close).toBeHidden({ timeout: 30_000 });
    await expect(card(page, 'Corrigir o login')).toHaveAttribute('data-column', 'done');
    await expect(row(page, 'Corrigir o login')).toHaveCount(0);
    expect(fs.existsSync(copy)).toBe(false);
    // The branch stays: nothing is deleted without being asked.
    expect(git(repo, 'branch', '--list', 'ac/corrigir-o-login')).toContain('ac/corrigir-o-login');

    // A session closed by hand sends the card back to "to do", with its branch.
    await page.evaluate(
      (id) => window.api.invoke('sessions:remove', id, { worktree: 'keep' }),
      migrar,
    );
    // Closing the session in sight moves the selection, which takes the board away.
    if (!(await board(page).isVisible())) await openBoard(page);
    await expect(card(page, 'Migrar o IPC')).toHaveAttribute('data-column', 'todo');
    await expect(card(page, 'Migrar o IPC').getByTestId('board-session-closed')).toContainText(
      'ac/migrar-o-ipc',
    );

    // The only drags: between "to do" and "done".
    await card(page, 'Limpar testes').dragTo(column(page, 'done'));
    await expect(card(page, 'Limpar testes')).toHaveAttribute('data-column', 'done');
    await card(page, 'Limpar testes').getByTestId('board-reopen').click();
    await expect(card(page, 'Limpar testes')).toHaveAttribute('data-column', 'todo');

    // The board is remembered across restarts of the window: same cards from the main process.
    expect((await cards(page, repo)).map((t) => t.title)).toHaveLength(3);
  } finally {
    await running.app.close();
    for (const dir of [userData, copies, repo]) removeDir(dir);
  }
});

test('a card with a description sends it as the first request, and the palette opens the dialog', async () => {
  test.setTimeout(180_000);
  const userData = tempDir('ac-e2e-quadro2-');
  const copies = tempDir('ac-e2e-quadro2-copias-');
  const repo = makeRepo();
  const running = await launch(userData);
  const { page } = running;
  try {
    await page.evaluate(
      (folder) => window.api.invoke('worktrees:configure', { folder, setup: '' }),
      copies,
    );
    await createSession(page, 'Base', repo);
    await page.keyboard.press('Control+Shift+P');
    const palette = page.getByRole('dialog', { name: 'Paleta de comandos' });
    await palette.getByRole('option', { name: 'Novo cartão no quadro de tarefas' }).click();
    const dialog = page.getByRole('dialog', { name: 'Novo cartão' });
    await expect(dialog).toBeVisible();
    await dialog.getByLabel('Título (uma linha por cartão)').fill('Escrever pedido');
    await dialog.getByLabel('Descrição (vira o primeiro pedido)').fill('echo pedido> pedido.txt');
    await dialog.getByRole('button', { name: 'Criar', exact: true }).click();
    await expect(dialog).toBeHidden();
    await card(page, 'Escrever pedido').getByTestId('board-start').click();
    await expect(row(page, 'Escrever pedido')).toBeVisible({ timeout: 60_000 });
    const [only] = (await cards(page, repo)).filter((t) => t.sessionId);
    const folder = await page.evaluate(
      async (id) =>
        (await window.api.invoke('sessions:list')).sessions.find((s) => s.id === id)!.cwd,
      only!.sessionId!,
    );
    await page.waitForTimeout(4000);
    await say(page, 'Escrever pedido', '✳ pronto');
    await expect
      .poll(() => fs.existsSync(path.join(folder, 'pedido.txt')), { timeout: 30_000 })
      .toBe(true);
  } finally {
    await running.app.close();
    for (const dir of [userData, copies, repo]) removeDir(dir);
  }
});
