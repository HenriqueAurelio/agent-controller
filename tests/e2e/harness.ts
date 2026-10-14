import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { _electron, expect, type ElectronApplication, type Page } from '@playwright/test';
import type { RendererApi } from '../../src/shared/ipc';

declare global {
  interface Window {
    api: RendererApi;
  }
}

export const ROOT = path.resolve(__dirname, '../..');

export interface RunningApp {
  app: ElectronApplication;
  page: Page;
  close(): Promise<void>;
}

export function tempDir(prefix: string): string {
  return fs.realpathSync.native(fs.mkdtempSync(path.join(os.tmpdir(), prefix)));
}

export function removeDir(dir: string): void {
  fs.rmSync(dir, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 });
}

/**
 * Opens the app with a throwaway profile, in test mode: sessions run a plain shell instead of an
 * agent. `AGENT_CONTROLLER_EXE` points the tests at a packaged build; otherwise they run the
 * output of `npm run build`.
 */
export async function launch(
  userData: string,
  extraEnv: Record<string, string> = {},
): Promise<RunningApp> {
  const executablePath = process.env.AGENT_CONTROLLER_EXE || undefined;
  const env: Record<string, string> = {};
  for (const [key, value] of Object.entries(process.env)) {
    // A parent Electron or agent must not leak its own switches into the app under test.
    if (value !== undefined && !/^(ELECTRON_|CLAUDE|AGENTCTL_)/.test(key)) env[key] = value;
  }
  const app = await _electron.launch({
    executablePath,
    args: [
      ...(executablePath ? [] : [ROOT]),
      ...(process.platform === 'linux' ? ['--no-sandbox'] : []),
    ],
    env: {
      ...env,
      AGENT_CONTROLLER_USER_DATA: userData,
      AGENT_CONTROLLER_AGENTCTL_DIR: path.join(userData, 'bin'),
      AGENT_CONTROLLER_TEST_SHELL: '1',
      ...extraEnv,
    },
  });
  const page = await app.firstWindow();
  await page.waitForSelector('.sidebar');
  return {
    app,
    page,
    close: async () => {
      const exited = new Promise<void>((resolve) => app.process().once('exit', () => resolve()));
      await app.close().catch(() => {});
      await exited;
    },
  };
}

export async function createSession(
  page: Page,
  name: string,
  cwd: string,
  profile = 'Claude Code',
) {
  await page.getByRole('button', { name: '+ Nova sessão' }).click();
  const dialog = page.getByRole('dialog', { name: 'Nova sessão' });
  await dialog.getByLabel('Pasta').fill(cwd);
  await dialog.getByLabel('Nome').fill(name);
  await dialog.getByRole('radio', { name: new RegExp(profile) }).check();
  await dialog.getByRole('button', { name: 'Criar e iniciar' }).click();
  await expect(dialog).toBeHidden();
  const item = page.locator('.session-item', { hasText: name });
  await expect(item).toHaveAttribute('aria-selected', 'true');
  // In test mode the "agent" is a shell, which sets no title: it stays in "iniciando" while alive.
  await expect(item).not.toHaveAttribute('data-state', 'parada');
  return (await item.getAttribute('data-session-id'))!;
}

/** Stops the agent of a session the way the user does: there is no button, only the palette. */
export async function stop(page: Page, name: string) {
  await page.keyboard.press('Control+Shift+P');
  const palette = page.getByRole('dialog', { name: 'Paleta de comandos' });
  await palette.getByRole('option', { name: `Parar o agente de “${name}”` }).click();
  await expect(palette).toBeHidden();
}

export const screenText = (page: Page, sessionId: string) =>
  page.evaluate((id) => window.api.invoke('terminal:screenText', id), sessionId);

/** Types into the visible terminal and waits for `expected` to show up on its screen. */
export async function runInTerminal(
  page: Page,
  sessionId: string,
  command: string,
  expected: string,
) {
  await page.locator('.terminal-host.visible').click();
  await page.keyboard.type(command);
  await page.keyboard.press('Enter');
  await expect.poll(() => screenText(page, sessionId), { timeout: 20_000 }).toContain(expected);
}

export function git(cwd: string, ...args: string[]): string {
  return execFileSync('git', args, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
}

export function makeRepo(): string {
  const repo = tempDir('ac-e2e-repo-');
  git(repo, 'init', '-q', '-b', 'main');
  git(repo, 'config', 'user.email', 'e2e@example.com');
  git(repo, 'config', 'user.name', 'E2E');
  git(repo, 'config', 'commit.gpgsign', 'false');
  git(repo, 'config', 'core.autocrlf', 'false');
  fs.writeFileSync(path.join(repo, 'editado.ts'), 'export const valor = 1;\n');
  fs.writeFileSync(path.join(repo, 'removido.txt'), 'adeus\n');
  fs.writeFileSync(path.join(repo, 'velho.txt'), 'linha um\nlinha dois\nlinha três\n');
  fs.mkdirSync(path.join(repo, 'src'));
  fs.writeFileSync(path.join(repo, 'src', 'app.ts'), 'console.log("oi");\n');
  git(repo, 'add', '-A');
  git(repo, 'commit', '-q', '-m', 'base');
  return repo;
}
