import fs from 'node:fs';
import path from 'node:path';
import { expect, test, type Page } from '@playwright/test';
import { createSession, git, launch, makeRepo, removeDir, tempDir } from './harness';

const listed = (page: Page) =>
  page
    .locator('.change-item')
    .evaluateAll((items) =>
      items.map((i) => `${i.getAttribute('data-path')} ${i.getAttribute('data-staged')}`),
    );

/** Answers the next `window.confirm`, and tells what it asked. */
function answerNextConfirm(page: Page, accept: boolean): { asked: () => string | null } {
  let message: string | null = null;
  page.once('dialog', (dialog) => {
    message = dialog.message();
    void (accept ? dialog.accept() : dialog.dismiss());
  });
  return { asked: () => message };
}

test('mark two of three files, commit them, discard the third and get it back', async () => {
  test.setTimeout(150_000);
  const userData = tempDir('ac-e2e-gitops-');
  const repo = makeRepo();
  // Stands in for an agent at work: the title Claude Code sets while it works, again and again.
  fs.writeFileSync(
    path.join(repo, 'trabalhando.cjs'),
    "setInterval(() => process.stdout.write('\\x1b]0;◐ tarefa\\x07'), 80);\n",
  );
  git(repo, 'add', '-A');
  git(repo, 'commit', '-q', '-m', 'trabalhando');
  fs.writeFileSync(path.join(repo, 'editado.ts'), 'export const valor = 2;\n');
  fs.writeFileSync(path.join(repo, 'velho.txt'), 'linha um\nlinha 2 mudou\nlinha três\n');
  fs.writeFileSync(path.join(repo, 'novo.txt'), 'novo\n');
  const running = await launch(userData);
  const { page } = running;
  try {
    const id = await createSession(page, 'Loja', repo);
    await page.keyboard.press('Control+Shift+G');
    const panel = page.getByRole('region', { name: 'Mudanças' });
    await expect
      .poll(() => listed(page))
      .toEqual(['editado.ts none', 'novo.txt none', 'velho.txt none']);
    await expect(panel.getByRole('group', { name: 'Commit' })).toHaveCount(0);

    // Marking is staging: what is marked is what goes into the commit.
    await panel.getByLabel('Marcar editado.ts para o commit').check();
    await panel.getByLabel('Marcar novo.txt para o commit').check();
    await expect
      .poll(() => listed(page))
      .toEqual(['editado.ts all', 'novo.txt all', 'velho.txt none']);
    await expect(panel.locator('.changes-section')).toHaveText([
      'Para o commit (2)',
      'Fora do commit (1)',
    ]);
    expect(git(repo, 'diff', '--cached', '--name-only').trim().split('\n')).toEqual([
      'editado.ts',
      'novo.txt',
    ]);
    const bar = panel.getByRole('group', { name: 'Commit' });
    await expect(bar.getByTestId('commit-going-in')).toHaveText(
      'Entram no commit (2): editado.ts, novo.txt',
    );
    await expect(bar.getByRole('button', { name: 'Commit' })).toBeDisabled();
    await bar.getByLabel('Mensagem do commit').fill('Valor novo e arquivo novo');
    await bar.getByRole('button', { name: 'Commit' }).click();
    await expect(panel.getByRole('status')).toContainText(/Commit [0-9a-f]{7} feito/);
    expect(git(repo, 'log', '-1', '--format=%s').trim()).toBe('Valor novo e arquivo novo');
    expect(git(repo, 'show', '--name-only', '--format=', 'HEAD').trim().split('\n')).toEqual([
      'editado.ts',
      'novo.txt',
    ]);
    await expect.poll(() => listed(page)).toEqual(['velho.txt none']);
    await expect(bar).toHaveCount(0);

    // Discarding asks with the name of the file, keeps a copy, and can be undone.
    const item = panel.locator('.change-item[data-path="velho.txt"]');
    await item.hover();
    let confirm = answerNextConfirm(page, true);
    await panel.getByRole('button', { name: 'Descartar as mudanças de velho.txt' }).click();
    await expect.poll(confirm.asked).toContain('Descartar as mudanças de velho.txt?');
    await expect(panel.getByRole('status')).toContainText('Mudanças de velho.txt descartadas.');
    await expect(panel.locator('.change-item')).toHaveCount(0);
    expect(fs.readFileSync(path.join(repo, 'velho.txt'), 'utf8')).toBe(
      'linha um\nlinha dois\nlinha três\n',
    );
    const copies = path.join(userData, 'descartados');
    expect(fs.readdirSync(copies)).toHaveLength(1);

    await panel.getByRole('button', { name: 'Desfazer' }).click();
    await expect.poll(() => listed(page)).toEqual(['velho.txt none']);
    expect(fs.readFileSync(path.join(repo, 'velho.txt'), 'utf8')).toContain('linha 2 mudou');

    // With the agent at work, discarding asks once more; saying no leaves everything alone.
    await page.keyboard.press('Escape');
    await page.locator('.terminal-host.visible').click();
    await page.keyboard.type('node trabalhando.cjs');
    await page.keyboard.press('Enter');
    await expect(page.locator(`.session-item[data-session-id="${id}"]`)).toHaveAttribute(
      'data-state',
      'trabalhando',
    );
    await page.keyboard.press('Control+Shift+G');
    await panel.locator('.change-item[data-path="velho.txt"]').hover();
    confirm = answerNextConfirm(page, false);
    await panel.getByRole('button', { name: 'Descartar as mudanças de velho.txt' }).click();
    await expect.poll(confirm.asked).toContain('O agente está trabalhando nesta pasta agora');
    await expect.poll(() => listed(page)).toEqual(['velho.txt none']);
    expect(fs.readFileSync(path.join(repo, 'velho.txt'), 'utf8')).toContain('linha 2 mudou');
  } finally {
    await running.close();
    removeDir(userData);
    removeDir(repo);
  }
});

test('a commit hook that fails shows what it said, and nothing is committed', async () => {
  test.setTimeout(120_000);
  const userData = tempDir('ac-e2e-gitops-hook-');
  const repo = makeRepo();
  const hook = path.join(repo, '.git', 'hooks', 'pre-commit');
  fs.writeFileSync(hook, '#!/bin/sh\necho "lint: 1 problema em editado.ts" >&2\nexit 1\n');
  fs.chmodSync(hook, 0o755);
  fs.writeFileSync(path.join(repo, 'editado.ts'), 'export const valor = 2;\n');
  const running = await launch(userData);
  const { page } = running;
  try {
    await createSession(page, 'Com hook', repo);
    await page.keyboard.press('Control+Shift+G');
    const panel = page.getByRole('region', { name: 'Mudanças' });
    await panel.getByLabel('Marcar editado.ts para o commit').check();
    const bar = panel.getByRole('group', { name: 'Commit' });
    await bar.getByLabel('Mensagem do commit').fill('Não passa');
    await bar.getByRole('button', { name: 'Commit' }).click();
    await expect(panel.getByRole('alert')).toContainText('lint: 1 problema em editado.ts');
    expect(git(repo, 'log', '--format=%s').trim()).toBe('base');
    // The message stays, to try again after fixing.
    await expect(bar.getByLabel('Mensagem do commit')).toHaveValue('Não passa');
  } finally {
    await running.close();
    removeDir(userData);
    removeDir(repo);
  }
});
