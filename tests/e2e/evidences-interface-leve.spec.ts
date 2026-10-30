// The terminal drawn without WebGL, and the dot of a waiting session that stops pulsing,
// photographed before and after, with what each one costs. It only runs when asked:
//
//   EVIDENCES=1 npx playwright test --config tests/e2e/playwright.config.ts evidences-interface-leve.spec.ts
//
// `EVIDENCES_PHASE=antes`, run on a build of the code as it was, takes the "before" of each pair.
import fs from 'node:fs';
import path from 'node:path';
import { expect, test } from '@playwright/test';
import { createSession, launch, removeDir, ROOT, runInTerminal, tempDir } from './harness';

const PHASE = process.env.EVIDENCES_PHASE === 'antes' ? 'antes' : 'depois';
const OUT = path.join(
  process.env.EVIDENCES_DIR || path.join(ROOT, 'evidences', 'images'),
  'interface-leve',
);

test.skip(process.env.EVIDENCES !== '1', 'só com EVIDENCES=1');

test('evidences: a lighter interface', async () => {
  test.setTimeout(120_000);
  const userData = tempDir('ac-evid-data-');
  const work = tempDir('ac-');
  // Colours, bold, box drawing and wide characters: what a renderer can get wrong.
  fs.writeFileSync(
    path.join(work, 'cores.cjs'),
    [
      'const c = (n, s) => `\\x1b[${n}m${s}\\x1b[0m`;',
      "console.log(c('1;36', '╭─ Agente ───────────────────────╮'));",
      "console.log(c('1;36', '│') + ' ' + c(32, '✓ testes passaram') + '  ' + c(33, '⠋ pensando…') + '    ' + c('1;36', '│'));",
      "console.log(c('1;36', '╰────────────────────────────────╯'));",
      "for (let i = 0; i < 8; i++) console.log(c(31 + (i % 6), '●') + ' ' + c(1, 'linha ' + i) + ' ação, edição, 日本語');",
    ].join('\n'),
  );
  // The title an agent shows when it is at its prompt, waiting.
  fs.writeFileSync(
    path.join(work, 'pronto.cjs'),
    `process.stdout.write('\\x1b]0;✳ agente\\x07'); setInterval(() => {}, 1000);`,
  );
  const running = await launch(userData);
  const { page, app } = running;
  fs.mkdirSync(OUT, { recursive: true });
  const shot = async (name: string) => {
    await page.waitForTimeout(700);
    await page.screenshot({ path: path.join(OUT, `${name}-${PHASE}.png`) });
  };

  try {
    const id = await createSession(page, 'Agente', work);
    await runInTerminal(page, id, 'node cores.cjs', 'linha 7');
    await shot('01-terminal');

    await page.keyboard.type('node pronto.cjs');
    await page.keyboard.press('Enter');
    const item = page.locator('.session-item', { hasText: 'Agente' });
    await expect(item).toHaveAttribute('data-state', 'aguardando', { timeout: 15_000 });
    // Longer than three pulses of 1.6 s.
    await page.waitForTimeout(6000);
    const dot = await page.evaluate(() => {
      const element = document.querySelector('.session-item .state-dot')!;
      return {
        iterations: getComputedStyle(element).animationIterationCount,
        playState: element.getAnimations().map((a) => a.playState),
      };
    });
    // CPU of the interface over 5 s with the session waiting and nothing else happening.
    const cpu = async () =>
      app.evaluate(({ app }) =>
        app
          .getAppMetrics()
          .filter((m) => m.type === 'Tab')
          .reduce((sum, m) => sum + (m.cpu.cumulativeCPUUsage ?? 0), 0),
      );
    const before = await cpu();
    await page.waitForTimeout(5000);
    const rendererCpuPercent = Math.round((((await cpu()) - before) / 5) * 1000) / 10;
    fs.writeFileSync(
      path.join(OUT, `02-aguardando-${PHASE}.json`),
      JSON.stringify({ dot, rendererCpuPercent }, null, 2) + '\n',
    );
    await shot('02-aguardando');
  } finally {
    await running.close();
    removeDir(userData);
    removeDir(work);
  }
});
