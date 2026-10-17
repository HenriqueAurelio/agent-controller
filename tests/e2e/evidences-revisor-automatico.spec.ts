// The screens of the automatic reviewer, to attach to the pull request, as in `evidences.spec.ts`:
//
//   EVIDENCES=1 npx playwright test --config tests/e2e/playwright.config.ts evidences-revisor-automatico.spec.ts
//
// `EVIDENCES_PHASE=antes`, run on a build of the code as it was, takes the "before" of each pair:
// there was no reviewer, so each "before" is the screen the feature starts from.
import fs from 'node:fs';
import path from 'node:path';
import { expect, test, type Page } from '@playwright/test';
import {
  createSession,
  git,
  launch,
  removeDir,
  ROOT,
  screenText,
  setTitle,
  tempDir,
} from './harness';

const PHASE = process.env.EVIDENCES_PHASE === 'antes' ? 'antes' : 'depois';
const AFTER = PHASE === 'depois';
const OUT = process.env.EVIDENCES_DIR || path.join(ROOT, 'evidences', 'images');
const FOLDER = 'revisor';

test.skip(process.env.EVIDENCES !== '1', 'só com EVIDENCES=1');

const row = (page: Page, id: string) => page.locator(`.session-item[data-session-id="${id}"]`);

const REVIEW = [
  '- src/pagamentos/cobrar.ts:18 — O valor chega como string e é somado sem conversão: "10" + "5" vira "105".',
  '- src/pagamentos/cobrar.ts:31 — Falta tratar o erro de rede; a promessa rejeitada derruba o servidor.',
  '- src/pagamentos/estorno.ts — Nenhum teste cobre o estorno parcial.',
  '- O nome "cobrar" mistura português e inglês com "chargeId"; vale escolher um dos dois.',
].join('\n');

test('evidences: the automatic reviewer', async () => {
  test.setTimeout(240_000);
  const userData = tempDir('ac-evid-data-');
  // A short, stable path: it is in the pictures.
  const base = tempDir('ac-');
  const repo = path.join(base, 'loja');
  fs.mkdirSync(path.join(repo, 'src', 'pagamentos'), { recursive: true });
  git(repo, 'init', '-q', '-b', 'main');
  git(repo, 'config', 'user.email', 'e2e@example.com');
  git(repo, 'config', 'user.name', 'E2E');
  git(repo, 'config', 'commit.gpgsign', 'false');
  git(repo, 'config', 'core.autocrlf', 'false');
  fs.writeFileSync(path.join(repo, 'README.md'), '# Loja\n');
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
  const sendPromptDialog = async () => {
    await page.keyboard.press('Control+Shift+P');
    await page
      .getByRole('dialog', { name: 'Paleta de comandos' })
      .getByRole('option', { name: 'Prompt: Revisar o diff' })
      .click();
  };
  try {
    // A working agent would not turn "possibly waiting" in the middle of a picture.
    await page.evaluate(() => window.api.invoke('prefs:set', { silenceSeconds: 600 }));
    const main = await createSession(page, 'api-pagamentos', repo);
    await page.waitForTimeout(800);
    await page.locator('.terminal-host.visible').click();
    if (process.platform === 'win32') {
      await page.keyboard.type('prompt $G$S');
      await page.keyboard.press('Enter');
    }
    // The photo of the folder as the session found it runs in the background.
    await page.waitForTimeout(3000);

    // 01: where the reviewer is chosen. Before: the header of the session, with nothing for it.
    if (AFTER) {
      await page.getByTestId('reviewer-button').click();
      await expect(page.getByTestId('reviewer-dialog')).toBeVisible();
    }
    await shot('01-ligar-revisor');
    if (AFTER) {
      const dialog = page.getByRole('dialog', { name: 'Revisor de “api-pagamentos”' });
      await dialog.getByTestId('reviewer-enable').click();
      await expect(dialog.getByTestId('reviewer-current')).toBeVisible();
      await dialog.getByRole('button', { name: 'Fechar' }).click();
    }

    // A turn that changes files and ends; then the agent says what it did.
    await setTitle(page, '◐ pagamentos');
    await expect(row(page, main)).toHaveAttribute('data-state', 'trabalhando', { timeout: 15_000 });
    fs.writeFileSync(
      path.join(repo, 'src', 'pagamentos', 'cobrar.ts'),
      'export function cobrar(valor: string, extra: string) {\n  return valor + extra;\n}\n',
    );
    fs.writeFileSync(
      path.join(repo, 'src', 'pagamentos', 'estorno.ts'),
      'export const estornar = (id: string) => `estorno:${id}`;\n',
    );
    await setTitle(page, '✳ pronto');
    await expect(row(page, main)).toHaveAttribute('data-state', 'terminou', { timeout: 15_000 });
    const clear = process.platform === 'win32' ? 'cls' : 'clear';
    await page.keyboard.type(
      `${clear} && echo Criei cobrar e estornar em src/pagamentos. && echo Verificacoes: lint e testes passaram.`,
    );
    await page.keyboard.press('Enter');
    await expect.poll(() => screenText(page, main)).toContain('testes passaram');

    // 02: the turn is over. After: the reviewer got the diff and the main session says the
    // review is ready (🔍 in the list, "Revisão pronta (4)" on top).
    if (AFTER) {
      const handoff = path.join(userData, 'handoffs', main);
      await expect
        .poll(() => fs.existsSync(path.join(handoff, 'diff.patch')), { timeout: 60_000 })
        .toBe(true);
      await expect(row(page, main).getByTestId('review-badge')).toBeVisible({ timeout: 30_000 });
      fs.writeFileSync(path.join(handoff, 'revisao.md'), REVIEW);
      await expect(page.getByTestId('reviewer-button')).toHaveText('Revisão pronta (4)', {
        timeout: 30_000,
      });
    } else {
      await page.waitForTimeout(3000);
    }
    await shot('02-revisao-pronta');

    // 03: the observations, two of them marked. Before: nowhere to see them; the user would read
    // the terminal of another session.
    if (AFTER) {
      await page.getByTestId('reviewer-button').click();
      const dialog = page.getByRole('dialog', { name: 'Revisor de “api-pagamentos”' });
      await expect(dialog.getByTestId('review-item')).toHaveCount(4);
      await dialog.getByTestId('review-item').nth(0).check();
      await dialog.getByTestId('review-item').nth(1).check();
      await shot('03-observacoes');
      // 04: giving them back, through the dialog of sending that exists.
      await dialog.getByTestId('reviewer-return').click();
      const send = page.getByRole('dialog', { name: 'Enviar prompt' });
      await expect(send.getByLabel('Texto a enviar')).toHaveValue(/cobrar\.ts:31/);
      await shot('04-devolver-ao-agente');
      await page.keyboard.press('Escape');
    } else {
      await shot('03-observacoes');
      await sendPromptDialog();
      await expect(page.getByRole('dialog', { name: 'Enviar prompt' })).toBeVisible();
      await shot('04-devolver-ao-agente');
      await page.keyboard.press('Escape');
    }
  } finally {
    await running.close();
    removeDir(userData);
    removeDir(base);
  }
});
