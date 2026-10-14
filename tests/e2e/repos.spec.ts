// The changes panel when the folder of the session holds more than one repository, and the
// proof that a single repository looks as it always did.
//
// With EVIDENCES=1 the screens are also saved to evidences/images, to attach to the pull request.
import fs from 'node:fs';
import path from 'node:path';
import { expect, test, type Page } from '@playwright/test';
import { createSession, git, launch, removeDir, ROOT, tempDir, type RunningApp } from './harness';

let userData: string;
let parent: string;
let running: RunningApp | null = null;

test.beforeEach(() => {
  userData = tempDir('ac-e2e-data-');
  parent = tempDir('ac-e2e-repos-');
});
test.afterEach(async () => {
  await running?.close();
  running = null;
  for (const dir of [userData, parent]) removeDir(dir);
});

const open = async () => (running = await launch(userData));

function write(file: string, content: string): void {
  fs.mkdirSync(path.dirname(path.join(parent, file)), { recursive: true });
  fs.writeFileSync(path.join(parent, file), content);
}

/** A repository at `dir` (relative to the test folder), with a couple of committed files. */
function repository(dir: string, branch = 'main'): string {
  const root = path.join(parent, dir);
  fs.mkdirSync(root, { recursive: true });
  git(root, 'init', '-q', '-b', branch);
  git(root, 'config', 'user.email', 'e2e@example.com');
  git(root, 'config', 'user.name', 'E2E');
  git(root, 'config', 'commit.gpgsign', 'false');
  git(root, 'config', 'core.autocrlf', 'false');
  write(
    `${dir}/index.ts`,
    `export const nome = '${path.basename(dir)}';\nexport const versao = 1;\n`,
  );
  write(`${dir}/src/rotas.ts`, 'export const rotas = [];\n');
  git(root, 'add', '-A');
  git(root, 'commit', '-q', '-m', 'base');
  return root;
}

async function evidence(page: Page, name: string): Promise<void> {
  if (!process.env.EVIDENCES) return;
  // The editor paints a little after its content arrives.
  await page.waitForTimeout(800);
  const dir = path.join(ROOT, 'evidences', 'images');
  fs.mkdirSync(dir, { recursive: true });
  await page.screenshot({ path: path.join(dir, `${name}.png`) });
}

const listed = (page: Page) =>
  page
    .locator('.changes-list')
    .locator('.changes-repo, .change-item')
    .evaluateAll((items) =>
      items.map((el) => {
        const data = (el as HTMLElement).dataset;
        return data.repo !== undefined ? `# ${data.repo || '.'}` : `${data.kind} ${data.path}`;
      }),
    );

test('one repository: the panel is what it always was', async () => {
  const repo = repository('loja-api');
  const { page } = await open();
  await createSession(page, 'Um repositório', repo);
  write('loja-api/index.ts', "export const nome = 'loja-api';\nexport const versao = 2;\n");
  write('loja-api/src/pedidos.ts', 'export const pedidos = [];\n');
  write('loja-api/LEIAME.md', '# Loja\n');

  // The counter of the button is read when the state of the agent changes, which a plain
  // shell never does on Linux; opening the panel reads it for sure.
  const button = page.getByRole('button', { name: /Ver mudanças/ });
  await button.click();
  await expect(button.locator('.count')).toHaveText('3');
  const panel = page.getByRole('region', { name: 'Mudanças' });
  // Folders only: no repository headers, no line about untouched repositories.
  await expect
    .poll(() => listed(page))
    .toEqual(['modified index.ts', 'untracked LEIAME.md', 'untracked src/pedidos.ts']);
  await expect(panel.locator('.changes-folder')).toHaveText(['(raiz)', 'src']);
  await expect(panel.locator('.changes-repo')).toHaveCount(0);
  await expect(panel.locator('.changes-untouched')).toHaveCount(0);
  // Neither in the tree of all files.
  await page.keyboard.press('Control+Shift+E');
  await expect(panel.locator('.file-item[data-path="src"]')).toBeVisible();
  await expect(panel.locator('.repo-row, .changes-repo')).toHaveCount(0);
  await page.keyboard.press('Control+Shift+G');

  await panel.locator('.change-item[data-path="index.ts"]').click();
  const editor = page.frameLocator('[data-testid="diff-frame"]');
  await expect(editor.locator('.editor.original')).toContainText('versao = 1');
  await expect(editor.locator('.editor.modified')).toContainText('versao = 2');
  await evidence(page, '01-um-repositorio');
});

