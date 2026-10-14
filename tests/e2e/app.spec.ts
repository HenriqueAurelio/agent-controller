import fs from 'node:fs';
import path from 'node:path';
import { expect, test, type Page } from '@playwright/test';
import {
  createSession,
  git,
  launch,
  makeRepo,
  removeDir,
  runInTerminal,
  screenText,
  tempDir,
  type RunningApp,
} from './harness';

let userData: string;
let work: string;
let running: RunningApp | null = null;
let repos: string[] = [];

test.beforeEach(() => {
  userData = tempDir('ac-e2e-data-');
  work = tempDir('ac-e2e-work-');
});
test.afterEach(async () => {
  await running?.close();
  running = null;
  // Only after the app is gone: its shells hold these folders open.
  for (const dir of [userData, work, ...repos]) removeDir(dir);
  repos = [];
});

const open = async () => (running = await launch(userData));

test('the renderer has no access to Node, and the IPC contract answers', async () => {
  const { page } = await open();
  const exposed = await page.evaluate(() => ({
    require: typeof (window as unknown as Record<string, unknown>).require,
    process: typeof (window as unknown as Record<string, unknown>).process,
    module: typeof (window as unknown as Record<string, unknown>).module,
    api: Object.keys(window.api).sort(),
  }));
  expect(exposed).toEqual({
    require: 'undefined',
    process: 'undefined',
    module: 'undefined',
    api: ['invoke', 'on', 'pathForFile'],
  });
  expect(await page.evaluate(() => window.api.invoke('app:ping', 'olá'))).toBe('pong: olá');
  // A channel outside the contract is refused by the preload.
  const refused = await page.evaluate(() =>
    (window.api.invoke as (c: string) => Promise<unknown>)('shell:exec').then(
      () => 'aceito',
      (e: Error) => e.message,
    ),
  );
  expect(refused).toContain('Canal desconhecido');
});

test('a start that went wrong is followed by a safe one, without hardware acceleration', async () => {
  const guard = path.join(userData, 'gpu-guard.json');
  const gpu = (app: RunningApp['app']) =>
    app.evaluate(({ app }) => ({
      inProcess: app.commandLine.hasSwitch('in-process-gpu'),
      accelerated: app.isHardwareAccelerationEnabled(),
    }));

  // A normal start uses the lighter mode and, once it proves healthy, clears its marker.
  let { page, app } = await open();
  expect(await page.evaluate(() => window.api.invoke('app:info'))).toMatchObject({
    gpuMode: 'fast',
  });
  // Whether acceleration is really on depends on the machine; a container has no GPU at all.
  expect(await gpu(app)).toMatchObject({ inProcess: true });
  expect(JSON.parse(fs.readFileSync(guard, 'utf8'))).toEqual({ pending: true });
  await expect
    .poll(() => JSON.parse(fs.readFileSync(guard, 'utf8')), { timeout: 15_000 })
    .toEqual({});
  await running!.close();

  // The previous start died before proving healthy (a video driver crash would look like this).
  fs.writeFileSync(guard, JSON.stringify({ pending: true }));
  ({ page, app } = await open());
  expect(await page.evaluate(() => window.api.invoke('app:info'))).toMatchObject({
    gpuMode: 'safe',
  });
  expect(await gpu(app)).toEqual({ inProcess: false, accelerated: false });

  // The app is fully usable in safe mode, and stays in it.
  const id = await createSession(page, 'Modo seguro', work);
  await runInTerminal(page, id, 'echo sem-gpu-ok', 'sem-gpu-ok');
  await running!.close();
  ({ page } = await open());
  expect(await page.evaluate(() => window.api.invoke('app:info'))).toMatchObject({
    gpuMode: 'safe',
  });
});

test('the window cannot navigate away nor open other windows', async () => {
  const { page, app } = await open();
  const before = page.url();
  await page.evaluate(() => {
    window.open('https://example.com');
    location.href = 'https://example.com';
  });
  await page.waitForTimeout(500);
  expect(page.url()).toBe(before);
  expect(app.windows()).toHaveLength(1);
});

