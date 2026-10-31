// The pull requests of the watched repositories, photographed. It only runs when asked:
//
//   EVIDENCES=1 npx playwright test --config tests/e2e/playwright.config.ts evidences-acompanhar-prs.spec.ts
//
// `EVIDENCES_PHASE=antes`, run on a build of the code as it was, takes the "before" of the list of
// sessions; the panel itself is new, with no "before".
import path from 'node:path';
import { expect, test, type Page } from '@playwright/test';
import { fakeGitHubEnv, startFakeGitHub, type FakePull } from './fake-github';
import { createSession, git, launch, makeRepo, removeDir, ROOT, tempDir } from './harness';

const PHASE = process.env.EVIDENCES_PHASE === 'antes' ? 'antes' : 'depois';
const OUT = path.join(
  process.env.EVIDENCES_DIR || path.join(ROOT, 'evidences', 'images'),
  'acompanhar-prs',
);

test.skip(process.env.EVIDENCES !== '1', 'só com EVIDENCES=1');

const LOG = [
  '2026-10-31T09:00:00Z Run npm test',
  '2026-10-31T09:00:04Z  FAIL  tests/relatorio.test.ts > pagina o relatório de 20 em 20',
  '2026-10-31T09:00:04Z AssertionError: expected 10 to be 20',
  '2026-10-31T09:00:04Z  ❯ tests/relatorio.test.ts:42:31',
  '2026-10-31T09:00:04Z Test Files  1 failed | 37 passed (38)',
  '2026-10-31T09:00:05Z ##[error]Process completed with exit code 1.',
  '2026-10-31T09:00:06Z Post job cleanup.',
].join('\n');

const repos: Record<string, FakePull[]> = {
  'acme/api': [
    {
      number: 128,
      title: 'Paginar o relatório de vendas',
      author: 'ana',
      branch: 'paginar-relatorio',
      reviewers: ['bruno'],
      comments: 3,
      updatedMinutes: 4,
      jobs: [
        { name: 'test', conclusion: 'FAILURE', log: LOG },
        { name: 'lint', conclusion: 'SUCCESS' },
        { name: 'build', conclusion: 'SUCCESS' },
      ],
    },
    {
      number: 125,
      title: 'Cache das consultas de estoque',
      author: 'ana',
      branch: 'cache-estoque',
      review: 'APPROVED',
      updatedMinutes: 95,
      jobs: [
        { name: 'test', conclusion: 'SUCCESS' },
        { name: 'lint', conclusion: 'SUCCESS' },
        { name: 'build', conclusion: 'SUCCESS' },
      ],
    },
    {
      number: 131,
      title: 'Exporta pedidos em CSV',
      author: 'bruno',
      branch: 'exportar-csv',
      reviewers: ['ana', 'carla'],
      comments: 1,
      updatedMinutes: 12,
      jobs: [
        { name: 'test', conclusion: 'SUCCESS' },
        { name: 'lint', conclusion: 'SUCCESS' },
      ],
    },
  ],
  'acme/web': [
    {
      number: 77,
      title: 'Tela de login com SSO',
      author: 'carla',
      branch: 'login-sso',
      reviewers: ['ana'],
      updatedMinutes: 30,
      running: true,
      jobs: [
        { name: 'e2e', conclusion: 'FAILURE' },
        { name: 'unit', conclusion: 'SUCCESS' },
      ],
    },
    {
      number: 74,
      title: 'Atualiza o React para a 20',
      author: 'diego',
      branch: 'react-20',
      review: 'CHANGES_REQUESTED',
      comments: 6,
      updatedMinutes: 300,
      jobs: [{ name: 'unit', conclusion: 'FAILURE' }],
    },
    {
      number: 79,
      title: 'Rascunho: tema escuro',
      author: 'carla',
      branch: 'tema-escuro',
      draft: true,
      review: null,
      updatedMinutes: 50,
      jobs: [],
    },
  ],
};

const shot = (page: Page, name: string) =>
  page.screenshot({ path: path.join(OUT, `${name}-${PHASE}.png`) });

test('evidences: pull requests and pipelines', async () => {
  test.setTimeout(180_000);
  const fake = await startFakeGitHub(repos);
  fake.available = ['acme/api', 'acme/web', 'acme/infra', 'acme/mobile', 'ana/dotfiles'];
  const userData = tempDir('ac-evid-prs-');
  const repo = makeRepo();
  git(repo, 'checkout', '-q', '-b', 'paginar-relatorio');
  git(repo, 'remote', 'add', 'origin', 'https://github.com/acme/api.git');
  const running = await launch(userData, fakeGitHubEnv(fake));
  const { page } = running;
  try {
    await page.setViewportSize({ width: 1280, height: 760 });
    await createSession(page, 'API · relatório', repo);
    if (PHASE === 'antes') {
      await shot(page, '01-barra-lateral');
      return;
    }
    await page.getByTestId('pulls-button').click();
    await page.getByTestId('pulls-repos-input').fill('acme/api, https://github.com/acme/web');
    await page.getByTestId('pulls-repos-add').click();
    const view = page.getByTestId('pulls-view');
    await expect(view.getByTestId('pull-row')).toHaveCount(6);
    await page.getByTestId('pulls-pick').click();
    await expect(page.getByTestId('pulls-available')).toContainText('ana/dotfiles');
    await shot(page, '04-repositorios');

    await page.getByTestId('pulls-repos-button').click();
    await page.getByTestId('pulls-tab-mine').click();
    await expect(view.getByTestId('pull-row')).toHaveCount(2);
    await expect(page.getByTestId('pulls-badge')).toHaveText('1');
    // The same screen as before: the terminal of the session, with the list beside it.
    await page.getByTestId('pulls-button').click();
    await expect(view).toBeHidden();
    await shot(page, '01-barra-lateral');
    await page.getByTestId('pulls-button').click();
    await page.getByTestId('pulls-tab-mine').click();
    await shot(page, '02-meus-prs');

    await page.getByTestId('pulls-tab-review').click();
    await expect(view.getByTestId('pull-row')).toHaveCount(2);
    await shot(page, '03-para-eu-revisar');

    await page.getByTestId('pulls-tab-all').click();
    await expect(view.getByTestId('pull-row')).toHaveCount(6);
    await shot(page, '05-todos-abertos');

    await page.getByTestId('pulls-tab-mine').click();
    await view.locator('[data-key="acme/api#128"]').getByTestId('pull-fix').click();
    const dialog = page.getByRole('dialog');
    await expect(dialog.getByTestId('prompt-preview')).toContainText('expected 10 to be 20');
    await shot(page, '06-corrigir-pipeline');
  } finally {
    await running.close();
    await fake.close();
    removeDir(userData);
    removeDir(repo);
  }
});