test('repositories side by side: every change, under its own repository', async () => {
  const api = repository('loja/api');
  repository('loja/web', 'develop');
  repository('loja/docs');
  const { page } = await open();
  await createSession(page, 'Vários repositórios', path.join(parent, 'loja'));

  // The agent works on two of the three.
  write('loja/api/index.ts', "export const nome = 'api';\nexport const versao = 2;\n");
  write('loja/api/src/pedidos.ts', 'export const pedidos = [];\n');
  write('loja/web/src/rotas.ts', "export const rotas = ['/pedidos'];\n");

  // The counter of the button adds them up.
  const button = page.getByRole('button', { name: /Ver mudanças/ });
  await button.click();
  await expect(button.locator('.count')).toHaveText('3');
  const panel = page.getByRole('region', { name: 'Mudanças' });
  await expect(panel.locator('.changes-header .count')).toHaveText('3');
  await expect
    .poll(() => listed(page))
    .toEqual([
      '# api',
      'modified api/index.ts',
      'untracked api/src/pedidos.ts',
      '# web',
      'modified web/src/rotas.ts',
    ]);
  await expect(panel.locator('.changes-repo[data-repo="api"]')).toContainText('main');
  await expect(panel.locator('.changes-repo[data-repo="api"] .count')).toHaveText('2');
  await expect(panel.locator('.changes-repo[data-repo="web"]')).toContainText('develop');
  await expect(panel.locator('.changes-untouched')).toHaveText('Sem mudanças: docs');

  // The diff is against the commit of the repository the file is in.
  await panel.locator('.change-item[data-path="web/src/rotas.ts"]').click();
  const editor = page.frameLocator('[data-testid="diff-frame"]');
  await editor.locator('body[data-path="web/src/rotas.ts"]').waitFor();
  await expect(editor.locator('.editor.original')).toContainText('rotas = []');
  await expect(editor.locator('.editor.modified')).toContainText("rotas = ['/pedidos']");
  await evidence(page, '02-varios-repositorios');

  // The arrow keys cross from one repository to the next.
  await panel.getByRole('listbox', { name: 'Arquivos modificados' }).focus();
  await page.keyboard.press('Home');
  await expect(panel.locator('.change-item.selected')).toHaveAttribute('data-path', 'api/index.ts');
  await page.keyboard.press('End');
  await expect(panel.locator('.change-item.selected')).toHaveAttribute(
    'data-path',
    'web/src/rotas.ts',
  );

  // A change in the repository that was clean shows up by itself.
  write('loja/docs/index.ts', '// documentado\n');
  await expect(panel.locator('.change-item[data-path="docs/index.ts"]')).toBeVisible({
    timeout: 5000,
  });
  await expect(panel.locator('.changes-untouched')).toHaveCount(0);

  // Editing and saving goes to the right repository.
  await panel.locator('.change-item[data-path="api/index.ts"]').click();
  await editor.locator('body[data-path="api/index.ts"]').waitFor();
  await editor
    .locator('.editor.modified')
    .locator('.native-edit-context, textarea.inputarea')
    .first()
    .focus();
  await page.keyboard.press('Control+End');
  await page.keyboard.type('// revisado');
  await expect(panel.getByText('Edições não salvas')).toBeVisible();
  await page.keyboard.press('Control+s');
  await expect(panel.getByText('Edições não salvas')).toBeHidden();
  expect(fs.readFileSync(path.join(api, 'index.ts'), 'utf8')).toContain('// revisado');

  // All files: the tree starts at the folder, with the same marks.
  await page.keyboard.press('Control+Shift+E');
  await panel.locator('.file-item[data-path="api"]').click();
  await panel.locator('.file-item[data-path="api/src"]').click();
  await expect(panel.locator('.file-item[data-path="api/index.ts"] .change-kind')).toHaveText('M');
  await expect(panel.locator('.file-item[data-path="api/src/pedidos.ts"] .change-kind')).toHaveText(
    'U',
  );
  // The folder of each repository is a band of its own, with the branch and the count.
  await expect(panel.locator('.file-item.repo-row')).toHaveCount(3);
  await expect(panel.locator('.file-item.repo-row[data-path="api"]')).toContainText('main');
  await expect(panel.locator('.file-item.repo-row[data-path="api"] .count')).toHaveText('2');
  await expect(panel.locator('.file-item.repo-row[data-path="web"]')).toContainText('develop');
  await expect(panel.locator('.file-item[data-path="api/src"]')).not.toHaveClass(/repo-row/);
  await panel.locator('.file-item[data-path="web"]').click();
  await panel.locator('.file-item[data-path="api/src/rotas.ts"]').click();
  await editor.locator('body[data-path="api/src/rotas.ts"]').waitFor();
  await evidence(page, '03-varios-repositorios-todos-os-arquivos');

  // Nothing was done to any of the repositories.
  for (const dir of ['api', 'web', 'docs']) {
    expect(git(path.join(parent, 'loja', dir), 'stash', 'list')).toBe('');
  }
  expect(git(path.join(parent, 'loja', 'web'), 'status', '--porcelain').trim()).toBe(
    'M src/rotas.ts',
  );
});

