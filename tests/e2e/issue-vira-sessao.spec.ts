// Issues of the repository become cards of the task board, with the number in the branch.
import { expect, test } from '@playwright/test';
import { fakeGitHubEnv, startFakeGitHub } from './fake-github';
import { createSession, git, launch, makeRepo, removeDir, tempDir } from './harness';

test('open issues of the repository become cards, with their text and the number in the branch', async () => {
  test.setTimeout(120_000);
  const fake = await startFakeGitHub({ 'acme/api': [] });
  fake.issues['acme/api'] = [
    {
      number: 12,
      title: 'Login quebra no Safari',
      body: 'Passos: abrir no Safari.',
      labels: ['bug'],
    },
    { number: 15, title: 'Exportar CSV' },
    { number: 18, title: 'Dark mode no relatório' },
  ];
  const userData = tempDir('ac-e2e-issues-');
  const repo = makeRepo();
  git(repo, 'remote', 'add', 'origin', 'git@github.com:acme/api.git');
  const running = await launch(userData, fakeGitHubEnv(fake));
  const { page } = running;
  try {
    await createSession(page, 'Base', repo);
    await page.keyboard.press('Control+Shift+B');
    const board = page.getByTestId('task-board');
    await board.getByTestId('board-new').click();
    const dialog = page.getByRole('dialog', { name: 'Novo cartão' });

    // The issues of the remote (an ssh address), with a filter.
    await dialog.getByTestId('task-import-issues').click();
    const list = dialog.getByTestId('task-issues');
    await expect(list.getByTestId('task-issue')).toHaveCount(3);
    await expect(list).toContainText('#12 Login quebra no Safari · bug');
    await list.getByLabel('Filtrar issues').fill('csv');
    await expect(list.getByTestId('task-issue')).toHaveCount(1);
    await list.getByTestId('task-issue').check();
    await list.getByLabel('Filtrar issues').fill('');
    await list.locator('label', { hasText: '#12' }).getByTestId('task-issue').check();
    await expect(dialog.getByTestId('task-from-issues')).toHaveText(
      '2 issues escolhidas: cada uma vira um cartão.',
    );
    await dialog.getByRole('button', { name: 'Criar 2 cartões' }).click();
    await expect(dialog).toBeHidden();

    // Each card has the issue: its title, its text and link for the agent.
    const tasks = await page.evaluate(
      async (folder) => (await window.api.invoke('tasks:list', folder)).tasks,
      repo,
    );
    expect(tasks.map((t) => t.title).sort()).toEqual([
      '#12 Login quebra no Safari',
      '#15 Exportar CSV',
    ]);
    const login = tasks.find((t) => t.title.startsWith('#12'))!;
    expect(login.description).toBe(
      'Passos: abrir no Safari.\n\nhttps://github.com/acme/api/issues/12',
    );
    expect(login.issue).toEqual({ ref: '#12', url: 'https://github.com/acme/api/issues/12' });
    await expect(board.getByTestId('board-card')).toHaveCount(2);
  } finally {
    await running.close();
    await fake.close();
    removeDir(userData);
    removeDir(repo);
  }
});
