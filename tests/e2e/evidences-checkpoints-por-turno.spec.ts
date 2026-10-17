// The screens of the checkpoints per turn, to attach to the pull request, as in `evidences.spec.ts`:
//
//   EVIDENCES=1 npx playwright test --config tests/e2e/playwright.config.ts evidences-checkpoints-por-turno.spec.ts
//
// `EVIDENCES_PHASE=antes`, run on a build of the code as it was, takes the "before" of each pair:
// there were no checkpoints, so each picture is the same screen as it was then.
import fs from 'node:fs';
import path from 'node:path';
import { expect, test, type Page } from '@playwright/test';
import { createSession, git, launch, removeDir, ROOT, setTitle, tempDir } from './harness';

const PHASE = process.env.EVIDENCES_PHASE === 'antes' ? 'antes' : 'depois';
const AFTER = PHASE === 'depois';
const OUT = process.env.EVIDENCES_DIR || path.join(ROOT, 'evidences', 'images');
const FOLDER = 'checkpoints-por-turno';

test.skip(process.env.EVIDENCES !== '1', 'só com EVIDENCES=1');

const row = (page: Page, id: string) => page.locator(`.session-item[data-session-id="${id}"]`);

test('evidences: checkpoints per turn', async () => {
  test.setTimeout(240_000);
  const userData = tempDir('ac-evid-data-');
  // A short, stable path: it is in the pictures.
  const base = tempDir('ac-');
  const repo = path.join(base, 'loja');
  fs.mkdirSync(repo);
  git(repo, 'init', '-q', '-b', 'main');
  git(repo, 'config', 'user.email', 'e2e@example.com');
  git(repo, 'config', 'user.name', 'E2E');
  git(repo, 'config', 'commit.gpgsign', 'false');
  git(repo, 'config', 'core.autocrlf', 'false');
  const write = (file: string, text: string) => {
    fs.mkdirSync(path.dirname(path.join(repo, file)), { recursive: true });
    fs.writeFileSync(path.join(repo, file), text);
  };
  write('src/preco.ts', 'export const preco = (valor: number) => valor;\n');
  write('README.md', '# Loja\n');
  git(repo, 'add', '-A');
  git(repo, 'commit', '-q', '-m', 'base');

  const running = await launch(userData);
  const { page } = running;
  page.on('dialog', (dialog) => void dialog.accept());
  const shot = async (name: string) => {
    fs.mkdirSync(path.join(OUT, FOLDER), { recursive: true });
    await page.waitForTimeout(700);
    await page.screenshot({ path: path.join(OUT, FOLDER, `${name}-${PHASE}.png`) });
  };
  const turn = async (n: number, files: Record<string, string>) => {
    await setTitle(page, `◐ turno ${n}`);
    await expect(row(page, id)).toHaveAttribute('data-state', 'trabalhando', { timeout: 15_000 });
    for (const [file, text] of Object.entries(files)) write(file, text);
    await setTitle(page, '✳ pronto');
    await expect(row(page, id)).toHaveAttribute('data-state', 'terminou', { timeout: 15_000 });
    if (AFTER) {
      await expect(page.locator('.timeline-button .count')).toHaveText(String(n + 1), {
        timeout: 15_000,
      });
    } else await page.waitForTimeout(1500);
  };

  const id = await createSession(page, 'Loja', repo);
  // The photo of the start is taken in the background when the session starts.
  await page.waitForTimeout(3000);
  try {
    await turn(1, {
      'src/preco.ts': 'export const preco = (valor: number) => Math.round(valor * 100) / 100;\n',
      'src/preco.test.ts': "import { preco } from './preco';\n\ntest('arredonda', () => {});\n",
    });
    await turn(2, { 'src/desconto.ts': 'export const desconto = (v: number) => v * 0.9;\n' });
    await turn(3, {
      'src/preco.ts':
        '// o agente apagou o arredondamento\nexport const preco = (v: number) => v;\n',
      'README.md': '# Loja\n\nDescontos de 10%.\n',
    });
    await page.locator('.terminal-host.visible').click();
    await page.keyboard.type('cls');
    await page.keyboard.press('Enter');

    // 01: the panel. Before: only the last commit (or the start). After: only the last turn.
    await page.keyboard.press('Control+Shift+G');
    const panel = page.getByRole('region', { name: 'Mudanças' });
    await expect(panel.locator('.change-item').first()).toBeVisible();
    if (AFTER) {
      await panel.getByLabel('Comparar com').selectOption({ label: 'O turno anterior' });
      await expect(panel.locator('.change-item')).toHaveCount(2);
    }
    await panel.locator('.change-item[data-path="src/preco.ts"]').click();
    await shot('01-o-que-o-ultimo-turno-mudou');

    // 02: the timeline. Before: the same session, with no such button.
    await panel.getByLabel('Comparar com').selectOption({ index: 0 });
    await page.keyboard.press('Escape');
    if (AFTER) await page.locator('.timeline-button').click();
    await shot('02-linha-do-tempo');

    // 03: going back to turn 2. Before: the closest there was, the panel against the start.
    if (AFTER) {
      const timeline = page.getByRole('dialog', { name: 'Linha do tempo de “Loja”' });
      await timeline.getByRole('button', { name: 'Voltar a Turno 2' }).click();
      await expect(timeline.getByTestId('timeline-restored')).toBeVisible();
    } else {
      await page.keyboard.press('Control+Shift+G');
      await panel.getByLabel('Comparar com').selectOption({ label: 'Início da sessão' });
      await expect(panel.locator('.change-item').first()).toBeVisible();
    }
    await shot('03-voltar-a-um-turno');
    if (AFTER) {
      const timeline = page.getByRole('dialog', { name: 'Linha do tempo de “Loja”' });
      await timeline.getByRole('button', { name: 'Desfazer' }).click();
      await expect(timeline.getByRole('status')).toHaveText('A volta foi desfeita.');
      await timeline.getByRole('button', { name: 'Fechar' }).click();
    } else {
      await page.keyboard.press('Escape');
    }

    // 04: Preferences → Sessions.
    await page.locator('button[title^="Preferências"]').click();
    const prefs = page.getByRole('dialog', { name: 'Preferências' });
    await prefs.getByRole('tab', { name: 'Sessões' }).click();
    if (AFTER) await expect(prefs.locator('.checkpoints-settings .worktree-copy')).toHaveCount(1);
    // The end of the tab, where the checkpoints are (after: their settings; before: nothing).
    await prefs.evaluate((dialog) => {
      for (const el of [dialog, ...dialog.querySelectorAll('.tab-panel')]) {
        el.scrollTo(0, el.scrollHeight);
      }
    });
    await shot('04-preferencias-sessoes');
    await page.keyboard.press('Escape');

    // 05: closing the session.
    await page.keyboard.press('Control+Shift+P');
    await page
      .getByRole('dialog', { name: 'Paleta de comandos' })
      .getByRole('option', { name: 'Fechar a sessão “Loja”' })
      .click();
    await expect(page.getByRole('dialog', { name: 'Fechar sessão' })).toBeVisible();
    await shot('05-fechar-a-sessao');
    await page
      .getByRole('dialog', { name: 'Fechar sessão' })
      .getByRole('button', { name: 'Cancelar' })
      .click();
  } finally {
    await running.close();
    removeDir(userData);
    removeDir(base);
  }
});
