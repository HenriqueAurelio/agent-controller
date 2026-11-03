// Helpers of the tests of the review of pull requests: two pull requests on the fake GitHub.
import type { Page } from '@playwright/test';
import type { FakePull } from './fake-github';

export const PATCH = [
  '@@ -1,4 +1,5 @@',
  ' export function pagina(itens: number[]) {',
  '-  return itens.slice(0, 10);',
  '+  const tamanho = 20;',
  '+  return itens.slice(0, tamanho);',
  ' }',
  ' ',
].join('\n');

export function reviewPulls(): FakePull[] {
  return [
    {
      number: 8,
      title: 'Página de 20 itens',
      author: 'bruno',
      branch: 'pagina-20',
      sha: 'cabeca-8',
      reviewers: ['ana'],
      jobs: [{ name: 'test', conclusion: 'SUCCESS' }],
      files: [
        { filename: 'src/pagina.ts', status: 'modified', patch: PATCH },
        { filename: 'docs/logo.png', status: 'added' },
      ],
      reviewComments: [
        {
          id: 1,
          path: 'src/pagina.ts',
          line: 2,
          side: 'RIGHT',
          body: 'Por que 20?',
          user: { login: 'carla' },
        },
      ],
    },
    {
      number: 7,
      title: 'Meu PR',
      author: 'ana',
      branch: 'meu',
      jobs: [],
      files: [{ filename: 'a.ts', status: 'modified', patch: '@@ -1 +1 @@\n-a\n+b\n' }],
    },
  ];
}

export async function watchRepo(page: Page) {
  await page.evaluate(() =>
    window.api.invoke('prefs:set', {
      pulls: {
        repos: ['acme/api'],
        account: '',
        notifyFailed: true,
        notifyComments: true,
        notifyReview: true,
      },
    }),
  );
  await page.keyboard.press('Control+Shift+U');
}
