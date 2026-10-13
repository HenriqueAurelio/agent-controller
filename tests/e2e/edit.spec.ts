// Editing in the changes panel (ADR 0012): what can be edited, how it is saved, and every way
// unsaved edits could be lost.
import fs from 'node:fs';
import path from 'node:path';
import { expect, test, type FrameLocator, type Locator, type Page } from '@playwright/test';
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
let panel: Locator;
let frame: FrameLocator;
let modified: Locator;
let saveButton: Locator;

const file = (name: string) => path.join(repo, name);
const read = (name: string) => fs.readFileSync(file(name), 'utf8');
const unsaved = () => panel.getByText('Edições não salvas');

/** Answers the next "discard unsaved edits?" question and records that it was asked. */
function answerNextConfirm(accept: boolean): { asked: () => string | null } {
  let message: string | null = null;
  page.once('dialog', (dialog) => {
    message = dialog.message();
    void (accept ? dialog.accept() : dialog.dismiss());
  });
  return { asked: () => message };
}

async function openFile(name: string): Promise<void> {
  await panel.locator(`.change-item[data-path="${name}"]`).click();
  await expect(panel.locator('.diff-path')).toHaveText(name);
  // The editor has really switched to this file.
  await frame.locator(`body[data-path="${name}"]`).waitFor();
}

/**
 * Undoes the changed block on the given line with the control the editor puts between the two
 * sides, aligned with the block: an arrow ("Revert Block"), or a "more actions" menu holding
 * the same action when the block is the one the cursor is in.
 */
async function revertBlockAt(lineText: string): Promise<void> {
  const target = modified.locator('.view-line', { hasText: lineText }).first();
  await target.waitFor();
  const line = await target.boundingBox();
  if (!line) throw new Error(`a linha de "${lineText}" não está na tela`);
  const items = frame.locator('.gutterItem');
  await expect(items.first()).toBeVisible();
  // The control of a block sits at the height of the block: take the closest one.
  let closest = -1;
  let distance = Number.POSITIVE_INFINITY;
  for (let i = 0; i < (await items.count()); i++) {
    const box = await items.nth(i).boundingBox();
    const d = box ? Math.abs(box.y + box.height / 2 - (line.y + line.height / 2)) : Infinity;
    if (d < distance) [closest, distance] = [i, d];
  }
  if (closest < 0 || distance > line.height * 1.5) {
    throw new Error(
      `nenhum controle de desfazer na linha de "${lineText}" (distância ${distance})`,
    );
  }
  const item = items.nth(closest);
  // "Revert Block", or "Revert Selection" when the cursor is inside the block; directly as an
  // arrow, or inside a "more actions" menu.
  const revert = /^Revert (Block|Selection)$/;
  const arrow = item.getByLabel(revert);
  if ((await arrow.count()) > 0) {
    await arrow.first().click({ timeout: 3000 });
    return;
  }
  await item.getByLabel('More Actions...').click({ timeout: 3000 });
  const entry = frame.getByRole('menuitem', { name: revert }).first();
  try {
    await entry.waitFor({ timeout: 3000 });
    // The editor's menus ignore a click that comes right after they open.
    await page.waitForTimeout(700);
    await entry.click({ timeout: 3000 });
  } catch (err) {
    // Leave no menu open for the next attempt, and say what the editor offered instead.
    const offered = await frame.locator('[role="menuitem"]').allInnerTexts();
    await page.keyboard.press('Escape');
    throw new Error(`sem "Revert" no menu; o editor ofereceu: ${JSON.stringify(offered)}`, {
      cause: err,
    });
  }
}

/** What the controls between the two sides look like right now, for a failure message. */
async function describeGutter(): Promise<string> {
  const items = await frame.locator('.gutterItem').evaluateAll((els) =>
    els.map((el) => {
      const labels = [...el.querySelectorAll('[aria-label]')].map((a) =>
        a.getAttribute('aria-label'),
      );
      return `y=${Math.round(el.getBoundingClientRect().top)} ${labels.join('|')}`;
    }),
  );
  const lines = await modified
    .locator('.view-line')
    .evaluateAll((els) =>
      els.map((el) => `${Math.round(el.getBoundingClientRect().top)}:${el.textContent}`),
    );
  return `controles: ${JSON.stringify(items)} linhas: ${JSON.stringify(lines)}`;
}

