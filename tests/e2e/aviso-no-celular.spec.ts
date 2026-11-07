// Notices on the phone (ADR 0033): ntfy set up in the preferences, with a test sent to a fake
// ntfy server on this machine.
import http from 'node:http';
import type { AddressInfo } from 'node:net';
import { expect, test } from '@playwright/test';
import { launch, removeDir, tempDir } from './harness';

interface Received {
  url: string;
  title: string;
  body: string;
}

async function startFakeNtfy() {
  const received: Received[] = [];
  let status = 200;
  const server = http.createServer((req, res) => {
    let body = '';
    req.on('data', (chunk) => (body += chunk));
    req.on('end', () => {
      received.push({ url: req.url ?? '', title: String(req.headers.title ?? ''), body });
      res.writeHead(status, { 'content-type': 'application/json' });
      res.end('{}');
    });
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address() as AddressInfo;
  return {
    url: `http://127.0.0.1:${port}`,
    received,
    refuse: (code: number) => (status = code),
    close: () => new Promise<void>((resolve) => server.close(() => resolve())),
  };
}

test('ntfy is set up in the preferences and the test notice reaches the server', async () => {
  test.setTimeout(90_000);
  const userData = tempDir('ac-e2e-phone-');
  const ntfy = await startFakeNtfy();
  const running = await launch(userData);
  const { page } = running;
  try {
    await page.keyboard.press('Control+,');
    const prefs = page.getByRole('dialog', { name: 'Preferências' });
    const phone = prefs.getByTestId('phone-settings');
    await expect(phone).toBeVisible();
    await expect(phone.getByTestId('phone-test')).toHaveCount(0);

    await phone.getByTestId('phone-provider').selectOption('ntfy');
    // Typed letter by letter: a server half typed is not undone while typing.
    const server = phone.getByLabel('Servidor do ntfy');
    await server.clear();
    await server.pressSequentially(ntfy.url);
    await expect(server).toHaveValue(ntfy.url);
    await page.keyboard.press('Tab');
    await phone.getByRole('button', { name: 'Gerar outro' }).click();
    // The topic is filled after the click, not with it: wait for it instead of reading at once.
    await expect(phone.getByTestId('phone-topic')).toHaveValue(/^aurelium-[a-z2-9]{20}$/);
    const topic = await phone.getByTestId('phone-topic').inputValue();

    await phone.getByTestId('phone-test').click();
    await expect(phone.getByTestId('phone-test-result')).toHaveText('Enviado. Confira o celular.');
    expect(ntfy.received).toEqual([
      { url: `/${topic}`, title: 'Aurelium', body: 'Teste: os avisos chegam aqui.' },
    ]);

    // A refusal of the server is told, with its status.
    ntfy.refuse(403);
    await phone.getByTestId('phone-test').click();
    await expect(phone.getByTestId('phone-test-result')).toHaveText('Não foi: ntfy 403');

    // The choice is kept with the preferences.
    const kept = await page.evaluate(() => window.api.invoke('prefs:get'));
    expect(kept.phone).toMatchObject({ provider: 'ntfy', server: ntfy.url, topic });
  } finally {
    await running.close();
    await ntfy.close();
    removeDir(userData);
  }
});
