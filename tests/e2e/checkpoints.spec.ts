import fs from 'node:fs';
import path from 'node:path';
import { expect, test, type Page } from '@playwright/test';
import {
  createSession,
  git,
  launch,
  makeRepo,
  removeDir,
  screenText,
  setTitle,
  stop,
  tempDir,
} from './harness';

const row = (page: Page, id: string) => page.locator(`.session-item[data-session-id="${id}"]`);
const listed = (page: Page) =>
  page
    .locator('.change-item')
    .evaluateAll((items) => items.map((i) => i.getAttribute('data-path')));

/** One turn of the agent that writes a file: a spinner in the title, the file, then idle. */
async function turn(page: Page, id: string, repo: string, n: number) {
  await setTitle(page, `◐ turno ${n}`);
  await expect(row(page, id)).toHaveAttribute('data-state', 'trabalhando', { timeout: 15_000 });
  fs.writeFileSync(path.join(repo, `turno${n}.ts`), `export const turno = ${n};\n`);
  fs.writeFileSync(path.join(repo, 'editado.ts'), `export const valor = ${n + 1};\n`);
  await setTitle(page, '✳ pronto');
  await expect(row(page, id)).toHaveAttribute('data-state', 'terminou', { timeout: 15_000 });
}

/**
 * The photo of the folder as the session found it is taken when it starts, in the background; a
 * turn right on its heels would be in it.
 */
const startPhoto = (page: Page) => page.waitForTimeout(3000);

/** What the user's git has, which checkpoints must not change. */
const gitState = (repo: string) => ({
  head: git(repo, 'rev-parse', 'HEAD'),
  branch: git(repo, 'symbolic-ref', 'HEAD'),
  log: git(repo, 'log', '--oneline'),
  staged: git(repo, 'diff', '--cached', '--name-status'),
});

test('three turns: see only what the last one changed, go back to the first and undo it', async () => {
  test.setTimeout(180_000);
  const userData = tempDir('ac-e2e-checkpoints-');
  const repo = makeRepo();
  const running = await launch(userData);
  const { page } = running;
  page.on('dialog', (dialog) => void dialog.accept());
  try {
    const id = await createSession(page, 'Linha', repo);
    await startPhoto(page);
    for (const n of [1, 2, 3]) {
      await turn(page, id, repo, n);
      // The start and one checkpoint per turn.
      await expect(page.locator('.timeline-button .count')).toHaveText(String(n + 1), {
        timeout: 15_000,
      });
    }
    const before = gitState(repo);
    expect(git(repo, 'for-each-ref', '--format=%(refname)', 'refs/agent-controller/')).toContain(
      `refs/agent-controller/checkpoints/${id}/3`,
    );

    // "The previous turn": only what turn 3 changed.
    await page.keyboard.press('Control+Shift+G');
    const panel = page.getByRole('region', { name: 'Mudanças' });
    await expect
      .poll(() => listed(page))
      .toEqual(['editado.ts', 'turno1.ts', 'turno2.ts', 'turno3.ts']);
    await panel.getByLabel('Comparar com').selectOption({ label: 'O turno anterior' });
    await expect.poll(() => listed(page)).toEqual(['editado.ts', 'turno3.ts']);

    // The timeline: a pair of turns, then back to the first.
    await page.locator('.timeline-button').click();
    const timeline = page.getByRole('dialog', { name: 'Linha do tempo de “Linha”' });
    await expect(timeline.locator('.timeline-label strong')).toHaveText([
      'Turno 3',
      'Turno 2',
      'Turno 1',
      'Início',
    ]);
    await timeline
      .locator('.timeline-item[data-checkpoint="2"]')
      .getByRole('button', { name: 'Ver o que mudou' })
      .click();
    await expect(timeline).toBeHidden();
    await expect.poll(() => listed(page)).toEqual(['editado.ts', 'turno2.ts']);
    await expect(panel.getByLabel('Comparar com')).toHaveValue('checkpoint:1..2');
    await expect(panel.locator('.diff-note', { hasText: 'Só leitura' })).toBeVisible();

    await page.locator('.timeline-button').click();
    await timeline.getByRole('button', { name: 'Voltar a Turno 1' }).click();
    await expect(timeline.getByTestId('timeline-restored')).toContainText(
      'Os arquivos voltaram a “Turno 1”',
    );
    expect(fs.existsSync(path.join(repo, 'turno1.ts'))).toBe(true);
    expect(fs.existsSync(path.join(repo, 'turno2.ts'))).toBe(false);
    expect(fs.existsSync(path.join(repo, 'turno3.ts'))).toBe(false);
    expect(fs.readFileSync(path.join(repo, 'editado.ts'), 'utf8')).toBe(
      'export const valor = 2;\n',
    );
    expect(gitState(repo)).toEqual(before);

    // The agent is told only when the user asks; the text waits at its prompt.
    await timeline.getByRole('button', { name: 'Avisar o agente' }).click();
    await expect
      .poll(async () => (await screenText(page, id)).replace(/\r?\n/g, ''), { timeout: 15_000 })
      .toContain('Voltei os arquivos desta pasta a “Turno 1”');

    await timeline.getByRole('button', { name: 'Desfazer' }).click();
    await expect(timeline.getByRole('status')).toHaveText('A volta foi desfeita.');
    for (const n of [1, 2, 3]) expect(fs.existsSync(path.join(repo, `turno${n}.ts`))).toBe(true);
    expect(fs.readFileSync(path.join(repo, 'editado.ts'), 'utf8')).toBe(
      'export const valor = 4;\n',
    );
    expect(gitState(repo)).toEqual(before);
    await timeline.getByRole('button', { name: 'Fechar' }).click();
  } finally {
    await running.close();
    removeDir(userData);
    removeDir(repo);
  }
});

