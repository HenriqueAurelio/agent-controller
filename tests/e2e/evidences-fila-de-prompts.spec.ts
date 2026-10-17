// The screens of the queue of prompts, to attach to the pull request, as in `evidences.spec.ts`:
//
//   EVIDENCES=1 npx playwright test --config tests/e2e/playwright.config.ts evidences-fila-de-prompts.spec.ts
//
// `EVIDENCES_PHASE=antes`, run on a build of the code as it was, takes the "before" of each pair:
// there was no queue, so the same prompts go by "Send", which waits for the end of the turn.
import fs from 'node:fs';
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

const PHASE = process.env.EVIDENCES_PHASE === 'antes' ? 'antes' : 'depois';
const AFTER = PHASE === 'depois';
const OUT = process.env.EVIDENCES_DIR || path.join(ROOT, 'evidences', 'images');

test.skip(process.env.EVIDENCES !== '1', 'só com EVIDENCES=1');

const row = (page: Page, id: string) => page.locator(`.session-item[data-session-id="${id}"]`);

const echo = (word: string) =>
  process.platform === 'win32'
    ? `echo ^>${word}^<`
    : `echo '>${word.slice(0, -1)}''${word.slice(-1)}<'`;

test('evidences: the queue of prompts', async () => {
  test.setTimeout(240_000);
  const userData = tempDir('ac-evid-data-');
  // Short, stable paths: they are in the pictures.
  const base = tempDir('ac-');
  const folder = (name: string) => {
    const dir = path.join(base, name);
    fs.mkdirSync(dir);
    return dir;
  };
  const [api, web] = [folder('api'), folder('web')];

  let running = await launch(userData);
  let page = running.page;
  const shot = async (name: string) => {
    fs.mkdirSync(path.join(OUT, 'fila-de-prompts'), { recursive: true });
    await page.waitForTimeout(700);
    await page.screenshot({ path: path.join(OUT, 'fila-de-prompts', `${name}-${PHASE}.png`) });
  };
  const openDialog = async (text: string) => {
    await page.keyboard.press('Control+Shift+P');
    await page
      .getByRole('dialog', { name: 'Paleta de comandos' })
      .getByRole('option', { name: 'Prompt: Revisar o diff' })
      .click();
    const dialog = page.getByRole('dialog', { name: 'Enviar prompt' });
    await dialog.getByLabel('Texto a enviar').fill(text);
    return dialog;
  };
  /** After: into the queue. Before: "Send", the closest there was. */
  const enqueue = async (text: string, condition?: string) => {
    const dialog = await openDialog(text);
    if (AFTER) {
      if (condition) await dialog.getByLabel('Na fila, enviar').selectOption({ label: condition });
      await dialog.getByRole('button', { name: 'Pôr na fila' }).click();
    } else {
      await dialog.getByRole('button', { name: 'Enviar', exact: true }).click();
    }
    await expect(dialog).toBeHidden();
  };
  const working = async (id: string, name: string) => {
    await setTitle(page, `◐ ${name}`);
    await expect(row(page, id)).toHaveAttribute('data-state', 'trabalhando', { timeout: 15_000 });
  };
  const done = async (id: string) => {
    await setTitle(page, '✳ pronto');
    await expect(row(page, id)).toHaveAttribute('data-state', 'terminou', { timeout: 15_000 });
  };

  try {
    const apiId = await createSession(page, 'API', api);
    await runInTerminal(page, apiId, 'echo pronta', 'pronta');
    await working(apiId, 'implementando');

    // 1. The dialog that sends a prompt. After: "Add to queue" beside "Send", and when it goes.
    await openDialog(echo('testes'));
    await shot('01-dialogo-de-envio');
    await page.keyboard.press('Escape');

    // 2. Three steps for an agent that is working. Before: three texts waiting for the end of
    // the turn, with no Enter. After: ⏵ 3 in the list, "Queue 3" at the top and the list.
    await enqueue(echo('testes'));
    await enqueue(echo('readme'));
    await enqueue(echo('changelog'));
    if (AFTER) {
      await expect(row(page, apiId).getByTestId('queue-badge')).toHaveText('⏵ 3');
      await page.locator('.queue-button').click();
      await expect(page.getByTestId('queue-item')).toHaveCount(3);
    }
    await shot('02-tres-na-fila');
    if (AFTER) await page.getByRole('button', { name: 'Fechar', exact: true }).click();

    // 3. The turn ends. Before: the three texts land together on the prompt, unsent. After: only
    // the first one goes, with Enter, and two wait for the next turns.
    await done(apiId);
    if (AFTER) {
      await expect
        .poll(async () => (await screenText(page, apiId)).replace(/\r?\n/g, ''), {
          timeout: 15_000,
        })
        .toContain('>testes<');
      await expect(row(page, apiId).getByTestId('queue-badge')).toHaveText('⏵ 2');
    } else {
      await expect.poll(() => screenText(page, apiId), { timeout: 15_000 }).toContain('changelog');
    }
    await shot('03-fim-do-turno');

    // 4. A second session whose checks fail. After: the item that waits for them does not go,
    // and the banner offers what to do.
    const webId = await createSession(page, 'Web', web);
    await runInTerminal(page, webId, 'echo pronta', 'pronta');
    await page.evaluate(
      (s) =>
        window.api.invoke('checks:configure', s, [
          { id: 'testes', label: 'Testes', command: 'exit 1', timeoutSec: 30, onTurnEnd: false },
        ]),
      webId,
    );
    await working(webId, 'corrigindo');
    if (AFTER) await enqueue(echo('deploy'), 'Quando as verificações passarem');
    await done(webId);
    if (AFTER) {
      await expect(page.getByTestId('queue-banner')).toBeVisible({ timeout: 30_000 });
    } else {
      await page.evaluate((s) => window.api.invoke('checks:run', s), webId);
    }
    await expect(row(page, webId).getByTestId('checks-badge')).toHaveAttribute(
      'data-checks',
      'failed',
      { timeout: 30_000 },
    );
    await shot('04-verificacoes-falharam');

    // 5. The app is reopened. Before: what was waiting is gone. After: the queue is back, paused.
    await row(page, apiId).click();
    await running.close();
    running = await launch(userData);
    page = running.page;
    await expect(row(page, apiId)).not.toHaveAttribute('data-state', 'parada');
    if (AFTER) {
      await expect(row(page, apiId).getByTestId('queue-badge')).toHaveText('⏸ 2');
      await page.locator('.queue-button').click();
      await expect(page.getByTestId('queue-status')).toContainText('voltou com o app');
    }
    await shot('05-app-reaberto');
  } finally {
    await running.close();
    removeDir(userData);
    removeDir(base);
  }
});