test('create a session, run a command, rename, close the app and find it again', async () => {
  let { page } = await open();
  await expect(page.getByText('Nenhuma sessão')).toBeVisible();

  const id = await createSession(page, 'Minha API', work);
  await runInTerminal(
    page,
    id,
    'echo saida-$((6*7))',
    process.platform === 'win32' ? 'saida-' : 'saida-42',
  );
  await runInTerminal(page, id, 'echo terminal-ok', 'terminal-ok');

  // Rename in place, by keyboard.
  const item = page.locator('.session-item', { hasText: 'Minha API' });
  await item.focus();
  await page.keyboard.press('F2');
  await page.getByLabel('Nome da sessão').fill('API de pagamentos');
  await page.keyboard.press('Enter');
  await expect(page.locator('.session-item', { hasText: 'API de pagamentos' })).toBeVisible();
  // After the action the keyboard is back in the terminal.
  await expect(page.locator('.terminal-host.visible .xterm-helper-textarea')).toBeFocused();

  await running!.close();
  ({ page } = await open());

  const restored = page.locator('.session-item');
  await expect(restored).toHaveCount(1);
  await expect(restored).toContainText('API de pagamentos');
  await expect(restored).toContainText('Claude Code');
  await expect(restored).toHaveAttribute('data-state', 'parada');
  await expect(restored).toHaveAttribute('aria-selected', 'true');
  await expect(page.getByTestId('session-status')).toContainText('Parada');

  // Sessions come back stopped, with the action to start them.
  await page.getByRole('button', { name: 'Iniciar' }).click();
  await expect(restored).not.toHaveAttribute('data-state', 'parada');
  await runInTerminal(page, id, 'echo de-volta', 'de-volta');
});

test('five sessions of both agents, switched by shortcut, survive a restart', async () => {
  let { page } = await open();
  const names = ['Um', 'Dois', 'Três', 'Quatro', 'Cinco'];
  for (const [i, name] of names.entries()) {
    await createSession(page, name, work, i % 2 === 0 ? 'Claude Code' : 'Codex');
  }
  const selected = () =>
    page.locator('.session-item[aria-selected="true"] .session-name').innerText();

  expect(await selected()).toBe('Cinco');
  await page.keyboard.press('Control+1');
  expect(await selected()).toBe('Um');
  await page.keyboard.press('Control+Tab');
  expect(await selected()).toBe('Dois');
  await page.keyboard.press('Control+Shift+Tab');
  await page.keyboard.press('Control+Shift+Tab');
  expect(await selected()).toBe('Cinco');
  await page.keyboard.press('Control+3');
  expect(await selected()).toBe('Três');
  await expect(page.locator('.terminal-host.visible .xterm-helper-textarea')).toBeFocused();

  // New session by shortcut, cancelled with Esc.
  await page.keyboard.press('Control+Shift+N');
  await expect(page.getByRole('dialog', { name: 'Nova sessão' })).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(page.getByRole('dialog')).toBeHidden();

  // Reorder by keyboard: "Três" goes up one position.
  await page.locator('.session-item', { hasText: 'Três' }).focus();
  await page.keyboard.press('Alt+ArrowUp');
  await expect(page.locator('.session-name')).toHaveText(['Um', 'Três', 'Dois', 'Quatro', 'Cinco']);

  await running!.close();
  ({ page } = await open());
  await expect(page.locator('.session-name')).toHaveText(['Um', 'Três', 'Dois', 'Quatro', 'Cinco']);
  await expect(page.locator('.profile-tag')).toHaveText([
    'Claude Code',
    'Claude Code',
    'Codex',
    'Codex',
    'Claude Code',
  ]);
  await expect(page.locator('.session-item[data-state="parada"]')).toHaveCount(5);
  expect(await selected()).toBe('Três');
});

test('only a fixed number of terminals stays mounted, and an unmounted one comes back intact', async () => {
  const { page } = await open();
  const ids: string[] = [];
  for (let i = 1; i <= 6; i++) {
    const id = await createSession(page, `S${i}`, work);
    await runInTerminal(page, id, `echo marca-da-sessao-${i}`, `marca-da-sessao-${i}`);
    ids.push(id);
  }
  await expect(page.locator('.terminal-host')).toHaveCount(3);
  await expect(page.locator('.terminal-host.visible')).toHaveCount(1);

  // S1 was unmounted long ago. Its screen is rebuilt from the history in the main process.
  // The Windows console pads repainted lines with spaces; only the text matters here.
  const text = async () => (await screenText(page, ids[0]!)).replace(/[ 	]+$/gm, '');
  const before = await text();
  await page.keyboard.press('Control+1');
  const host = page.locator(`.terminal-host.visible[data-session-id="${ids[0]}"]`);
  await expect(host).toHaveAttribute('data-mount-ms', /\d+/);
  expect(await text()).toBe(before);
  expect(before).toContain('marca-da-sessao-1');
  expect(Number(await host.getAttribute('data-mount-ms'))).toBeLessThan(200);
  await expect(page.locator('.terminal-host')).toHaveCount(3);

  // And it is still a live terminal.
  await runInTerminal(page, ids[0]!, 'echo ainda-viva', 'ainda-viva');
});

