// A new copy gets the files git leaves out (`.env`), and the ports its processes open show with
// the session.
import fs from 'node:fs';
import net from 'node:net';
import path from 'node:path';
import { expect, test } from '@playwright/test';
import { isolatedSession } from './copy-helpers';
import { git, launch, makeRepo, removeDir, ROOT, runInTerminal, tempDir } from './harness';

const PHASE = process.env.EVIDENCES_PHASE === 'antes' ? 'antes' : 'depois';

const freePort = () =>
  new Promise<number>((resolve) => {
    const server = net.createServer();
    server.listen(0, '127.0.0.1', () => {
      const port = (server.address() as net.AddressInfo).port;
      server.close(() => resolve(port));
    });
  });

test('a new copy gets the .env of the repository, and the port of its dev server shows', async () => {
  test.setTimeout(150_000);
  const dir = tempDir('ac-e2e-prep-');
  const userData = tempDir('ac-e2e-prep-data-');
  const repo = makeRepo();
  fs.writeFileSync(path.join(repo, '.gitignore'), '.env*\n');
  git(repo, 'add', '-A');
  git(repo, 'commit', '-q', '-m', 'ignora o .env');
  fs.writeFileSync(path.join(repo, '.env'), 'DATABASE_URL=postgres://local\n');
  fs.writeFileSync(path.join(repo, '.env.local'), 'DEBUG=1\n');
  const running = await launch(userData);
  const { page } = running;
  try {
    await page.evaluate(
      (folder) => window.api.invoke('worktrees:configure', { folder, setup: '' }),
      path.join(dir, 'copias'),
    );
    if (PHASE === 'depois') {
      const info = await page.evaluate(() => window.api.invoke('worktrees:list'));
      expect(info.copy).toBe('.env\n.env.*');
    }

    const { id, cwd } = await isolatedSession(page, 'Servidor', repo, 'ac/servidor');
    if (PHASE === 'depois') {
      expect(fs.readFileSync(path.join(cwd, '.env'), 'utf8')).toBe(
        'DATABASE_URL=postgres://local\n',
      );
      expect(fs.readFileSync(path.join(cwd, '.env.local'), 'utf8')).toBe('DEBUG=1\n');
    }

    // A server started in the session: its port shows on top, to open in the browser.
    const port = await freePort();
    const server = path.join(dir, 'server.cjs');
    fs.writeFileSync(
      server,
      `require('http').createServer((_q, r) => r.end('ok')).listen(${port}, '127.0.0.1');\n`,
    );
    await runInTerminal(page, id, `node "${server}"`, 'server.cjs');
    if (PHASE === 'depois') {
      await expect(page.getByTestId('session-ports')).toContainText(`:${port}`, {
        timeout: 30_000,
      });
    } else {
      await page.waitForTimeout(12_000);
    }

    if (process.env.EVIDENCES === '1') {
      const out = process.env.EVIDENCES_DIR || path.join(ROOT, 'evidences', 'images');
      fs.mkdirSync(path.join(out, 'preparar-copia'), { recursive: true });
      await page.waitForTimeout(800);
      await page.screenshot({
        path: path.join(out, 'preparar-copia', `01-porta-da-sessao-${PHASE}.png`),
      });
    }
  } finally {
    await running.close();
    removeDir(userData);
    removeDir(repo);
    removeDir(dir);
  }
});
