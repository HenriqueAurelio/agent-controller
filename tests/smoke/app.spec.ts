// The real agents inside the real app: proves that agentctl, run by the app's own runtime,
// delivers hooks and notify to the right session. On demand only (uses the account):
//   npm run test:smoke:app
// SMOKE_CWD must be a folder both agents already trust; AGENT_CONTROLLER_EXE tests a packaged app.
// SMOKE_COMMAND_CLAUDE_CODE / SMOKE_COMMAND_CODEX: the command of the agent in the preferences
// (an alias or function of the user's shell, such as `claude-personal`).
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { _electron, expect, test, type Page } from '@playwright/test';
import type { SessionView } from '../../src/shared/session';

const ROOT = path.resolve(__dirname, '../..');
const CWD = path.resolve(process.env.SMOKE_CWD ?? ROOT);
const profiles = (process.env.SMOKE_PROFILES ?? 'claude-code,codex').split(',');
const agentCommands = {
  'claude-code': process.env.SMOKE_COMMAND_CLAUDE_CODE?.trim() ?? '',
  codex: process.env.SMOKE_COMMAND_CODEX?.trim() ?? '',
};

const sessions = (page: Page) =>
  page.evaluate(() => window.api.invoke('sessions:list')).then((s) => s.sessions as SessionView[]);
const screen = (page: Page, id: string) =>
  page.evaluate((i) => window.api.invoke('terminal:screenText', i), id);

async function untilState(
  page: Page,
  id: string,
  state: string,
  timeout: number,
): Promise<SessionView> {
  await expect
    .poll(async () => (await sessions(page)).find((s) => s.id === id)?.status.state, { timeout })
    .toBe(state);
  return (await sessions(page)).find((s) => s.id === id)!;
}

for (const [label, profile, origin] of [
  ['Claude Code', 'claude-code', 'hook'],
  ['Codex', 'codex', 'notify'],
] as const) {
  test(`${label}: um turno completo dentro do app`, async () => {
    test.skip(!profiles.includes(profile), 'perfil não selecionado');
    test.setTimeout(240_000);
    const userData = fs.mkdtempSync(path.join(os.tmpdir(), 'ac-smoke-app-'));
    const codexConfig = path.join(os.homedir(), '.codex', 'config.toml');
    const codexBackup = fs.existsSync(codexConfig) ? fs.readFileSync(codexConfig) : null;
    const env: Record<string, string> = {};
    for (const [key, value] of Object.entries(process.env)) {
      if (value !== undefined && !/^(ELECTRON_|CLAUDE|AGENTCTL_)/.test(key)) env[key] = value;
    }
    const exe = process.env.AGENT_CONTROLLER_EXE || undefined;
    const app = await _electron.launch({
      executablePath: exe,
      args: exe ? [] : [ROOT],
      env: {
        ...env,
        AGENT_CONTROLLER_USER_DATA: userData,
        AGENT_CONTROLLER_AGENTCTL_DIR: path.join(userData, 'bin'),
      },
    });
    try {
      const page = await app.firstWindow();
      await page.waitForSelector('.sidebar');
      if (agentCommands[profile]) {
        await page.evaluate(
          (commands) => window.api.invoke('prefs:set', { agentCommands: commands }),
          agentCommands,
        );
      }

      // The profile is offered because the agent was found on the PATH.
      await page.getByRole('button', { name: '+ Nova sessão' }).click();
      const dialog = page.getByRole('dialog', { name: 'Nova sessão' });
      const option = dialog.getByRole('radio', { name: new RegExp(label) });
      await expect(option).toBeEnabled();
      await dialog.getByLabel('Pasta').fill(CWD);
      await dialog.getByLabel('Nome').fill(`smoke ${label}`);
      await option.check();
      await dialog.getByRole('button', { name: 'Criar e iniciar' }).click();
      const id = (await page.locator('.session-item').getAttribute('data-session-id'))!;

      // Startup questions, answered the way a user would.
      await untilState(page, id, 'aguardando', 60_000);
      await page.locator('.terminal-host.visible').click();
      for (let quiet = 0; quiet < 4;) {
        const text = await screen(page, id);
        if (/Skip until next version/.test(text)) await page.keyboard.press('Escape');
        else if (/Hooks need review/.test(text)) await page.keyboard.type('3');
        else quiet++;
        await page.waitForTimeout(700);
      }

      await page.keyboard.type('Responda apenas com a palavra ok. Não use nenhuma ferramenta.');
      // Codex takes an Enter that follows a burst of keys as part of a paste, not as "send".
      await page.waitForTimeout(800);
      await page.keyboard.press('Enter');
      await untilState(page, id, 'trabalhando', 30_000).catch(async (err) => {
        throw new Error(`${err.message}\nTela:\n${await screen(page, id)}`);
      });
      const done = await untilState(page, id, 'terminou', 120_000);
      // The origin proves the path: the hook (.cmd launcher) or the notify (the app as agentctl).
      expect(done.status).toMatchObject({ origin, confirmed: true });
      await expect(page.locator('.session-item')).toHaveAttribute('data-state', 'terminou');
      await expect(page.getByTestId('session-status')).toContainText('Terminou');

      // Stopping from the interface ends the agent, so closing the app asks nothing.
      await page.getByRole('button', { name: 'Parar' }).click();
      await untilState(page, id, 'parada', 30_000);
    } finally {
      // With an agent still running the app would stop at its "close?" dialog.
      const page = app.windows()[0];
      await page
        ?.evaluate(async () => {
          const { sessions } = await window.api.invoke('sessions:list');
          await Promise.all(sessions.map((s) => window.api.invoke('sessions:stop', s.id)));
        })
        .catch(() => {});
      const exited = new Promise<void>((resolve) => app.process().once('exit', () => resolve()));
      await app.close().catch(() => {});
      await exited;
      if (codexBackup && !fs.readFileSync(codexConfig).equals(codexBackup)) {
        fs.writeFileSync(codexConfig, codexBackup);
      }
      fs.rmSync(userData, { recursive: true, force: true, maxRetries: 10, retryDelay: 300 });
    }
  });
}
