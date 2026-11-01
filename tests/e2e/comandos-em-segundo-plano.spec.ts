// Background commands: a list of commands of the user's shell that run apart from the sessions,
// each turned on and off by a box, with its output, and the ones left on starting with the app.
import { expect, test, type Page } from '@playwright/test';
import { launch, removeDir, tempDir } from './harness';

// Node stands for the user's alias (a database proxy): the same line runs in PowerShell and bash.
const PROXY = `node -e "console.log('proxy pronto na porta 5432'); setInterval(() => {}, 1000)"`;
const FALLS = `node -e "console.log('sem login no gcloud'); process.exit(3)"`;

async function addCommand(page: Page, name: string, command: string) {
  await page.getByTestId('background-new').click();
  const form = page.getByTestId('background-form');
  await form.getByTestId('background-name').fill(name);
  await form.getByTestId('background-command').fill(command);
  await form.getByTestId('background-save').click();
  await expect(form).toBeHidden();
}

const row = (page: Page, name: string) =>
  page.getByTestId('background-row').filter({ has: page.getByText(name, { exact: true }) });

test('background commands run apart from the sessions, and the ones on start with the app', async () => {
  test.setTimeout(120_000);
  const userData = tempDir('ac-e2e-bg-');
  let running = await launch(userData);
  try {
    let page = running.page;
    await page.getByTestId('background-button').click();
    const view = page.getByTestId('background-view');
    await expect(view).toBeVisible();
    await expect(page.getByTestId('background-empty')).toBeVisible();

    // A new command is on as it is saved, and runs with no session open.
    await addCommand(page, 'Banco de produção', PROXY);
    const banco = row(page, 'Banco de produção');
    await expect(banco).toHaveAttribute('data-status', 'running', { timeout: 15_000 });
    await expect(banco.getByTestId('background-status')).toContainText('Rodando há');
    await expect(page.getByTestId('background-button')).toHaveAttribute('data-running', '1');
    await banco.getByTestId('background-output-button').click();
    await expect(banco.getByTestId('background-output')).toContainText(
      'proxy pronto na porta 5432',
      { timeout: 15_000 },
    );

    // Turned off, it stops; its output stays to read.
    await banco.getByTestId('background-on').uncheck();
    await expect(banco).toHaveAttribute('data-status', 'stopped', { timeout: 15_000 });
    await expect(banco.getByTestId('background-status')).toHaveText('Desligado');
    await expect(banco.getByTestId('background-output')).toContainText('proxy pronto');

    // One that ends by itself says so, with its code, and the button of the panel counts it.
    await addCommand(page, 'Proxy sem login', FALLS);
    const falls = row(page, 'Proxy sem login');
    await expect(falls).toHaveAttribute('data-status', 'exited', { timeout: 15_000 });
    await expect(falls.getByTestId('background-status')).toHaveText('Parou sozinho (código 3)');
    await expect(page.getByTestId('background-badge')).toHaveText('1');
    await falls.getByTestId('background-output-button').click();
    await expect(falls.getByTestId('background-output')).toContainText('sem login no gcloud');

    // Edited, it runs with the new line; deleted, it leaves the list and the badge.
    await falls.getByTestId('background-edit').click();
    await falls.getByTestId('background-command').fill(PROXY);
    await falls.getByTestId('background-save').click();
    await falls.getByTestId('background-restart').click();
    await expect(falls).toHaveAttribute('data-status', 'running', { timeout: 15_000 });
    await expect(page.getByTestId('background-badge')).toHaveCount(0);
    await falls.getByTestId('background-remove').click();
    await expect(page.getByTestId('background-row')).toHaveCount(1);

    // Esc closes the panel; the command left on keeps running without it.
    await banco.getByTestId('background-on').check();
    await expect(banco).toHaveAttribute('data-status', 'running', { timeout: 15_000 });
    await view.press('Escape');
    await expect(view).toBeHidden();
    await expect(page.getByTestId('background-button')).toHaveAttribute('data-running', '1');

    // Closing the app stops it; opening again starts the ones left on.
    await running.close();
    running = await launch(userData);
    page = running.page;
    await page.getByTestId('background-button').click();
    await expect(row(page, 'Banco de produção')).toHaveAttribute('data-status', 'running', {
      timeout: 15_000,
    });
  } finally {
    await running.close();
    removeDir(userData);
  }
});
