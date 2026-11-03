// The screens of the guard of a pull request, to attach to the pull request, as in
// `evidences.spec.ts`:
//
//   EVIDENCES=1 npx playwright test --config tests/e2e/playwright.config.ts evidences-vigia-do-pr.spec.ts
//
// `EVIDENCES_PHASE=antes`, run on a build of the code as it was, takes the "before" of each pair:
// the same pull request whose pipeline broke, where only a click sent the fix.
import fs from 'node:fs';
import path from 'node:path';
import { expect, test } from '@playwright/test';
import { fakeGitHubEnv, startFakeGitHub, type FakePull } from './fake-github';
import { createSession, git, launch, makeRepo, removeDir, ROOT, tempDir } from './harness';

const PHASE = process.env.EVIDENCES_PHASE === 'antes' ? 'antes' : 'depois';
const OUT = process.env.EVIDENCES_DIR || path.join(ROOT, 'evidences', 'images');
const FOLDER = 'vigia-do-pr';

test.skip(process.env.EVIDENCES !== '1', 'só com EVIDENCES=1');

const LOG =
  '2026-11-03T09:00:00Z FAIL src/relatorio.test.ts > pagina 2\n' +
  '2026-11-03T09:00:01Z AssertionError: esperado 20 itens, veio 10\n' +
  '2026-11-03T09:00:01Z ##[error]Process completed with exit code 1.\n';

test('evidences: the guard of a pull request', async () => {
  test.setTimeout(150_000);
  const mine: FakePull = {
    number: 42,
    title: 'Paginar o relatório de vendas',
    author: 'ana',
    branch: 'paginar-relatorio',
    reviewers: ['bruno'],
    sha: 'verde',
    jobs: [
      { name: 'test', conclusion: 'SUCCESS' },
      { name: 'lint', conclusion: 'SUCCESS' },
    ],
  };
  const other: FakePull = {
    number: 41,
    title: 'Atualizar dependências',
    author: 'ana',
    branch: 'deps',
    updatedMinutes: 90,
    jobs: [{ name: 'test', conclusion: 'SUCCESS' }],
  };
  const fake = await startFakeGitHub({ 'acme/vendas': [mine, other] });
  const userData = tempDir('ac-evid-data-');
  const repo = makeRepo();
  git(repo, 'checkout', '-q', '-b', 'paginar-relatorio');
  git(repo, 'remote', 'add', 'origin', 'https://github.com/acme/vendas.git');
  const running = await launch(userData, fakeGitHubEnv(fake));
  const { page } = running;
  const shot = async (name: string) => {
    fs.mkdirSync(path.join(OUT, FOLDER), { recursive: true });
    await page.waitForTimeout(800);
    await page.screenshot({ path: path.join(OUT, FOLDER, `${name}-${PHASE}.png`) });
  };

  try {
    await createSession(page, 'vendas', repo);
    await page.evaluate(() =>
      window.api.invoke('prefs:set', {
        pulls: {
          repos: ['acme/vendas'],
          account: '',
          notifyFailed: true,
          notifyComments: true,
          notifyReview: true,
        },
      }),
    );
    await page.keyboard.press('Control+Shift+U');
    const row = page.locator('[data-testid="pull-row"][data-key="acme/vendas#42"]');
    await expect(row).toHaveAttribute('data-pipeline', 'success', { timeout: 15_000 });
    if (PHASE === 'depois') await row.getByTestId('pull-guard').click();

    // 1. The pipeline breaks: a button to click, or the fix already on its way.
    mine.sha = 'quebrou';
    mine.jobs[0] = { name: 'test', conclusion: 'FAILURE', log: LOG };
    await expect(row).toHaveAttribute('data-pipeline', 'failure', { timeout: 15_000 });
    if (PHASE === 'depois') {
      await expect(row.getByTestId('pull-guard-status')).toHaveText('mandado ao agente (1 de 3)', {
        timeout: 15_000,
      });
    }
    await shot('01-pipeline-quebrou');

    // 2. The queue of the session of the branch: empty, or with the fix for the end of the turn.
    await page.keyboard.press('Escape');
    await page.keyboard.press('Control+Shift+P');
    await page
      .getByRole('dialog', { name: 'Paleta de comandos' })
      .getByRole('option', { name: /^Abrir a fila de/ })
      .click();
    await expect(page.getByRole('dialog', { name: /^Fila de/ })).toBeVisible();
    await shot('02-fila-da-sessao');
  } finally {
    await running.close();
    await fake.close();
    removeDir(userData);
    removeDir(repo);
  }
});