test('closing a session asks before ending a running one', async () => {
  const { page } = await open();
  await createSession(page, 'Descartável', work);
  await page.getByRole('button', { name: 'Fechar Descartável' }).click();
  const confirm = page.getByRole('dialog', { name: 'Fechar sessão' });
  await expect(confirm).toContainText('está rodando');
  await confirm.getByRole('button', { name: 'Cancelar' }).click();
  await expect(page.locator('.session-item')).toHaveCount(1);

  await page.getByRole('button', { name: 'Fechar Descartável' }).click();
  await confirm.getByRole('button', { name: 'Encerrar e fechar' }).click();
  await expect(page.locator('.session-item')).toHaveCount(0);
  await expect(page.getByText('Nenhuma sessão')).toBeVisible();
});

test('state follows the agent, and a session out of focus notifies, shows a badge and opens on click', async () => {
  const { page, app } = await open();
  // A stand-in for an agent's turn: the window titles Claude Code sets while it works and when
  // it stops. Typing the command and Enter is the "prompt".
  fs.writeFileSync(
    path.join(work, 'turno.cjs'),
    `const title = (t) => process.stdout.write('\\x1b]0;' + t + '\\x07');
     const timer = setInterval(() => title('◐ tarefa'), 80);
     setTimeout(() => { clearInterval(timer); title('✳ tarefa'); }, 2500);`,
  );
  const a = await createSession(page, 'Agente A', work);
  await createSession(page, 'Agente B', work);

  // Record native notifications instead of letting the desktop show them.
  await app.evaluate(({ Notification }) => {
    const shown: { title: string; body: string }[] = [];
    const g = globalThis as unknown as Record<string, unknown>;
    g.__shown = shown;
    // A CI machine has no notification service; what is tested here is the app's decision.
    Notification.isSupported = () => true;
    Notification.prototype.show = function (this: Electron.Notification) {
      shown.push({ title: this.title, body: this.body });
      g.__last = this;
    };
  });
  const shown = () =>
    app.evaluate(
      () => (globalThis as unknown as { __shown: { title: string; body: string }[] }).__shown,
    );

  const itemA = page.locator('.session-item', { hasText: 'Agente A' });
  await page.keyboard.press('Control+1');
  await page.locator('.terminal-host.visible').click();
  await page.keyboard.type('node turno.cjs');
  await page.keyboard.press('Enter');
  await expect(itemA).toHaveAttribute('data-state', 'trabalhando');
  await expect(page.getByTestId('session-status')).toContainText('Trabalhando');

  // Look at the other session while A works.
  await page.keyboard.press('Control+2');
  await expect(itemA).toHaveAttribute('data-state', 'terminou', { timeout: 15_000 });
  await expect(itemA).toHaveAttribute('data-confirmed', 'true');
  await expect(itemA.locator('.badge')).toBeVisible();
  expect(await shown()).toEqual([{ title: 'Agente A', body: 'O agente terminou.' }]);

  // Clicking the notification brings the session up, which clears its badge.
  await app.evaluate(() =>
    (globalThis as unknown as { __last: Electron.Notification }).__last.emit('click'),
  );
  await expect(itemA).toHaveAttribute('aria-selected', 'true');
  await expect(itemA.locator('.badge')).toHaveCount(0);

  // The session in focus is never notified.
  await page.locator('.terminal-host.visible').click();
  await page.keyboard.type('node turno.cjs');
  await page.keyboard.press('Enter');
  await expect(itemA).toHaveAttribute('data-state', 'trabalhando');
  await expect(itemA).toHaveAttribute('data-state', 'terminou', { timeout: 15_000 });
  expect(await shown()).toHaveLength(1);
  expect(await screenText(page, a)).toContain('turno.cjs');
});

