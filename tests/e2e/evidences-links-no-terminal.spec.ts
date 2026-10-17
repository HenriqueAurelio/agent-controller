// The screens of the links in the terminal, to attach to the pull request, as in `evidences.spec.ts`:
//
//   EVIDENCES=1 npx playwright test --config tests/e2e/playwright.config.ts evidences-links-no-terminal.spec.ts
//
// `EVIDENCES_PHASE=antes`, run on a build of the code as it was, takes the "before" of each pair:
// the same steps, on an app where Ctrl+click does nothing yet.
import fs from 'node:fs';
import path from 'node:path';
import { expect, test } from '@playwright/test';
import { createSession, git, launch, removeDir, ROOT, screenText, tempDir } from './harness';

const PHASE = process.env.EVIDENCES_PHASE === 'antes' ? 'antes' : 'depois';
const OUT = process.env.EVIDENCES_DIR || path.join(ROOT, 'evidences', 'images');
const FOLDER = 'links-no-terminal';

test.skip(process.env.EVIDENCES !== '1', 'só com EVIDENCES=1');

const SOURCE = `import { soma } from './soma';

export interface Pedido {
  id: number;
  itens: string[];
  total: number;
}

export function fecha(pedido: Pedido): number {
  let total = 0;
  for (const item of pedido.itens) {
    // Cada item vale um real.
    total = total + item.length;
  }
  const desconto: number = soma(total, '10');
  return total - desconto;
}

export function descreve(pedido: Pedido): string {
  return \`pedido \${pedido.id}: \${pedido.itens.length} itens\`;
}
`;

const OUTPUT = [
  "src/pedido.ts:15:36 - error TS2345: Argument of type 'string' is not assignable to parameter of type 'number'.",
  '',
  "15   const desconto: number = soma(total, '10');",
  '                                          ~~~~',
  '',
  'Found 1 error in src/pedido.ts:15',
  '',
  'Docs em http://localhost:3000/ajuda e o log em ../fora.txt:1',
];

test('evidences: links in the terminal', async () => {
  test.setTimeout(180_000);
  const userData = tempDir('ac-evid-data-');
  const base = tempDir('ac-');
  const folder = path.join(base, 'loja');
  fs.mkdirSync(path.join(folder, 'src'), { recursive: true });
  fs.writeFileSync(path.join(folder, 'src', 'pedido.ts'), SOURCE);
  fs.writeFileSync(
    path.join(folder, 'src', 'soma.ts'),
    'export const soma = (a: number, b: number) => a + b;\n',
  );
  fs.writeFileSync(path.join(base, 'fora.txt'), 'x\n');
  // A committed project: the editor then shows the file as it is, not as all new.
  git(folder, 'init', '-q', '-b', 'main');
  git(folder, 'config', 'user.email', 'e2e@example.com');
  git(folder, 'config', 'user.name', 'E2E');
  git(folder, 'config', 'commit.gpgsign', 'false');
  git(folder, 'add', '-A');
  git(folder, 'commit', '-q', '-m', 'base');
  fs.writeFileSync(
    path.join(folder, 'saida.cjs'),
    `console.log(${JSON.stringify(OUTPUT.join('\n'))});\nprocess.exit(1);\n`,
  );

  const running = await launch(userData);
  const { page } = running;
  const shot = async (name: string) => {
    fs.mkdirSync(path.join(OUT, FOLDER), { recursive: true });
    await page.waitForTimeout(700);
    await page.screenshot({ path: path.join(OUT, FOLDER, `${name}-${PHASE}.png`) });
  };

  try {
    const id = await createSession(page, 'Loja', folder);

    const host = page.locator('.terminal-host.visible');
    await host.click();
    await page.keyboard.type(process.platform === 'win32' ? 'prompt $G$S' : 'PS1="> "');
    await page.keyboard.press('Enter');
    await page.keyboard.type(`${process.platform === 'win32' ? 'cls' : 'clear'} && node saida.cjs`);
    await page.keyboard.press('Enter');
    await expect.poll(() => screenText(page, id), { timeout: 20_000 }).toContain('Found 1 error');

    // The row of the path, and where the mouse goes. The size in cells is only read by the new
    // build; the window is the same, so the old one uses what the new one reports.
    const lines = (await screenText(page, id)).split('\n');
    const row = lines.findIndex((line) => line.startsWith('src/pedido.ts:15:36'));
    const screen = (await host.locator('.xterm-screen').boundingBox())!;
    const cols = Number(await host.getAttribute('data-cols')) || 141;
    const rows = Number(await host.getAttribute('data-rows')) || 47;
    const at = (r: number, c: number) => ({
      x: screen.x + (screen.width / cols) * (c + 0.5),
      y: screen.y + (screen.height / rows) * (r + 0.5),
    });
    const path1 = at(row, 6);
    await page.mouse.move(path1.x - 40, path1.y + 60);

    // 1. Ctrl held over the path: the new build underlines it.
    await page.mouse.move(path1.x - 3, path1.y);
    await page.keyboard.down('Control');
    await page.mouse.move(path1.x, path1.y, { steps: 3 });
    await page.waitForTimeout(600);
    await shot('01-ctrl-sobre-o-caminho');

    // 2. Ctrl+click: the new build opens the file in the panel, on the line.
    await page.mouse.down();
    await page.mouse.up();
    await page.keyboard.up('Control');
    if (PHASE === 'depois') {
      const frame = page.frameLocator('[data-testid="diff-frame"]');
      await frame.locator('body[data-reveal-line="15"]').waitFor();
    } else {
      await page.waitForTimeout(800);
    }
    await page.mouse.move(path1.x, path1.y + 200);
    await shot('02-ctrl-clique-abre-na-linha');

    // 3. The same in the output of the checks.
    await page.evaluate(
      (sessionId) =>
        window.api.invoke('checks:configure', sessionId, [
          { id: 'tsc', label: 'tsc', command: 'node saida.cjs', timeoutSec: 60, onTurnEnd: false },
        ]),
      id,
    );
    await page.evaluate((sessionId) => window.api.invoke('checks:run', sessionId), id);
    await page
      .locator('.session-header')
      .getByRole('button', { name: /^Verificações/ })
      .click();
    const dialog = page.getByRole('dialog', { name: 'Verificações' });
    const output = dialog.locator('.checks-output');
    await expect(output).toContainText('Found 1 error', { timeout: 60_000 });
    const box = (await output.boundingBox())!;
    await page.mouse.move(box.x + 60, box.y + 14);
    await page.keyboard.down('Control');
    if (PHASE === 'depois') {
      const link = output.locator('.output-link').first();
      await expect(link).toBeVisible();
      const where = (await link.boundingBox())!;
      await page.mouse.move(where.x + 20, where.y + where.height / 2, { steps: 3 });
    }
    await shot('03-saida-das-verificacoes');
    await page.keyboard.up('Control');
  } finally {
    await running.close();
    removeDir(userData);
    removeDir(base);
  }
});
