// The `aurelium` command line against the app (ADR 0034): a session opened from outside shows up
// in the sidebar, gets a text, and `wait` ends with its turn.
import { spawn } from 'node:child_process';
import path from 'node:path';
import { expect, test, type Page } from '@playwright/test';
import { launch, removeDir, setTitle, tempDir } from './harness';

const row = (page: Page, id: string) => page.locator(`.session-item[data-session-id="${id}"]`);

// Written so that the command line itself does not hold what it prints.
const echo = (word: string) =>
  process.platform === 'win32'
    ? `echo ^>${word}^<`
    : `echo '>${word.slice(0, -1)}''${word.slice(-1)}<'`;

test('a session opened by the command line gets a text, and wait ends with its turn', async () => {
  test.setTimeout(120_000);
  const userData = tempDir('ac-e2e-cli-');
  const folder = tempDir('ac-e2e-cli-pasta-');
  const running = await launch(userData);
  const { page } = running;
  // The script the app installed, run by the Node of the tests.
  const script = path.join(userData, 'bin', 'aurelium.cjs');
  const cli = (...args: string[]) =>
    new Promise<{ code: number | null; out: string; err: string }>((resolve) => {
      const child = spawn(process.execPath, [script, ...args]);
      let out = '';
      let err = '';
      child.stdout.on('data', (d) => (out += d));
      child.stderr.on('data', (d) => (err += d));
      child.on('close', (code) => resolve({ code, out, err }));
    });

  try {
    const created = await cli('new', folder, '--name', 'Pela linha');
    expect(created.err).toBe('');
    const id = created.out.trim();
    await expect(row(page, id)).toContainText('Pela linha');

    // The text reaches the shell of the session.
    expect(await cli('send', 'Pela linha', echo('pronta'))).toMatchObject({
      code: 0,
      out: 'Enviado.\n',
    });
    await expect
      .poll(async () => (await cli('read', id)).out, { timeout: 20_000 })
      .toContain('>pronta<');

    // A turn: `wait` holds while the agent works and ends when it finishes.
    await row(page, id).click();
    await setTitle(page, '◐ trabalhando');
    await expect(row(page, id)).toHaveAttribute('data-state', 'trabalhando', { timeout: 15_000 });
    const waiting = cli('wait', id, '--timeout', '60');
    let ended = false;
    void waiting.then(() => (ended = true));
    await page.waitForTimeout(1500);
    expect(ended).toBe(false);
    await setTitle(page, '✳ pronto');
    expect(await waiting).toMatchObject({ code: 0, out: 'terminou\n' });

    const listed = JSON.parse((await cli('list', '--json')).out);
    expect(listed).toEqual([
      expect.objectContaining({ id, name: 'Pela linha', cwd: folder, state: 'terminou' }),
    ]);

    // What goes wrong is told in the language of the app, with a code that is not 0.
    expect(await cli('send', 'Nenhuma', 'x')).toMatchObject({
      code: 1,
      err: 'Sessão não encontrada\n',
    });
  } finally {
    await running.close();
    removeDir(userData);
    removeDir(folder);
  }
});