/** Repeats `attempt` until it passes; when time runs out, fails with what the last try said. */
async function retry(attempt: () => Promise<void>, timeoutMs = 25_000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    try {
      await attempt();
      return;
    } catch (err) {
      if (Date.now() > deadline) throw err;
      await page.waitForTimeout(500);
    }
  }
}

/**
 * Saves and waits until the save is done. The "unsaved" mark has to be seen first: otherwise
 * its absence right after the keystroke would only mean the editor has not caught up yet.
 */
async function saveWith(how: 'keyboard' | 'button'): Promise<void> {
  await expect(unsaved()).toBeVisible();
  if (how === 'keyboard') await page.keyboard.press('Control+s');
  else await saveButton.click();
  await expect(unsaved()).toBeHidden();
}

async function typeAt(position: 'start' | 'end', text: string): Promise<void> {
  await modified.locator('.view-lines').click();
  await page.keyboard.press(position === 'start' ? 'Control+Home' : 'Control+End');
  await page.keyboard.type(text);
}

async function start(extraEnv: Record<string, string> = {}): Promise<void> {
  running = await launch(userData, extraEnv);
  page = running.page;
  await createSession(page, 'Repo', repo);
  await page.keyboard.press('Control+Shift+G');
  panel = page.getByRole('region', { name: 'Mudanças' });
  frame = page.frameLocator('[data-testid="diff-frame"]');
  modified = frame.locator('.editor.modified');
  saveButton = panel.getByRole('button', { name: 'Salvar', exact: true });
}

test.beforeEach(() => {
  userData = tempDir('ac-e2e-data-');
  repo = makeRepo();
  // What the "agent" changed: two separate blocks in one file, plus other kinds of change.
  fs.writeFileSync(
    file('editado.ts'),
    'export const valor = 2;\nexport const meio = "igual";\nexport const fim = "novo";\n',
  );
});
test.afterEach(async () => {
  await running?.app
    .evaluate(() => {
      process.env.AGENT_CONTROLLER_TEST_DIALOGS = 'accept';
    })
    .catch(() => {});
  page?.removeAllListeners('dialog');
  page?.on('dialog', (dialog) => void dialog.accept().catch(() => {}));
  await running?.close();
  running = null;
  removeDir(userData);
  removeDir(repo);
});

test('the arrow between the two sides undoes one block, and only after saving', async () => {
  git(repo, 'commit', '-q', '--allow-empty', '-m', 'vazio');
  fs.writeFileSync(file('editado.ts'), 'export const valor = 1;\nexport const meio = "igual";\n');
  git(repo, 'add', '-A');
  git(repo, 'commit', '-q', '-m', 'duas linhas');
  fs.writeFileSync(
    file('editado.ts'),
    'export const valor = 2;\nexport const meio = "igual";\nexport const fim = "novo";\n',
  );
  await start();
  await openFile('editado.ts');
  await expect(modified).toContainText('valor = 2');

  // Two changed blocks. Undo the first one. (The editor draws these controls a moment after
  // the text, so the attempt is repeated until it takes.)
  await retry(async () => {
    await revertBlockAt('valor');
    await expect(modified).toContainText('valor = 1', { timeout: 1500 });
  });
  await expect(unsaved()).toBeVisible();
  expect(read('editado.ts')).toContain('valor = 2'); // Nothing on disk yet.

  await saveWith('button');
  expect(read('editado.ts')).toBe(
    'export const valor = 1;\nexport const meio = "igual";\nexport const fim = "novo";\n',
  );

  // Undoing the last block makes the file equal to the commit: it leaves the list.
  // The editor redraws these controls after the save; a click that lands mid-redraw is lost.
  await retry(async () => {
    await revertBlockAt('fim');
    await expect(modified, await describeGutter()).not.toContainText('fim', { timeout: 1500 });
  });
  await expect(unsaved()).toBeVisible();
  await saveButton.click();
  await expect(panel.locator('.change-item[data-path="editado.ts"]')).toHaveCount(0);
  expect(git(repo, 'status', '--porcelain')).toBe('');
});

