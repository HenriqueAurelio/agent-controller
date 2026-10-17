import path from 'node:path';
import { expect, test, type Page } from '@playwright/test';
import {
  createSession,
  launch,
  removeDir,
  ROOT,
  runInTerminal,
  screenText,
  setTitle,
  tempDir,
} from './harness';

const MENU = path.join(ROOT, 'tests', 'fixtures', 'permission-menu.cjs');

const row = (page: Page, id: string) => page.locator(`.session-item[data-session-id="${id}"]`);

/** Writes a prompt in the send dialog and puts it in the queue of the session in sight. */
async function enqueue(page: Page, text: string, condition?: string) {
  await page.keyboard.press('Control+Shift+P');
  await page
    .getByRole('dialog', { name: 'Paleta de comandos' })
    .getByRole('option', { name: 'Prompt: Revisar o diff' })
    .click();
  const dialog = page.getByRole('dialog', { name: 'Enviar prompt' });
  await dialog.getByLabel('Texto a enviar').fill(text);
  if (condition) await dialog.getByLabel('Na fila, enviar').selectOption({ label: condition });
  await dialog.getByRole('button', { name: 'Pôr na fila' }).click();
  await expect(dialog).toBeHidden();
}

/** One turn of the agent: a spinner in the title, then idle, as Claude Code shows. */
async function turn(page: Page, id: string, name: string) {
  await setTitle(page, `◐ ${name}`);
  await expect(row(page, id)).toHaveAttribute('data-state', 'trabalhando', { timeout: 15_000 });
  await setTitle(page, '✳ pronto');
  await expect(row(page, id)).toHaveAttribute('data-state', 'terminou', { timeout: 15_000 });
}

/** What the agent printed for a queue item it ran: `echo` turns `fila-um` into `>fila-um<`. */
const ran = (page: Page, id: string, word: string) =>
  expect
    .poll(async () => (await screenText(page, id)).replace(/\r?\n/g, ''), { timeout: 15_000 })
    .toContain(`>${word}<`);

// Written so that the command line itself does not hold what it prints.
const echo = (word: string) =>
  process.platform === 'win32'
    ? `echo ^>${word}^<`
    : `echo '>${word.slice(0, -1)}''${word.slice(-1)}<'`;

test('three prompts reach the agent one after the other, and the queue stops while it asks', async () => {
  test.setTimeout(240_000);
  const userData = tempDir('ac-e2e-queue-');
  const folder = tempDir('ac-e2e-fila-');
  const running = await launch(userData);
  const { page } = running;
  try {
    const id = await createSession(page, 'Fila', folder);
    await runInTerminal(page, id, 'echo pronta', 'pronta');
    await setTitle(page, '◐ tarefa');
    await expect(row(page, id)).toHaveAttribute('data-state', 'trabalhando', { timeout: 15_000 });

    await enqueue(page, echo('fila-um'));
    await enqueue(page, echo('fila-dois'));
    await enqueue(page, echo('fila-tres'));
    await expect(row(page, id).getByTestId('queue-badge')).toHaveText('⏵ 3');
    await expect(page.locator('.queue-button .count')).toHaveText('3');
    expect(await screenText(page, id)).not.toContain('>fila-um<');

    // The turn ends: the first one goes, with Enter, and only the first.
    await setTitle(page, '✳ pronto');
    await ran(page, id, 'fila-um');
    await expect(row(page, id).getByTestId('queue-badge')).toHaveText('⏵ 2');
    expect(await screenText(page, id)).not.toContain('>fila-dois<');

    await turn(page, id, 'dois');
    await ran(page, id, 'fila-dois');
    await expect(row(page, id).getByTestId('queue-badge')).toHaveText('⏵ 1');

    // The agent asks permission in the middle of the next turn: the queue waits for the answer.
    await setTitle(page, '◐ tres');
    await expect(row(page, id)).toHaveAttribute('data-state', 'trabalhando', { timeout: 15_000 });
    await page.locator('.terminal-host.visible').click();
    await page.keyboard.type(`node "${MENU}" Bash npm install`);
    await page.keyboard.press('Enter');
    await expect(row(page, id).getByTestId('permission-ask')).toBeVisible({ timeout: 20_000 });
    await page.locator('.queue-button').click();
    const queue = page.getByRole('dialog', { name: 'Fila de “Fila”' });
    await expect(queue.getByTestId('queue-status')).toContainText('O agente pediu algo');
    await expect(queue.getByTestId('queue-text')).toHaveText([echo('fila-tres')]);
    await queue.getByRole('button', { name: 'Fechar' }).click();
    await page.waitForTimeout(1500);
    expect(await screenText(page, id)).not.toContain('>fila-tres<');

    await row(page, id).getByRole('button', { name: 'Permitir o pedido de Fila' }).click();
    await expect.poll(() => screenText(page, id), { timeout: 15_000 }).toContain('resposta: 1');
    await page.waitForTimeout(1000);
    expect(await screenText(page, id)).not.toContain('>fila-tres<');

    // The next "done" moves it again.
    await turn(page, id, 'quatro');
    await ran(page, id, 'fila-tres');
    await expect(row(page, id).getByTestId('queue-badge')).toHaveCount(0);
  } finally {
    await running.close();
    removeDir(userData);
    removeDir(folder);
  }
});