test('"aguardando você" stands out in the sidebar, in the header and in the window title', async () => {
  const { page, app } = await open();
  // The title an agent shows when it is at its prompt, waiting.
  fs.writeFileSync(
    path.join(work, 'pronto.cjs'),
    `process.stdout.write('\\x1b]0;✳ agente\\x07'); setInterval(() => {}, 1000);`,
  );
  await createSession(page, 'Esperando', work);
  await createSession(page, 'Quieta', work);
  const waiting = page.locator('.session-item', { hasText: 'Esperando' });
  const other = page.locator('.session-item', { hasText: 'Quieta' });
  // The second session is stopped, to compare with: a Windows shell sets a window title of its
  // own and would count as "at the prompt" too.
  await page.getByRole('button', { name: 'Parar' }).click();
  await expect(other).toHaveAttribute('data-state', 'parada');
  await page.keyboard.press('Control+1');
  await page.locator('.terminal-host.visible').click();
  await page.keyboard.type('node pronto.cjs');
  await page.keyboard.press('Enter');
  await expect(waiting).toHaveAttribute('data-state', 'aguardando');

  const style = (locator: typeof waiting, property: string) =>
    locator.evaluate((el, p) => getComputedStyle(el).getPropertyValue(p), property);
  const transparent = 'rgba(0, 0, 0, 0)';

  // The label is a filled tag, in bold; the other session's label is plain text.
  const label = waiting.locator('.session-state');
  await expect(label).toHaveText('Aguardando você');
  expect(await style(label, 'background-color')).not.toBe(transparent);
  expect(Number(await style(label, 'font-weight'))).toBeGreaterThanOrEqual(700);
  expect(await style(other.locator('.session-state'), 'background-color')).toBe(transparent);

  // The row itself is tinted and marked on the left, selected or not, and the dot pulses.
  await page.keyboard.press('Control+2');
  expect(await style(waiting, 'background-color')).not.toBe(transparent);
  expect(await style(waiting, 'border-left-color')).toBe(await style(label, 'background-color'));
  expect(await style(other, 'border-left-color')).not.toBe(await style(label, 'background-color'));
  expect(await style(waiting.locator('.state-dot'), 'animation-name')).toBe('attention');
  expect(await style(waiting.locator('.session-name'), 'color')).toBe(
    await style(label, 'background-color'),
  );

  // The header of the selected session uses the same tag.
  await page.keyboard.press('Control+1');
  const header = page.getByTestId('session-status');
  await expect(header).toContainText('Aguardando você');
  expect(await style(header, 'background-color')).toBe(await style(label, 'background-color'));

  // The count reaches the taskbar through the window title.
  await expect(page).toHaveTitle('(1 aguardando) Agent Controller');
  expect(
    await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0]!.getTitle()),
  ).toBe('(1 aguardando) Agent Controller');

  // Once the agent is stopped, the emphasis is gone.
  await page.getByRole('button', { name: 'Parar' }).click();
  await expect(waiting).toHaveAttribute('data-state', 'parada');
  await expect(page).toHaveTitle('Agent Controller');
  expect(await style(waiting.locator('.session-state'), 'background-color')).toBe(transparent);
});

test('a flood of output does not freeze the interface', async () => {
  const { page } = await open();
  const id = await createSession(page, 'Enxurrada', work);
  const flood =
    process.platform === 'win32'
      ? 'for /L %i in (1,1,20000) do @echo linha-de-enxurrada-%i-xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx'
      : 'for i in $(seq 1 60000); do echo linha-de-enxurrada-$i-xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx; done';
  await page.locator('.terminal-host.visible').click();
  await page.keyboard.type(flood);
  await page.keyboard.press('Enter');

  // While it pours, the interface keeps answering.
  for (let i = 0; i < 5; i++) {
    const started = Date.now();
    await page.keyboard.press('Control+Shift+P');
    await expect(page.getByRole('dialog', { name: 'Paleta de comandos' })).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(page.getByRole('dialog')).toBeHidden();
    expect(Date.now() - started).toBeLessThan(3000);
  }
  const last =
    process.platform === 'win32' ? 'linha-de-enxurrada-20000-' : 'linha-de-enxurrada-60000-';
  await expect.poll(() => screenText(page, id), { timeout: 60_000 }).toContain(last);
});