test('Save button, Discard button, and the state of each', async () => {
  await start();
  await openFile('editado.ts');
  await expect(saveButton).toBeDisabled();
  await expect(panel.getByRole('button', { name: 'Descartar edições' })).toHaveCount(0);

  await typeAt('end', '// rascunho');
  await expect(saveButton).toBeEnabled();
  await panel.getByRole('button', { name: 'Descartar edições' }).click();
  await expect(modified).not.toContainText('rascunho');
  await expect(unsaved()).toBeHidden();
  await expect(saveButton).toBeDisabled();
  expect(read('editado.ts')).not.toContain('rascunho');

  await typeAt('end', '// definitivo');
  await saveWith('button');
  expect(read('editado.ts')).toMatch(/\/\/ definitivo$/);

  // Typing and undoing back to what is on disk is not "unsaved".
  await typeAt('end', 'x');
  await expect(unsaved()).toBeVisible();
  await page.keyboard.press('Backspace');
  await expect(unsaved()).toBeHidden();
});

test('a conflict can be resolved by overwriting with my version', async () => {
  await start();
  await openFile('editado.ts');
  await typeAt('start', '// minha versao\n');
  fs.writeFileSync(file('editado.ts'), 'export const valor = 777; // do agente\n');
  await page.waitForTimeout(1200);

  await page.keyboard.press('Control+s');
  const alert = panel.getByRole('alert');
  await expect(alert).toContainText('O arquivo mudou no disco');
  expect(read('editado.ts')).toBe('export const valor = 777; // do agente\n');

  await alert.getByRole('button', { name: 'Sobrescrever com a minha versão' }).click();
  await expect(alert).toHaveCount(0);
  await expect(unsaved()).toBeHidden();
  expect(read('editado.ts')).toMatch(/^\/\/ minha versao\nexport const valor = 2;/);
  expect(read('editado.ts')).not.toContain('do agente');
});

test('unsaved edits are not lost by switching file, by the arrow keys or by closing the panel', async () => {
  await start();
  fs.writeFileSync(file('outro.txt'), 'segundo arquivo\n');
  await expect(panel.locator('.change-item[data-path="outro.txt"]')).toBeVisible();
  await openFile('editado.ts');
  await typeAt('end', '// pendente');
  await expect(unsaved()).toBeVisible();

  // Clicking another file: asked, refused, nothing changes.
  let confirm = answerNextConfirm(false);
  await panel.locator('.change-item[data-path="outro.txt"]').click();
  await expect.poll(confirm.asked).toContain('Há edições não salvas em editado.ts');
  await expect(panel.locator('.diff-path')).toHaveText('editado.ts');
  await expect(modified).toContainText('pendente');

  // Arrow keys in the list: the same.
  confirm = answerNextConfirm(false);
  await panel.getByRole('listbox', { name: 'Arquivos modificados' }).focus();
  await page.keyboard.press('ArrowDown');
  await expect.poll(confirm.asked).not.toBeNull();
  await expect(panel.locator('.diff-path')).toHaveText('editado.ts');

  // The close button and Esc on the panel: the same.
  confirm = answerNextConfirm(false);
  await panel.getByRole('button', { name: 'Fechar o painel de mudanças' }).click();
  await expect.poll(confirm.asked).not.toBeNull();
  await expect(panel).toBeVisible();
  confirm = answerNextConfirm(false);
  await page.keyboard.press('Escape');
  await expect.poll(confirm.asked).not.toBeNull();
  await expect(panel).toBeVisible();

  // The "compare with" selector: the same.
  confirm = answerNextConfirm(false);
  await panel.getByLabel('Comparar com').selectOption('session');
  await expect.poll(confirm.asked).not.toBeNull();
  await expect(modified).toContainText('pendente');

  // Esc typed inside the editor does not even ask: it belongs to the editor while editing.
  await modified.locator('.view-lines').click();
  await page.keyboard.press('Escape');
  await page.waitForTimeout(300);
  await expect(panel).toBeVisible();
  await expect(modified).toContainText('pendente');

  // Accepting the question does switch. The edit is discarded; the file on disk never had it.
  confirm = answerNextConfirm(true);
  await panel.locator('.change-item[data-path="outro.txt"]').click();
  await expect.poll(confirm.asked).not.toBeNull();
  await expect(panel.locator('.diff-path')).toHaveText('outro.txt');
  await expect(unsaved()).toBeHidden();
  expect(read('editado.ts')).not.toContain('pendente');
});