test('closing the session asks about its checkpoints, and can remove them', async () => {
  test.setTimeout(120_000);
  const userData = tempDir('ac-e2e-checkpoints-close-');
  const repo = makeRepo();
  const running = await launch(userData);
  const { page } = running;
  try {
    const id = await createSession(page, 'Fecha', repo);
    await startPhoto(page);
    await turn(page, id, repo, 1);
    await expect(page.locator('.timeline-button .count')).toHaveText('2', { timeout: 15_000 });
    // A stopped session closes without a question, unless it has checkpoints.
    await stop(page, 'Fecha');
    await expect(row(page, id)).toHaveAttribute('data-state', 'parada', { timeout: 15_000 });
    await page.keyboard.press('Control+Shift+P');
    await page
      .getByRole('dialog', { name: 'Paleta de comandos' })
      .getByRole('option', { name: 'Fechar a sessão “Fecha”' })
      .click();
    const dialog = page.getByRole('dialog', { name: 'Fechar sessão' });
    await expect(dialog).toContainText('Esta sessão tem 2 checkpoint(s) no repositório.');
    await dialog.getByLabel(/Apagar os checkpoints desta sessão/).check();
    await dialog.getByRole('button', { name: 'Fechar', exact: true }).click();
    await expect(row(page, id)).toHaveCount(0);
    expect(git(repo, 'for-each-ref', 'refs/agent-controller/')).toBe('');
    // The files stay as the turn left them.
    expect(fs.existsSync(path.join(repo, 'turno1.ts'))).toBe(true);
  } finally {
    await running.close();
    removeDir(userData);
    removeDir(repo);
  }
});

test('outside a git repository there is no timeline', async () => {
  const userData = tempDir('ac-e2e-checkpoints-plain-');
  const folder = tempDir('ac-e2e-sem-git-');
  const running = await launch(userData);
  const { page } = running;
  try {
    await createSession(page, 'Solta', folder);
    await expect(page.locator('.session-header')).toBeVisible();
    await page.waitForTimeout(1000);
    await expect(page.locator('.timeline-button')).toHaveCount(0);
  } finally {
    await running.close();
    removeDir(userData);
    removeDir(folder);
  }
});
