// The screens of answering a permission request without opening the session, to attach to the
// pull request, as in `evidences.spec.ts`:
//
//   EVIDENCES=1 npx playwright test --config tests/e2e/playwright.config.ts evidences-responder-sem-abrir.spec.ts
//
// `EVIDENCES_PHASE=antes`, run on a build of the code as it was, takes the "before" of each pair
// and leaves out the steps that did not exist yet. The fake agent is
// `tests/fixtures/permission-menu.cjs`: copy it along with this file.
import fs from 'node:fs';
import path from 'node:path';
import { expect, test, type Page } from '@playwright/test';
import { createSession, launch, removeDir, ROOT, screenText, tempDir } from './harness';

const PHASE = process.env.EVIDENCES_PHASE === 'antes' ? 'antes' : 'depois';
const AFTER = PHASE === 'depois';
const OUT = process.env.EVIDENCES_DIR || path.join(ROOT, 'evidences', 'images');
const MENU = path.join(ROOT, 'tests', 'fixtures', 'permission-menu.cjs');

test.skip(process.env.EVIDENCES !== '1', 'só com EVIDENCES=1');

const row = (page: Page, id: string) => page.locator(`.session-item[data-session-id="${id}"]`);

test('evidences: answering without opening the session', async () => {
  test.setTimeout(180_000);
  const userData = tempDir('ac-evid-data-');
  // Short, stable paths: they are in the pictures.
  const base = tempDir('ac-');
  const folder = (name: string) => {
    const dir = path.join(base, name);
    fs.mkdirSync(dir);
    return dir;
  };
  const [api, web, docs] = [folder('api'), folder('web'), folder('docs')];

  const running = await launch(userData);
  const { page } = running;
  const shot = async (name: string) => {
    fs.mkdirSync(path.join(OUT, 'responder-sem-abrir'), { recursive: true });
    await page.waitForTimeout(700);
    await page.screenshot({ path: path.join(OUT, 'responder-sem-abrir', `${name}-${PHASE}.png`) });
  };
  /** The agent of the session in sight asks permission; waits until the list knows. */
  const ask = async (id: string, args: string) => {
    await page.locator('.terminal-host.visible').click();
    await page.keyboard.type(`node "${MENU}" ${args}`);
    await page.keyboard.press('Enter');
    await expect
      .poll(() => screenText(page, id), { timeout: 20_000 })
      .toContain('Do you want to proceed?');
    await expect(row(page, id)).toHaveAttribute('data-state', 'aguardando');
    if (AFTER) await expect(row(page, id).getByTestId('permission-ask')).toBeVisible();
  };

  try {
    const apiId = await createSession(page, 'API', api);
    await ask(apiId, 'Bash npm install');
    const webId = await createSession(page, 'Web', web);
    await ask(webId, 'Edit src/app.ts');
    const docsId = await createSession(page, 'Docs', docs);

    // 1. Two agents asking, while the user works in a third session. Before: "Aguardando você"
    // and nothing else; after: what each one asks, with ✓ and ✕.
    await shot('01-pedidos-na-lista');

    // 2. Before: to answer, the session has to be opened. After: answered from the list, and
    // the session opened only to show that the agent got the key.
    if (AFTER) {
      await row(page, apiId).getByRole('button', { name: 'Permitir o pedido de API' }).click();
      await row(page, webId).getByRole('button', { name: 'Negar o pedido de Web' }).click();
      await expect
        .poll(() => screenText(page, apiId), { timeout: 15_000 })
        .toContain('resposta: 1');
      await expect
        .poll(() => screenText(page, webId), { timeout: 15_000 })
        .toContain('resposta: esc');
      await expect(page.getByTestId('permission-ask')).toHaveCount(0);
    }
    await row(page, apiId).click();
    await shot('02-sessao-api');

    // 3. The agent moved on before the click: after, nothing is written and the list says so.
    await row(page, docsId).click();
    await ask(docsId, 'Bash rm -rf build');
    fs.writeFileSync(path.join(docs, 'limpar'), '');
    await expect
      .poll(() => screenText(page, docsId), { timeout: 15_000 })
      .toContain('o agente seguiu sozinho');
    if (AFTER) {
      await row(page, docsId).getByRole('button', { name: 'Permitir o pedido de Docs' }).click();
      await expect(row(page, docsId).getByTestId('permission-stale')).toBeVisible();
    }
    await shot('03-pedido-mudou');

    // 4. Preferences → General: after, the buttons can be turned off.
    await page.keyboard.press('Control+,');
    const prefs = page.getByRole('dialog', { name: 'Preferências' });
    await prefs.getByRole('tab', { name: 'Geral' }).click();
    await shot('04-preferencia');
  } finally {
    await running.close();
    removeDir(userData);
    removeDir(base);
  }
});