test('unsaved edits are not lost by the shortcuts, by switching session or by closing the app', async () => {
  await start({ AGENT_CONTROLLER_TEST_DIALOGS: 'cancel' });
  await createSession(page, 'Outra', repo);
  await page.keyboard.press('Control+1');
  await expect(panel).toBeVisible();
  await openFile('editado.ts');
  await typeAt('end', '// pendente');
  await expect(unsaved()).toBeVisible();
  const selectedName = () =>
    page.locator('.session-item[aria-selected="true"] .session-name').innerText();

  // Ctrl+Shift+G typed inside the editor reaches the app, which asks.
  let confirm = answerNextConfirm(false);
  await page.keyboard.press('Control+Shift+G');
  await expect.poll(confirm.asked).toContain('editado.ts');
  await expect(panel).toBeVisible();

  // The toolbar button.
  confirm = answerNextConfirm(false);
  await page.locator('.session-header button[title^="See changes"]').click();
  await expect.poll(confirm.asked).not.toBeNull();
  await expect(panel).toBeVisible();

  // Switching session: by shortcut, by number and by clicking in the sidebar.
  for (const leave of [
    () => page.keyboard.press('Control+Tab'),
    () => page.keyboard.press('Control+2'),
    () => page.locator('.session-item', { hasText: 'Outra' }).click(),
  ]) {
    confirm = answerNextConfirm(false);
    await leave();
    await expect.poll(confirm.asked).not.toBeNull();
    expect(await selectedName()).toBe('Repo');
    await expect(modified).toContainText('pendente');
  }

  // Closing the window: the app asks about the file, and "cancel" keeps everything.
  await running!.app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0]!.close());
  await page.waitForTimeout(500);
  const questions = await running!.app.evaluate(
    () => (globalThis as unknown as { __closeQuestions?: string[] }).__closeQuestions ?? [],
  );
  expect(questions).toHaveLength(1);
  expect(questions[0]).toContain('Há edições não salvas no painel de mudanças');
  expect(questions[0]).toContain('editado.ts');
  await expect(modified).toContainText('pendente');

  // Saving clears the warning: the next question on close is only about the running agents.
  await modified.locator('.view-lines').click();
  await saveWith('keyboard');
  await running!.app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0]!.close());
  await page.waitForTimeout(500);
  const after = await running!.app.evaluate(
    () => (globalThis as unknown as { __closeQuestions: string[] }).__closeQuestions,
  );
  expect(after).toHaveLength(2);
  expect(after[1]).toContain('agentes rodando');
  expect(read('editado.ts')).toContain('// pendente');

  // With nothing pending, switching session asks nothing.
  await page.keyboard.press('Control+2');
  await expect.poll(selectedName).toBe('Outra');

  // Let the harness close the app.
  await running!.app.evaluate(() => {
    process.env.AGENT_CONTROLLER_TEST_DIALOGS = 'accept';
  });
});

test('with nothing to lose, Esc and the shortcuts work from inside the editor', async () => {
  await start();
  await openFile('editado.ts');
  await modified.locator('.view-lines').click();

  await page.keyboard.press('Control+Shift+P');
  const palette = page.getByRole('dialog', { name: 'Paleta de comandos' });
  await expect(palette).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(palette).toBeHidden();

  await modified.locator('.view-lines').click();
  await page.keyboard.press('Escape');
  await expect(panel).toBeHidden();

  await page.keyboard.press('Control+Shift+G');
  await openFile('editado.ts');
  await modified.locator('.view-lines').click();
  await page.keyboard.press('Control+Shift+G');
  await expect(panel).toBeHidden();
});

test('what can be edited: new files yes; removed and binary files no; the git side never', async () => {
  fs.writeFileSync(file('novo.txt'), 'arquivo novo\n');
  fs.rmSync(file('removido.txt'));
  fs.writeFileSync(file('imagem.png'), Buffer.from([0x89, 0x50, 0x4e, 0x47, 0, 1, 2, 0, 0]));
  await start();

  // Untracked file: editable and saved like any other.
  await openFile('novo.txt');
  await expect(panel.getByText('Arquivo novo')).toBeVisible();
  await typeAt('end', 'mais uma linha');
  await saveWith('button');
  expect(read('novo.txt')).toBe('arquivo novo\nmais uma linha');

  // Removed file: there is nothing in the folder to edit.
  await openFile('removido.txt');
  await expect(panel.getByText('Arquivo removido')).toBeVisible();
  await expect(saveButton).toHaveCount(0);
  await modified.locator('.view-lines').click({ force: true });
  await page.keyboard.type('zzz');
  await expect(unsaved()).toHaveCount(0);
  expect(fs.existsSync(file('removido.txt'))).toBe(false);

  // Binary file: no editor at all.
  await panel.locator('.change-item[data-path="imagem.png"]').click();
  await expect(panel.locator('.diff-view')).toContainText('Arquivo binário');
  await expect(panel.locator('.diff-toolbar')).toHaveCount(0);

  // The left side (what git has) cannot be typed into.
  await openFile('editado.ts');
  await frame.locator('.editor.original .view-lines').click();
  await page.keyboard.type('zzz');
  await expect(frame.locator('.editor.original')).not.toContainText('zzz');
  await expect(unsaved()).toHaveCount(0);
});

