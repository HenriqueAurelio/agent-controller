// The screens of issues becoming cards, to attach to the pull request, as in `evidences.spec.ts`:
//
//   EVIDENCES=1 npx playwright test --config tests/e2e/playwright.config.ts evidences-issue-vira-sessao.spec.ts
//
// `EVIDENCES_PHASE=antes`, run on a build of the code as it was, takes the "before" of each pair:
// the same dialog of a new card, where the issue had to be copied by hand.
import fs from 'node:fs';
import path from 'node:path';
import { expect, test } from '@playwright/test';
import { fakeGitHubEnv, startFakeGitHub } from './fake-github';
import { createSession, git, launch, makeRepo, removeDir, ROOT, tempDir } from './harness';

const PHASE = process.env.EVIDENCES_PHASE === 'antes' ? 'antes' : 'depois';
const OUT = process.env.EVIDENCES_DIR || path.join(ROOT, 'evidences', 'images');
const FOLDER = 'issue-vira-sessao';

test.skip(process.env.EVIDENCES !== '1', 'só com EVIDENCES=1');

test('evidences: issues become cards', async () => {
  test.setTimeout(120_000);
  const fake = await startFakeGitHub({ 'acme/vendas': [] });
  (fake as unknown as { issues: Record<string, unknown[]> }).issues = {
    'acme/vendas': [
      {
        number: 12,
        title: 'Login quebra no Safari',
        body: 'Passos: abrir no Safari 17.',
        labels: ['bug'],
      },
      { number: 15, title: 'Exportar o relatório em CSV', labels: ['feature'] },
      { number: 18, title: 'Dark mode no relatório' },
      { number: 21, title: 'Paginar a lista de clientes', labels: ['feature'] },
    ],
  };
  const userData = tempDir('ac-evid-data-');
  const repo = makeRepo();
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
    await page.keyboard.press('Control+Shift+B');
    const board = page.getByTestId('task-board');
    await board.getByTestId('board-new').click();
    const dialog = page.getByRole('dialog', { name: 'Novo cartão' });

    // 1. A new card: typed by hand, or picked from the open issues.
    if (PHASE === 'depois') {
      await dialog.getByTestId('task-import-issues').click();
      const list = dialog.getByTestId('task-issues');
      await expect(list.getByTestId('task-issue')).toHaveCount(4);
      await list.locator('label', { hasText: '#12' }).getByTestId('task-issue').check();
      await list.locator('label', { hasText: '#15' }).getByTestId('task-issue').check();
    }
    await shot('01-novo-cartao');

    // 2. The board: the cards of the issues, with their numbers.
    if (PHASE === 'depois') {
      await dialog.getByRole('button', { name: 'Criar 2 cartões' }).click();
      await expect(board.getByTestId('board-card')).toHaveCount(2);
      await shot('02-cartoes-das-issues');
    }
  } finally {
    await running.close();
    await fake.close();
    removeDir(userData);
    removeDir(repo);
  }
});