test('repositories side by side with nothing changed say so', async () => {
  repository('loja/api');
  repository('loja/web');
  const { page } = await open();
  await createSession(page, 'Sem mudanças', path.join(parent, 'loja'));
  await page.keyboard.press('Control+Shift+G');
  const panel = page.getByRole('region', { name: 'Mudanças' });
  await expect(panel.getByText('Nenhuma mudança')).toBeVisible();
  await expect(panel).toContainText('Os 2 repositórios da pasta estão iguais ao último commit');
  await evidence(page, '05-varios-repositorios-sem-mudancas');
});

test('a repository inside another: the changes of both, not one untracked folder', async () => {
  const outer = repository('plataforma');
  repository('plataforma/libs/pagamentos', 'feature/pix');
  const { page } = await open();
  await createSession(page, 'Repositório dentro de outro', outer);

  write('plataforma/index.ts', "export const nome = 'plataforma';\nexport const versao = 2;\n");
  write(
    'plataforma/libs/pagamentos/index.ts',
    "export const nome = 'pagamentos';\nexport const versao = 7;\n",
  );
  write('plataforma/libs/pagamentos/src/pix.ts', 'export const pix = true;\n');

  await page.keyboard.press('Control+Shift+G');
  const panel = page.getByRole('region', { name: 'Mudanças' });
  await expect
    .poll(() => listed(page))
    .toEqual([
      '# .',
      'modified index.ts',
      '# libs/pagamentos',
      'modified libs/pagamentos/index.ts',
      'untracked libs/pagamentos/src/pix.ts',
    ]);
  await expect(panel.locator('.changes-repo[data-repo="libs/pagamentos"]')).toContainText(
    'feature/pix',
  );
  await expect(page.getByRole('button', { name: /Ver mudanças/ }).locator('.count')).toHaveText(
    '3',
  );

  await panel.locator('.change-item[data-path="libs/pagamentos/index.ts"]').click();
  const editor = page.frameLocator('[data-testid="diff-frame"]');
  await editor.locator('body[data-path="libs/pagamentos/index.ts"]').waitFor();
  await expect(editor.locator('.editor.original')).toContainText('versao = 1');
  await expect(editor.locator('.editor.modified')).toContainText('versao = 7');
  await evidence(page, '04-repositorio-dentro-de-outro');

  // All files: the outer repository heads the tree, the inner one is a band inside it.
  await page.keyboard.press('Control+Shift+E');
  await expect(panel.locator('.file-tree > .changes-repo')).toContainText('plataforma');
  await panel.locator('.file-item[data-path="libs"]').click();
  const inner = panel.locator('.file-item.repo-row[data-path="libs/pagamentos"]');
  await expect(inner).toContainText('feature/pix');
  await expect(inner.locator('.count')).toHaveText('2');
  await inner.click();
  await panel.locator('.file-item[data-path="libs/pagamentos/index.ts"]').click();
  await editor.locator('body[data-path="libs/pagamentos/index.ts"]').waitFor();
  // Where the inner repository ends, the tree marks the way back to the outer one.
  await expect(panel.locator('.file-item.after-repo')).toHaveAttribute('data-path', 'src');
  await evidence(page, '06-repositorio-dentro-de-outro-todos-os-arquivos');
});
