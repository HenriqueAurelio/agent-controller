// The screens of the chained sessions, to attach to the pull request, as in `evidences.spec.ts`:
//
//   EVIDENCES=1 npx playwright test --config tests/e2e/playwright.config.ts evidences-encadear-sessoes.spec.ts
//
// `EVIDENCES_PHASE=antes`, run on a build of the code as it was, takes the "before" of each pair:
// there were no flows, so each "before" is the screen the feature starts from.
import fs from 'node:fs';
import path from 'node:path';
import { expect, test, type Page } from '@playwright/test';
import { createSession, git, launch, removeDir, ROOT, setTitle, tempDir } from './harness';

const PHASE = process.env.EVIDENCES_PHASE === 'antes' ? 'antes' : 'depois';
const AFTER = PHASE === 'depois';
const OUT = process.env.EVIDENCES_DIR || path.join(ROOT, 'evidences', 'images');
const FOLDER = 'encadear-sessoes';

test.skip(process.env.EVIDENCES !== '1', 'só com EVIDENCES=1');

const row = (page: Page, id: string) => page.locator(`.session-item[data-session-id="${id}"]`);

async function idle(page: Page, id: string) {
  await row(page, id).click();
  if (process.platform === 'win32') {
    await page.keyboard.type('prompt $G$S');
    await page.keyboard.press('Enter');
  }
  await setTitle(page, '◐ x');
  await expect(row(page, id)).toHaveAttribute('data-state', 'trabalhando', { timeout: 15_000 });
  await setTitle(page, '✳ pronto');
  await expect(row(page, id)).toHaveAttribute('data-state', 'terminou', { timeout: 15_000 });
}

test('evidences: chained sessions', async () => {
  test.setTimeout(240_000);
  const userData = tempDir('ac-evid-data-');
  const base = tempDir('ac-');
  const repo = path.join(base, 'loja');
  fs.mkdirSync(repo, { recursive: true });
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
  try {
    await page.evaluate(() => window.api.invoke('prefs:set', { silenceSeconds: 600 }));
    const plan = await createSession(page, 'planejar', repo);
    const build = await createSession(page, 'implementar', repo);
    const review = await createSession(page, 'revisar', repo);
    for (const id of [plan, build, review]) await idle(page, id);
    const groupId = await page.evaluate(
      async (ids) => (await window.api.invoke('groups:create', 'Funcionalidade: cobrança', ids)).id,
      [plan, build, review],
    );
    await row(page, plan).click();
    await page.waitForTimeout(3000);
    const header = page.locator(`.session-group[data-group-id="${groupId}"] .group-header`);

    // 01: where the rules are written. Before: the header of the group has no "Fluxo".
    const dialog = page.getByRole('dialog', { name: 'Fluxo de “Funcionalidade: cobrança”' });
    if (AFTER) {
      await header.hover();
      await page.getByTestId('flow-button').click();
      await dialog.getByTestId('flow-template-plan').click();
      await expect(dialog.getByTestId('flow-rule')).toHaveCount(3);
    }
    await shot('01-regras');
    if (AFTER) {
      await dialog.getByTestId('flow-save').click();
      await expect(dialog.getByTestId('flow-status')).toContainText('ligado');
      await dialog.getByRole('button', { name: 'Fechar' }).click();
    }

    // 02: the planner wrote its plan. After: the send is ready and waits for a click.
    if (AFTER) {
      const out = path.join(userData, 'handoffs', plan);
      fs.mkdirSync(out, { recursive: true });
      fs.writeFileSync(path.join(out, 'revisao.md'), '1. Criar src/cobranca.ts\n2. Testar\n');
      await expect(row(page, plan).getByTestId('flow-pending-badge')).toBeVisible({
        timeout: 30_000,
      });
    }
    await shot('02-envio-preparado');

    // 03: the cycle of review and fix reaches its limit. After: the flow stops and says why.
    if (AFTER) {
      await page.evaluate(
        async ([group, b, c]) => {
          const rule = (id: string, from: string, when: string, to: string, prompt: string) => ({
            id,
            from,
            when,
            to,
            prompt,
            confirm: false,
            maxRounds: 1,
          });
          await window.api.invoke('flows:set', group!, [
            rule('r1', b!, 'turnEnded', c!, 'Revise o diff do turno e anote o que achar.'),
            rule('r2', c!, 'turnEnded', b!, 'Corrija o que a revisão apontou.'),
          ]);
        },
        [groupId, build, review] as const,
      );
      for (const id of [build, review, build]) {
        await row(page, id).click();
        await setTitle(page, '◐ turno');
        await expect(row(page, id)).toHaveAttribute('data-state', 'trabalhando', {
          timeout: 15_000,
        });
        await setTitle(page, '✳ pronto');
        await expect(row(page, id)).toHaveAttribute('data-state', 'terminou', { timeout: 15_000 });
        await page.waitForTimeout(1500);
      }
      await expect(page.getByTestId('flow-pause-button')).toHaveAttribute('aria-label', /Retomar/, {
        timeout: 30_000,
      });
      await header.hover();
      await page.getByTestId('flow-button').click();
      await expect(dialog.getByTestId('flow-status')).toContainText('limite de voltas');
    }
    await shot('03-limite-de-voltas');

    // 04: what the flow did, from the top of the history. Before: nothing keeps that record.
    if (AFTER) await dialog.getByTestId('flow-history').scrollIntoViewIfNeeded();
    await shot('04-historico');
  } finally {
    await running.close();
    removeDir(userData);
    removeDir(base);
  }
});
