// The preview of a local page inside the app, and a marked-up screenshot of it for the agent
// (ADR 0031).
import fs from 'node:fs';
import http from 'node:http';
import type { AddressInfo } from 'node:net';
import path from 'node:path';
import { expect, test } from '@playwright/test';
import { createSession, launch, removeDir, ROOT, tempDir } from './harness';

const PAGE = `<!doctype html><title>Loja local</title>
<body style="font-family:sans-serif;margin:40px">
<h1>Carrinho</h1><button style="margin-left:300px">Finalizar compra</button>
<p><a href="https://example.com/fora">um link de fora</a></p></body>`;

test('a local page opens in the app, and a marked-up screenshot of it goes to the agent', async () => {
  test.setTimeout(120_000);
  const server = http.createServer((_req, res) => {
    res.setHeader('content-type', 'text/html; charset=utf-8');
    res.end(PAGE);
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const port = (server.address() as AddressInfo).port;
  const userData = tempDir('ac-e2e-preview-');
  const folder = tempDir('ac-e2e-preview-folder-');
  const running = await launch(userData);
  const { page } = running;
  try {
    const id = await createSession(page, 'Loja', folder);
    await page.keyboard.press('Control+Shift+P');
    await page
      .getByRole('dialog', { name: 'Paleta de comandos' })
      .getByRole('option', { name: /^Prévia: abrir/ })
      .click();
    const panel = page.getByTestId('preview-panel');
    await expect(panel).toBeVisible();

    // Only pages of this machine.
    const address = panel.getByTestId('preview-address');
    await address.fill('example.com');
    await address.press('Enter');
    await expect(panel.getByTestId('preview-error')).toHaveText(
      'A prévia só abre páginas desta máquina (localhost, 127.0.0.1).',
    );
    await address.fill(String(port));
    await address.press('Enter');
    await expect
      .poll(async () => (await page.evaluate(() => window.api.invoke('preview:state')))?.title, {
        timeout: 20_000,
      })
      .toBe('Loja local');
    await expect(address).toHaveValue(`http://localhost:${port}/`);

    if (process.env.EVIDENCES === '1') {
      const out = process.env.EVIDENCES_DIR || path.join(ROOT, 'evidences', 'images');
      fs.mkdirSync(path.join(out, 'previa'), { recursive: true });
      await page.waitForTimeout(800);
      await page.screenshot({ path: path.join(out, 'previa', '01-a-pagina-no-app-depois.png') });
    }

    // A screenshot, a rectangle over the button, a note: the agent gets the file.
    await panel.getByTestId('preview-shot').click();
    const canvas = page.getByTestId('annotate-canvas');
    await expect(canvas).toBeVisible();
    const box = (await canvas.boundingBox())!;
    await page.mouse.move(box.x + box.width * 0.3, box.y + box.height * 0.12);
    await page.mouse.down();
    await page.mouse.move(box.x + box.width * 0.6, box.y + box.height * 0.25, { steps: 5 });
    await page.mouse.up();
    await page.getByTestId('annotate-note').fill('O botão está fora do lugar.');
    if (process.env.EVIDENCES === '1') {
      const out = process.env.EVIDENCES_DIR || path.join(ROOT, 'evidences', 'images');
      await page.waitForTimeout(500);
      await page.screenshot({ path: path.join(out, 'previa', '02-marcar-o-print-depois.png') });
    }
    await page.getByTestId('annotate-send').click();
    const prompt = page.getByRole('dialog', { name: 'Enviar prompt' });
    const text = prompt.getByLabel('Texto a enviar');
    await expect(text).toContainText('O botão está fora do lugar.');
    // The path may have spaces (a user folder): it ends where the sentence does.
    const file = /em (.+?\.png)\. /.exec(await text.inputValue())![1]!;
    expect(fs.statSync(file).size).toBeGreaterThan(1000);
    expect(path.dirname(file)).toContain(path.join(userData, 'shots'));
    expect(id).toBeTruthy();
  } finally {
    await running.close();
    server.close();
    removeDir(userData);
    removeDir(folder);
  }
});