test('an item that asks for the checks waits for them, and the queue stops when they fail', async () => {
  test.setTimeout(180_000);
  const userData = tempDir('ac-e2e-queue-checks-');
  const folder = tempDir('ac-e2e-fila-checks-');
  const running = await launch(userData);
  const { page } = running;
  const configure = (command: string) =>
    page.evaluate(
      ([s, c]) =>
        window.api.invoke('checks:configure', s!, [
          { id: 'teste', label: 'Teste', command: c!, timeoutSec: 30, onTurnEnd: false },
        ]),
      [id, command],
    );
  let id = '';
  try {
    id = await createSession(page, 'Checada', folder);
    await runInTerminal(page, id, 'echo pronta', 'pronta');
    await configure('exit 1');
    await setTitle(page, '◐ tarefa');
    await expect(row(page, id)).toHaveAttribute('data-state', 'trabalhando', { timeout: 15_000 });
    await enqueue(page, echo('verificado'), 'Quando as verificações passarem');

    await setTitle(page, '✳ pronto');
    const banner = page.getByTestId('queue-banner');
    await expect(banner).toContainText('as verificações falharam', { timeout: 30_000 });
    await expect(row(page, id).getByTestId('queue-badge')).toHaveText('⏸ 1');
    expect(await screenText(page, id)).not.toContain('>verificado<');

    // Fixed: resumed, the checks run again, pass, and the item goes.
    await configure('exit 0');
    await banner.getByRole('button', { name: 'Retomar' }).click();
    await ran(page, id, 'verificado');
    await expect(banner).toHaveCount(0);
    await expect(row(page, id).getByTestId('queue-badge')).toHaveCount(0);
  } finally {
    await running.close();
    removeDir(userData);
    removeDir(folder);
  }
});

test('the queue is edited, reordered and kept, comes back paused, and the main checks what it gets', async () => {
  test.setTimeout(180_000);
  const userData = tempDir('ac-e2e-queue-keep-');
  const folder = tempDir('ac-e2e-fila-keep-');
  let running = await launch(userData);
  let page = running.page;
  try {
    const id = await createSession(page, 'Guardada', folder);
    await runInTerminal(page, id, 'echo pronta', 'pronta');
    await setTitle(page, '◐ tarefa');
    await expect(row(page, id)).toHaveAttribute('data-state', 'trabalhando', { timeout: 15_000 });
    await enqueue(page, 'primeiro');
    await enqueue(page, 'segundo');
    await enqueue(page, 'terceiro');

    await page.locator('.queue-button').click();
    const queue = page.getByRole('dialog', { name: 'Fila de “Guardada”' });
    const texts = queue.getByTestId('queue-text');
    await expect(texts).toHaveText(['primeiro', 'segundo', 'terceiro']);
    // Dragged to the top, then edited and its condition changed.
    await queue.getByTestId('queue-item').nth(2).dragTo(queue.getByTestId('queue-item').nth(0));
    await expect(texts).toHaveText(['terceiro', 'primeiro', 'segundo']);
    await queue.getByRole('button', { name: 'Descer o item 1' }).click();
    await expect(texts).toHaveText(['primeiro', 'terceiro', 'segundo']);
    await queue.getByRole('button', { name: 'Editar o item 2' }).click();
    await queue.getByLabel('Texto do item 2').fill('terceiro editado');
    await queue.getByRole('button', { name: 'Salvar' }).click();
    await queue
      .getByLabel('Condição do item 2')
      .selectOption({ label: 'Quando as verificações passarem' });
    await queue.getByRole('button', { name: 'Apagar o item 3' }).click();
    await expect(texts).toHaveText(['primeiro', 'terceiro editado']);
    await queue.getByRole('button', { name: 'Pausar' }).click();
    await expect(queue.getByTestId('queue-status')).toHaveText('Pausada.');
    await expect(row(page, id).getByTestId('queue-badge')).toHaveText('⏸ 2');
    await queue.getByRole('button', { name: 'Fechar' }).click();

    // What the renderer sends is checked in the main process.
    const refused = (channel: string, ...args: unknown[]) =>
      page.evaluate(
        ([c, a]) =>
          (window.api.invoke as (c: string, ...a: unknown[]) => Promise<unknown>)(c, ...a).then(
            () => 'aceito',
            (err: Error) => err.message,
          ),
        [channel, args] as const,
      );
    expect(await refused('queue:add', ['nao-existe'], { text: 'x', condition: 'turnEnd' })).toMatch(
      /Sessão não encontrada/,
    );
    expect(await refused('queue:add', [id], { text: 'x', condition: 'sempre' })).toMatch(
      /condição/,
    );
    expect(
      await refused('queue:add', [id], { text: 'x'.repeat(20_001), condition: 'turnEnd' }),
    ).toMatch(/texto/);
    expect(await refused('queue:add', [id], { text: '   ', condition: 'turnEnd' })).toMatch(
      /vazio/,
    );
    expect(await refused('queue:remove', id, 'x'.repeat(65))).toMatch(/item/);
    for (let i = 0; i < 18; i++) {
      expect(await refused('queue:add', [id], { text: `item ${i}`, condition: 'turnEnd' })).toBe(
        'aceito',
      );
    }
    expect(await refused('queue:add', [id], { text: 'demais', condition: 'turnEnd' })).toMatch(
      /já tem 20 itens/,
    );
    await expect(row(page, id).getByTestId('queue-badge')).toHaveText('⏸ 20');

    // Reopened: the queue is there, paused, and the agent got none of it.
    await running.close();
    running = await launch(userData);
    page = running.page;
    await expect(row(page, id).getByTestId('queue-badge')).toHaveText('⏸ 20');
    await page.locator('.queue-button').click();
    const again = page.getByRole('dialog', { name: 'Fila de “Guardada”' });
    await expect(again.getByTestId('queue-status')).toContainText('a fila voltou com o app');
    await expect(again.getByTestId('queue-text').nth(1)).toHaveText('terceiro editado');
    await expect(again.getByLabel('Condição do item 2', { exact: true })).toHaveValue(
      'checksPassed',
    );
    expect(await screenText(page, id)).not.toContain('primeiro');
  } finally {
    await running.close();
    removeDir(userData);
    removeDir(folder);
  }
});
