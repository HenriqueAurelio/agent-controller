// The background commands, photographed. It only runs when asked:
//
//   EVIDENCES=1 npx playwright test --config tests/e2e/playwright.config.ts evidences-comandos-em-segundo-plano.spec.ts
//
// `EVIDENCES_PHASE=antes`, run on a build of the code as it was, takes the "before" of the
// sidebar; the panel itself is new, with no "before".
import path from 'node:path';
import { expect, test, type Page } from '@playwright/test';
import { createSession, launch, makeRepo, removeDir, ROOT, tempDir } from './harness';

const PHASE = process.env.EVIDENCES_PHASE === 'antes' ? 'antes' : 'depois';
const OUT = path.join(
  process.env.EVIDENCES_DIR || path.join(ROOT, 'evidences', 'images'),
  'comandos-em-segundo-plano',
);

test.skip(process.env.EVIDENCES !== '1', 'só com EVIDENCES=1');

const shot = (page: Page, name: string) =>
  page.screenshot({ path: path.join(OUT, `${name}-${PHASE}.png`) });

// Node stands for the aliases of the user (a Cloud SQL proxy, a tunnel).
const PROXY = (port: number, name: string) =>
  `node -e "console.log('Authorizing with Application Default Credentials'); console.log('[${name}] Listening on 127.0.0.1:${port}'); console.log('The proxy has started successfully and is ready for new connections!'); setInterval(() => {}, 1000)"`;
const FALLS = `node -e "console.error('Error: failed to get credentials: gcloud auth application-default login'); process.exit(1)"`;

async function addCommand(page: Page, name: string, command: string) {
  await page.getByTestId('background-new').click();
  const form = page.getByTestId('background-form');
  await form.getByTestId('background-name').fill(name);
  await form.getByTestId('background-command').fill(command);
  await form.getByTestId('background-save').click();
  await expect(form).toBeHidden();
}

test('evidences: background commands', async () => {
  test.setTimeout(180_000);
  const userData = tempDir('ac-ev-bg-');
  const repo = makeRepo();
  const running = await launch(userData);
  const { page } = running;
  try {
    await page.setViewportSize({ width: 1280, height: 760 });
    await createSession(page, 'API', repo);
    if (PHASE === 'antes') {
      await shot(page, '01-barra-lateral');
      return;
    }
    await page.getByTestId('background-button').click();
    await shot(page, '02-painel-vazio');

    // The form of a new command.
    await page.getByTestId('background-new').click();
    const form = page.getByTestId('background-form');
    await form.getByTestId('background-name').fill('Banco de produção');
    await form.getByTestId('background-command').fill('sql_exp_prod');
    await shot(page, '03-novo-comando');
    await form.getByRole('button', { name: 'Cancelar' }).click();

    await addCommand(page, 'Banco de produção', PROXY(5432, 'exp-prod'));
    await addCommand(page, 'Banco de homologação', PROXY(5433, 'exp-hml'));
    await addCommand(page, 'Banco de relatórios', FALLS);
    const rows = page.getByTestId('background-row');
    await expect(rows.nth(0)).toHaveAttribute('data-status', 'running', { timeout: 15_000 });
    await expect(rows.nth(1)).toHaveAttribute('data-status', 'running', { timeout: 15_000 });
    await expect(rows.nth(2)).toHaveAttribute('data-status', 'exited', { timeout: 15_000 });
    await rows.nth(1).getByTestId('background-on').uncheck();
    await expect(rows.nth(1)).toHaveAttribute('data-status', 'stopped', { timeout: 15_000 });
    await rows.nth(0).getByTestId('background-output-button').click();
    await expect(rows.nth(0).getByTestId('background-output')).toContainText('ready for new', {
      timeout: 15_000,
    });
    await shot(page, '04-rodando-desligado-e-caiu');

    await rows.nth(0).getByTestId('background-output-button').click();
    await rows.nth(2).getByTestId('background-output-button').click();
    await expect(rows.nth(2).getByTestId('background-output')).toContainText('gcloud auth');
    await shot(page, '05-saida-do-que-caiu');

    // Back on the session: the button tells one runs and one fell.
    await page.getByTestId('background-view').press('Escape');
    await shot(page, '01-barra-lateral');
  } finally {
    await running.close();
    removeDir(userData);
    removeDir(repo);
  }
});