test('editing while comparing with the start of the session, and in inline mode', async () => {
  await start();
  // The session snapshot is taken when the session starts; this change comes after it.
  await page.waitForTimeout(1500);
  fs.writeFileSync(file('editado.ts'), read('editado.ts') + 'export const depois = true;\n');
  await panel.getByLabel('Comparar com').selectOption('session');
  await openFile('editado.ts');
  await expect(modified).toContainText('depois = true');
  // Against the session start, only the last line is a change.
  await expect(frame.locator('.editor.original')).toContainText('fim = "novo"');
  await expect(frame.locator('.editor.original')).not.toContainText('depois = true');

  await panel.getByRole('button', { name: 'Lado a lado' }).click();
  await expect(panel.getByRole('button', { name: 'Em linha' })).toHaveAttribute(
    'aria-pressed',
    'true',
  );
  await typeAt('end', '// em linha');
  await saveWith('keyboard');
  expect(read('editado.ts')).toMatch(/depois = true;\n\/\/ em linha$/);

  // Switching the view mode with unsaved edits keeps them.
  await typeAt('end', ' e mais');
  await panel.getByRole('button', { name: 'Em linha' }).click();
  await expect(unsaved()).toBeVisible();
  await expect(modified).toContainText('e mais');
});

test('line endings and accents survive a save', async () => {
  fs.writeFileSync(file('windows.txt'), 'primeira linha\r\nação e coração\r\n');
  await start();
  await openFile('windows.txt');
  await typeAt('end', 'última');
  await saveWith('keyboard');
  expect(fs.readFileSync(file('windows.txt'))).toEqual(
    Buffer.from('primeira linha\r\nação e coração\r\núltima', 'utf8'),
  );
});

test('the save command refuses what the panel should never write', async () => {
  await start();
  await openFile('editado.ts');
  const save = (target: string, session?: string) =>
    page.evaluate(
      async ([target, session]) => {
        const { sessions } = await window.api.invoke('sessions:list');
        return window.api.invoke('git:save', session ?? sessions[0]!.id, target!, 'x', null).then(
          () => 'gravou',
          (e: Error) => e.message,
        );
      },
      [target, session] as const,
    );
  expect(await save('../fora.txt')).toContain('fora do repositório');
  expect(await save('.git/config')).toContain('internos do git');
  expect(await save('src')).toContain('arquivos comuns');
  expect(await save('editado.ts', 'sessao-que-nao-existe')).toContain('Sessão não encontrada');
  expect(fs.existsSync(path.join(path.dirname(repo), 'fora.txt'))).toBe(false);
  expect(git(repo, 'config', 'user.name').trim()).toBe('E2E');
});

test('typing while the next file is still loading never lands in the previous file', async () => {
  fs.writeFileSync(file('outro.txt'), 'segundo arquivo\n');
  await start();
  await openFile('editado.ts');
  // Click the other file and type at once, without waiting for it to load. Depending on how
  // fast it loads, the text goes nowhere or into the new file; never into the one left behind.
  await panel.locator('.change-item[data-path="outro.txt"]').click();
  await modified.locator('.view-lines').click({ force: true });
  await page.keyboard.type('perdido');
  await frame.locator('body[data-path="outro.txt"]').waitFor();
  await page.waitForTimeout(300);
  expect(read('editado.ts')).not.toContain('perdido');

  page.on('dialog', (dialog) => void dialog.accept());
  await openFile('editado.ts');
  await expect(modified).toContainText('valor = 2');
  await expect(modified).not.toContainText('perdido');
  await expect(unsaved()).toHaveCount(0);
  expect(read('outro.txt')).toBe('segundo arquivo\n');
});
