// The screens of the `aurelium` command line, to attach to the pull request, as in
// `evidences.spec.ts`:
//
//   EVIDENCES=1 npx playwright test --config tests/e2e/playwright.config.ts evidences-controle-por-cli.spec.ts
//
// It is new: there is no "before". Besides the screen, it writes what each command printed.
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { expect, test } from '@playwright/test';
import { launch, removeDir, ROOT, setTitle, tempDir } from './harness';

const OUT = process.env.EVIDENCES_DIR || path.join(ROOT, 'evidences', 'images');
const FOLDER = 'controle-por-cli';

test.skip(process.env.EVIDENCES !== '1', 'só com EVIDENCES=1');

test('evidences: the aurelium command line', async () => {
  test.setTimeout(120_000);
  const userData = tempDir('ac-evid-data-');
  const folder = tempDir('ac-evid-api-');
  const running = await launch(userData);
  const { page } = running;
  await page.setViewportSize({ width: 1280, height: 800 });
  const script = path.join(userData, 'bin', 'aurelium.cjs');
  const transcript: string[] = [];
  const cli = (...args: string[]) =>
    new Promise<string>((resolve) => {
      const child = spawn(process.execPath, [script, ...args]);
      let out = '';
      child.stdout.on('data', (d) => (out += d));
      child.stderr.on('data', (d) => (out += d));
      child.on('close', (code) => {
        const shown = args.map((a) => (/\s/.test(a) ? `"${a}"` : a)).join(' ');
        transcript.push(`$ aurelium ${shown}\n${out}(código ${code})\n`);
        resolve(out);
      });
    });
  const shot = async (name: string) => {
    fs.mkdirSync(path.join(OUT, FOLDER), { recursive: true });
    await page.waitForTimeout(600);
    await page.screenshot({ path: path.join(OUT, FOLDER, `${name}-depois.png`) });
  };

  try {
    await shot('01-antes-do-comando');
    const id = (await cli('new', folder, '--name', 'API')).trim();
    const row = page.locator(`.session-item[data-session-id="${id}"]`);
    await expect(row).toBeVisible();
    await cli('send', 'API', 'echo testes passaram');
    await expect
      .poll(
        async () => (await cli('read', 'API', '--lines', '6')).split('testes passaram').length > 2,
        {
          timeout: 20_000,
        },
      )
      .toBe(true);
    await row.click();
    await setTitle(page, '◐ API');
    await expect(row).toHaveAttribute('data-state', 'trabalhando', { timeout: 15_000 });
    await cli('list');
    const waiting = cli('wait', 'API', '--timeout', '60');
    await setTitle(page, '✳ pronto');
    await waiting;
    await cli('wait', 'API', '--timeout', '1');
    await cli('status', 'Web');
    await shot('02-sessao-aberta-pela-linha');
    // Only the reads that found the text stay in the transcript.
    const kept = transcript.filter(
      (t, i) =>
        !t.startsWith('$ aurelium read') ||
        i ===
          transcript.findIndex(
            (x) => x.startsWith('$ aurelium read') && x.split('testes passaram').length > 2,
          ),
    );
    fs.writeFileSync(path.join(OUT, FOLDER, 'comandos.txt'), kept.join('\n'));
  } finally {
    await running.close();
    removeDir(userData);
    removeDir(folder);
  }
});
