// The screens of the notices on the phone, to attach to the pull request, as in
// `evidences.spec.ts`:
//
//   EVIDENCES=1 npx playwright test --config tests/e2e/playwright.config.ts evidences-aviso-no-celular.spec.ts
//
// `EVIDENCES_PHASE=antes`, run on a build of the code as it was, takes the "before": the same tab
// of the preferences, where the notices only went to the system.
import fs from 'node:fs';
import http from 'node:http';
import type { AddressInfo } from 'node:net';
import path from 'node:path';
import { expect, test } from '@playwright/test';
import { launch, removeDir, ROOT, tempDir } from './harness';

const PHASE = process.env.EVIDENCES_PHASE === 'antes' ? 'antes' : 'depois';
const OUT = process.env.EVIDENCES_DIR || path.join(ROOT, 'evidences', 'images');
const FOLDER = 'aviso-no-celular';

test.skip(process.env.EVIDENCES !== '1', 'só com EVIDENCES=1');

test('evidences: the notices on the phone', async () => {
  test.setTimeout(90_000);
  const server = http.createServer((req, res) => {
    req.resume();
    req.on('end', () => res.end('{}'));
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const url = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  const userData = tempDir('ac-evid-data-');
  const running = await launch(userData);
  const { page } = running;
  await page.setViewportSize({ width: 1280, height: 900 });
  const shot = async (name: string) => {
    fs.mkdirSync(path.join(OUT, FOLDER), { recursive: true });
    await page.waitForTimeout(600);
    await page.screenshot({ path: path.join(OUT, FOLDER, `${name}-${PHASE}.png`) });
  };

  try {
    await page.keyboard.press('Control+,');
    const prefs = page.getByRole('dialog', { name: 'Preferências' });
    await expect(prefs).toBeVisible();
    if (PHASE === 'antes') {
      await prefs.getByText('Avisos', { exact: false }).first().scrollIntoViewIfNeeded();
      await shot('01-preferencias');
      await shot('02-ntfy-configurado');
      await shot('03-telegram');
      return;
    }
    const phone = prefs.getByTestId('phone-settings');
    await phone.scrollIntoViewIfNeeded();
    await shot('01-preferencias');

    await phone.getByTestId('phone-provider').selectOption('ntfy');
    await phone.getByLabel('Servidor do ntfy').fill(url);
    await page.keyboard.press('Tab');
    await phone.getByRole('button', { name: 'Gerar outro' }).click();
    await phone.getByTestId('phone-test').click();
    await expect(phone.getByTestId('phone-test-result')).toHaveText('Enviado. Confira o celular.');
    await phone.scrollIntoViewIfNeeded();
    await shot('02-ntfy-configurado');

    await phone.getByTestId('phone-provider').selectOption('telegram');
    await phone.scrollIntoViewIfNeeded();
    await shot('03-telegram');
  } finally {
    await running.close();
    server.close();
    removeDir(userData);
  }
});
