// Everything the new features do can be done without the mouse: groups, picking sessions for a
// prompt, the side terminal and the operations of git in the changes panel.
import fs from 'node:fs';
import path from 'node:path';
import { expect, test, type Page } from '@playwright/test';
import {
  createSession,
  git,
  launch,
  makeRepo,
  removeDir,
  tempDir,
  type RunningApp,
} from './harness';

let userData: string;
let repo: string;
let running: RunningApp | null = null;
let page: Page;

const focused = () =>
  page.evaluate(() => {
    const el = document.activeElement;
    if (!el) return '';
    if (el.closest('.aux-pane')) return 'aux';
    if (el.closest('.terminal-container')) return 'agent';
    if (el.classList.contains('group-header')) return `group:${el.getAttribute('aria-label')}`;
    if (el.classList.contains('session-item')) {
      return `session:${el.querySelector('.session-name')?.textContent}`;
    }
    if (el.matches('iframe.diff-editor')) return 'editor';
    if (el.matches('.changes-list')) return 'list';
    if (el.matches('textarea')) return `textarea:${el.getAttribute('aria-label')}`;
    return el.tagName;
  });

test.beforeEach(async () => {
  userData = tempDir('ac-e2e-keys-');
  repo = makeRepo();
  fs.writeFileSync(path.join(repo, 'editado.ts'), 'export const valor = 2;\n');
  running = await launch(userData);
  page = running.page;
});

test.afterEach(async () => {
  await running?.close();
  running = null;
  removeDir(userData);
  removeDir(repo);
});

test('the list of sessions: groups, folding and picking sessions, from the keyboard', async () => {
  const a = await createSession(page, 'Alfa', repo);
  const b = await createSession(page, 'Beta', repo);
  await page.evaluate((ids) => window.api.invoke('groups:create', 'Grupo', ids), [b]);
  await page.locator('.session-item', { hasText: 'Alfa' }).waitFor();
  void a;

  // Ctrl+0 goes to the list; the arrows walk the sessions and the header of the group.
  await page.keyboard.press('Control+0');
  await expect.poll(focused).toBe('session:Alfa');
  await page.keyboard.press('ArrowDown');
  await expect.poll(focused).toBe('group:Grupo');
  const header = page.locator('.group-header', { hasText: 'Grupo' });
  await page.keyboard.press('Enter');
  await expect(header).toHaveAttribute('aria-expanded', 'false');
  await page.keyboard.press('Enter');
  await expect(header).toHaveAttribute('aria-expanded', 'true');
  await page.keyboard.press('ArrowDown');
  await expect.poll(focused).toBe('session:Beta');
  await page.keyboard.press('ArrowUp');
  await page.keyboard.press('ArrowUp');
  await expect.poll(focused).toBe('session:Alfa');

  // Ctrl+Space picks Alfa along with Beta, the session in sight; the shortcut sends to both.
  await page.keyboard.press('Control+Space');
  await expect(page.locator('.marked-bar')).toContainText('2 selecionadas');
  await page.keyboard.press('Control+Shift+M');
  const dialog = page.getByRole('dialog', { name: 'Enviar prompt' });
  await expect(dialog).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(dialog).toBeHidden();

  // Esc in the list hands the keyboard back to the terminal.
  await page.keyboard.press('Control+0');
  await page.keyboard.press('Escape');
  await expect.poll(focused).toBe('agent');

  // Delete on the header of a group undoes the group; its sessions stay.
  await page.keyboard.press('Control+0');
  await page.keyboard.press('ArrowDown');
  await expect.poll(focused).toBe('group:Grupo');
  await page.keyboard.press('Delete');
  await expect(header).toHaveCount(0);
  await expect(page.locator('.session-item')).toHaveCount(2);
});

test('the side terminal: one key opens it, goes to it and closes it', async () => {
  await createSession(page, 'Shell', repo);
  const pane = page.getByRole('region', { name: 'Terminal auxiliar' });

  await page.keyboard.press('Control+Shift+Quote');
  await expect(pane).toBeVisible();
  await expect.poll(focused).toBe('aux');
  await page.keyboard.press('Control+Shift+T');
  await expect.poll(focused).toBe('agent');
  // Open, but not in use: the key goes to it instead of closing it.
  await page.keyboard.press('Control+Shift+Quote');
  await expect(pane).toBeVisible();
  await expect.poll(focused).toBe('aux');

  // Bigger and smaller from the palette.
  const divider = page.getByRole('separator', { name: /Divisória/ });
  const before = Number(await divider.getAttribute('aria-valuenow'));
  await page.keyboard.press('Control+Shift+P');
  await page.keyboard.type('terminal auxiliar aumentar');
  await page.keyboard.press('Enter');
  await expect(divider).toHaveAttribute('aria-valuenow', String(before - 5));

  // Closing the palette hands the keyboard back to the agent's terminal.
  await expect.poll(focused).toBe('agent');
  await page.keyboard.press('Control+Shift+Quote');
  await expect.poll(focused).toBe('aux');
  // In use: the same key closes it.
  await page.keyboard.press('Control+Shift+Quote');
  await expect(pane).toBeHidden();
  await expect.poll(focused).toBe('agent');
});

test('the changes panel: mark, discard, edit and commit from the keyboard', async () => {
  fs.writeFileSync(path.join(repo, 'velho.txt'), 'linha um\nmudou\n');
  await createSession(page, 'Painel', repo);
  await page.keyboard.press('Control+Shift+G');
  const panel = page.getByRole('region', { name: 'Mudanças' });
  await expect.poll(focused).toBe('list');
  const item = (name: string) => panel.locator(`.change-item[data-path="${name}"]`);
  await expect(item('editado.ts')).toHaveAttribute('aria-selected', 'true');

  // Space marks the selected file for the commit, and unmarks it.
  await page.keyboard.press('Space');
  await expect(item('editado.ts')).toHaveAttribute('data-staged', 'all');

  // Enter goes into the editor; F6 walks list → editor → commit message → list.
  await page.keyboard.press('Enter');
  await expect.poll(focused).toBe('editor');
  await page.keyboard.press('F6');
  await expect.poll(focused).toBe('textarea:Mensagem do commit');
  await page.keyboard.press('F6');
  await expect.poll(focused).toBe('list');
  await page.keyboard.press('Shift+F6');
  await expect.poll(focused).toBe('textarea:Mensagem do commit');

  // Delete discards the selected file, after the question.
  await page.keyboard.press('F6');
  await expect.poll(focused).toBe('list');
  await page.keyboard.press('ArrowDown');
  await expect(item('velho.txt')).toHaveAttribute('aria-selected', 'true');
  page.once('dialog', (d) => void d.accept());
  await page.keyboard.press('Delete');
  await expect(item('velho.txt')).toHaveCount(0);
  expect(fs.readFileSync(path.join(repo, 'velho.txt'), 'utf8')).toBe(
    'linha um\nlinha dois\nlinha três\n',
  );

  // Ctrl+Enter from the list goes to the message; Ctrl+Enter there commits.
  await expect.poll(focused).toBe('list');
  await page.keyboard.press('Control+Enter');
  await expect.poll(focused).toBe('textarea:Mensagem do commit');
  await page.keyboard.type('Pelo teclado');
  await page.keyboard.press('Control+Enter');
  await expect(panel.getByRole('status')).toContainText('Nada foi enviado');
  expect(git(repo, 'log', '-1', '--format=%s').trim()).toBe('Pelo teclado');
});
