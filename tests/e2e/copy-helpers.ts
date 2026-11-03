// Helpers of the tests of copies and their pull requests.
import path from 'node:path';
import { expect, type Page } from '@playwright/test';
import { git, makeRepo } from './harness';

/**
 * A repository whose `origin` reads as GitHub's (`acme/api`) and pushes to a bare repository on
 * disk: the app finds the service by the address, and the push really happens.
 */
export function repoWithRemote(dir: string): { repo: string; remote: string } {
  const repo = makeRepo();
  const remote = path.join(dir, 'remote.git');
  git(dir, 'init', '-q', '--bare', remote);
  git(repo, 'remote', 'add', 'origin', 'https://github.com/acme/api.git');
  git(
    repo,
    'config',
    `url.${remote.replaceAll('\\', '/')}.pushInsteadOf`,
    'https://github.com/acme/api.git',
  );
  return { repo, remote };
}

/** A session in a copy, through the dialog, as the user makes one; returns the folder of the copy. */
export async function isolatedSession(page: Page, name: string, repo: string, branch: string) {
  await page.getByRole('button', { name: '+ Nova sessão' }).click();
  const dialog = page.getByRole('dialog', { name: 'Nova sessão' });
  await dialog.getByLabel('Pasta').fill(repo);
  await dialog.getByLabel('Nome').fill(name);
  await dialog.getByRole('radio', { name: /Claude Code/ }).check();
  await dialog.getByLabel('Cópia isolada (git worktree)').check();
  await dialog.getByLabel('Branch nova').fill(branch);
  await dialog.getByRole('button', { name: 'Criar e iniciar' }).click();
  await expect(dialog).toBeHidden({ timeout: 30_000 });
  const item = page.locator('.session-item', { hasText: name });
  await expect(item).toHaveAttribute('aria-selected', 'true');
  const id = (await item.getAttribute('data-session-id'))!;
  const sessions = await page.evaluate(() => window.api.invoke('sessions:list'));
  const cwd = sessions.sessions.find((s) => s.id === id)!.cwd;
  return { id, cwd };
}