test.describe('see changes', () => {
  let repo: string;
  test.beforeEach(() => {
    repo = makeRepo();
    repos.push(repo);
  });

  const changes = (page: Page) =>
    page
      .locator('.change-item')
      .evaluateAll((items) =>
        items
          .map((el) => `${(el as HTMLElement).dataset.kind} ${(el as HTMLElement).dataset.path}`)
          .sort(),
      );

  test('lists what changed, shows the diff and updates by itself', async () => {
    const { page } = await open();
    await createSession(page, 'Repo', repo);

    // What an agent would do: edit, create, delete, rename.
    fs.writeFileSync(
      path.join(repo, 'editado.ts'),
      'export const valor = 2;\nexport const novo = true;\n',
    );
    fs.writeFileSync(path.join(repo, 'criado.txt'), 'arquivo novo\n');
    fs.rmSync(path.join(repo, 'removido.txt'));
    git(repo, 'mv', 'velho.txt', 'renomeado.txt');
    fs.writeFileSync(path.join(repo, 'adicionado.txt'), 'no índice\n');
    git(repo, 'add', 'adicionado.txt');

    await page.getByRole('button', { name: /See changes/ }).click();
    const panel = page.getByRole('region', { name: 'Mudanças' });
    // Not `toBeVisible`: a narrow panel, as on a small screen, hides the tag to keep one line.
    await expect(panel.locator('.readonly-tag')).toHaveText('Editável');
    await expect(panel.locator('.changes-header .count')).toHaveText('5');
    await expect
      .poll(() => changes(page))
      .toEqual([
        'added adicionado.txt',
        'modified editado.ts',
        'removed removido.txt',
        'renamed renomeado.txt',
        'untracked criado.txt',
      ]);

    // The diff of the edited file has both versions.
    await panel.locator('.change-item[data-path="editado.ts"]').click();
    const editor = page.frameLocator('[data-testid="diff-frame"]');
    await expect(editor.locator('.editor.original')).toContainText('valor = 1');
    await expect(editor.locator('.editor.modified')).toContainText('valor = 2');
    await expect(editor.locator('.editor.modified')).toContainText('novo = true');

    // Inline mode.
    await panel.getByRole('button', { name: 'Lado a lado' }).click();
    await expect(panel.getByRole('button', { name: 'Em linha' })).toHaveAttribute(
      'aria-pressed',
      'true',
    );

    // Keyboard navigation in the list.
    await panel.getByRole('listbox', { name: 'Arquivos modificados' }).focus();
    await page.keyboard.press('Home');
    await expect(panel.locator('.change-item.selected')).toHaveAttribute(
      'data-path',
      'adicionado.txt',
    );
    await page.keyboard.press('ArrowDown');
    await expect(panel.locator('.change-item.selected')).toHaveAttribute('data-path', 'criado.txt');
    await expect(panel.locator('.diff-note')).toHaveText('Arquivo novo');

    // A new edit shows up without touching anything.
    fs.writeFileSync(path.join(repo, 'src', 'app.ts'), 'console.log("mudou sozinho");\n');
    await expect(panel.locator('.change-item[data-path="src/app.ts"]')).toBeVisible({
      timeout: 5000,
    });
    await expect(panel.locator('.changes-header .count')).toHaveText('6');
    // The selection was kept.
    await expect(panel.locator('.change-item.selected')).toHaveAttribute('data-path', 'criado.txt');

    // Looking at changes never changes the repository.
    expect(git(repo, 'stash', 'list')).toBe('');
    expect(git(repo, 'status', '--porcelain').split('\n').filter(Boolean)).toHaveLength(6);

    await page.keyboard.press('Escape');
    await expect(panel).toBeHidden();
    await expect(page.getByRole('button', { name: /See changes/ }).locator('.count')).toHaveText(
      '6',
    );
  });

  test('edits a file in the diff, saves it, and does not lose edits to a refresh', async () => {
    const { page } = await open();
    await createSession(page, 'Repo', repo);
    const file = path.join(repo, 'editado.ts');
    fs.writeFileSync(file, 'export const valor = 2;\n');

    await page.keyboard.press('Control+Shift+G');
    const panel = page.getByRole('region', { name: 'Mudanças' });
    await panel.locator('.change-item[data-path="editado.ts"]').click();
    const frame = page.frameLocator('[data-testid="diff-frame"]');
    await expect(frame.locator('.editor.modified')).toContainText('valor = 2');
    const save = panel.getByRole('button', { name: 'Salvar' });
    await expect(save).toBeDisabled();

    // Type at the top of the working-tree side.
    await frame.locator('.editor.modified .native-edit-context').first().focus();
    await page.keyboard.press('Control+Home');
    await page.keyboard.type('// revisado por mim');
    await page.keyboard.press('Enter');
    await expect(panel.getByText('Edições não salvas')).toBeVisible();
    await expect(save).toBeEnabled();
    expect(fs.readFileSync(file, 'utf8')).toBe('export const valor = 2;\n');

    // Ctrl+S inside the editor saves to the file, and nothing else in the repository moves.
    await page.keyboard.press('Control+s');
    await expect(panel.getByText('Edições não salvas')).toBeHidden();
    expect(fs.readFileSync(file, 'utf8')).toBe('// revisado por mim\nexport const valor = 2;\n');
    expect(git(repo, 'diff', '--cached', '--name-only')).toBe('');
    expect(git(repo, 'stash', 'list')).toBe('');

    // The left side is what git has: it cannot be typed into.
    await frame.locator('.editor.original .native-edit-context').first().focus();
    await page.keyboard.type('zzz');
    await expect(frame.locator('.editor.original')).not.toContainText('zzz');

    // The agent writes to the file while there are unsaved edits: nothing is overwritten.
    await frame.locator('.editor.modified .native-edit-context').first().focus();
    await page.keyboard.press('Control+End');
    await page.keyboard.type('// minha segunda edicao');
    await expect(save).toBeEnabled();
    fs.writeFileSync(file, 'export const valor = 99; // do agente\n');
    await page.waitForTimeout(1500);
    await expect(frame.locator('.editor.modified')).toContainText('minha segunda edicao');
    await save.click();
    await expect(panel.getByRole('alert')).toContainText('O arquivo mudou no disco');
    expect(fs.readFileSync(file, 'utf8')).toBe('export const valor = 99; // do agente\n');

    // Reloading takes the agent's version; the edit is gone because the user said so.
    await panel.getByRole('button', { name: 'Recarregar do disco' }).click();
    await expect(frame.locator('.editor.modified')).toContainText('do agente');
    await expect(frame.locator('.editor.modified')).not.toContainText('minha segunda edicao');
    await expect(panel.getByRole('alert')).toHaveCount(0);
    await expect(save).toBeDisabled();
  });

  test('compares with the start of the session', async () => {
    const { page } = await open();
    // Dirty before the session starts.
    fs.writeFileSync(path.join(repo, 'editado.ts'), 'export const valor = 99;\n');
    await createSession(page, 'Repo', repo);
    // The snapshot is taken when the session starts; give it a moment.
    await page.waitForTimeout(1500);
    fs.writeFileSync(path.join(repo, 'do-agente.txt'), 'feito depois\n');

    await page.keyboard.press('Control+Shift+G');
    const panel = page.getByRole('region', { name: 'Mudanças' });
    await expect
      .poll(() => changes(page))
      .toEqual(['modified editado.ts', 'untracked do-agente.txt']);
    await panel.getByLabel('Comparar com').selectOption('session');
    await expect.poll(() => changes(page)).toEqual(['added do-agente.txt']);
    expect(git(repo, 'stash', 'list')).toBe('');
  });

  test('opens from the command palette and explains a folder without git', async () => {
    const { page } = await open();
    await createSession(page, 'Sem git', work);
    await page.keyboard.press('Control+Shift+P');
    const palette = page.getByRole('dialog', { name: 'Paleta de comandos' });
    await palette.getByLabel('Comando').fill('see changes');
    await page.keyboard.press('Enter');
    const panel = page.getByRole('region', { name: 'Mudanças' });
    await expect(panel).toContainText('Esta pasta não é um repositório git');
    await expect(panel).toContainText('git init');
    // With nothing to list, Esc still closes the panel instead of going to the terminal.
    await page.keyboard.press('Escape');
    await expect(panel).toBeHidden();
  });

  test('a clean repository says there is nothing to show', async () => {
    const { page } = await open();
    await createSession(page, 'Limpo', repo);
    await page.keyboard.press('Control+Shift+G');
    await expect(page.getByRole('region', { name: 'Mudanças' })).toContainText('Nenhuma mudança');
  });
});
