import { expect, test } from '@playwright/test';
import { createSession, launch, removeDir, screenText, tempDir } from './harness';

const auxId = (sessionId: string) => `${sessionId}:aux`;

test('the side terminal runs commands in the folder of the session, apart from the agent', async () => {
  test.setTimeout(120_000);
  const userData = tempDir('ac-e2e-aux-');
  const folder = tempDir('ac-e2e-aux-pasta-');
  const running = await launch(userData);
  const { page } = running;
  try {
    const id = await createSession(page, 'Com shell', folder);
    await expect(page.locator('.terminal-host.visible')).toHaveCount(1);
    // The shell of the agent has drawn its prompt: nothing else should reach its screen.
    await expect.poll(() => screenText(page, id), { timeout: 20_000 }).toMatch(/[>$]\s*$/);
    const agentBefore = await screenText(page, id);

    // The shortcut opens it, with its own label, and gives it the keyboard.
    await page.keyboard.press('Control+Shift+Quote');
    const pane = page.getByRole('region', { name: 'Terminal auxiliar' });
    await expect(pane).toBeVisible();
    await expect(pane).toContainText(folder);
    await expect(pane.locator('.terminal-host')).toHaveCount(1);
    await expect
      .poll(() => page.evaluate(() => document.activeElement?.closest('.aux-pane') !== null))
      .toBe(true);

    await page.keyboard.type('echo saida-do-auxiliar');
    await page.keyboard.press('Enter');
    await expect
      .poll(() => screenText(page, auxId(id)), { timeout: 20_000 })
      .toContain('saida-do-auxiliar');
    // Nothing of it reached the agent.
    const agentAfter = await screenText(page, id);
    expect(agentAfter).not.toContain('saida-do-auxiliar');
    expect(agentAfter).toBe(agentBefore);

    // Ctrl+Shift+T goes back to the agent's terminal; what is typed then goes there.
    await page.keyboard.press('Control+Shift+T');
    await expect
      .poll(() =>
        page.evaluate(() => document.activeElement?.closest('.terminal-container') !== null),
      )
      .toBe(true);
    await page.keyboard.type('echo no-agente');
    await page.keyboard.press('Enter');
    await expect.poll(() => screenText(page, id), { timeout: 20_000 }).toContain('no-agente');
    expect(await screenText(page, auxId(id))).not.toContain('no-agente');

    // The header button closes it, and the palette opens it again.
    const header = page.locator('.session-header');
    await expect(header.getByRole('button', { name: 'Terminal', exact: true })).toHaveAttribute(
      'aria-pressed',
      'true',
    );
    await header.getByRole('button', { name: 'Terminal', exact: true }).click();
    await expect(pane).toBeHidden();
    await page.keyboard.press('Control+Shift+P');
    const palette = page.getByRole('dialog', { name: 'Paleta de comandos' });
    await palette
      .getByRole('option', { name: 'Terminal auxiliar: abrir um shell na pasta de “Com shell”' })
      .click();
    await expect(pane).toBeVisible();
    // A new shell: the old one ended when it was closed.
    await expect.poll(() => screenText(page, auxId(id))).not.toContain('saida-do-auxiliar');

    // Closing the session ends both.
    await page.evaluate((sessionId) => window.api.invoke('sessions:remove', sessionId), id);
    await expect(pane).toBeHidden();
    await expect(page.locator('.session-item')).toHaveCount(0);
    await expect(
      page.evaluate((sessionId) => window.api.invoke('terminal:screenText', sessionId), auxId(id)),
    ).rejects.toThrow(/Sessão não encontrada/);
  } finally {
    await running.close();
    removeDir(userData);
    removeDir(folder);
  }
});

test('the side terminal goes where the layout says, and comes back closed after a restart', async () => {
  test.setTimeout(120_000);
  const userData = tempDir('ac-e2e-aux-layout-');
  const folder = tempDir('ac-e2e-aux-layout-pasta-');
  let running = await launch(userData);
  try {
    let { page } = running;
    await createSession(page, 'Ao lado', folder);
    await page.evaluate(() =>
      window.api.invoke('prefs:set', {
        layout: { sessions: 'left', panel: 'cover', files: 'left', aux: 'right' },
      }),
    );
    await page.keyboard.press('Control+Shift+Quote');
    await expect(page.locator('.terminal-area')).toHaveAttribute('data-aux', 'right');
    const agent = await page.locator('.terminal-container').boundingBox();
    const aux = await page.locator('.aux-pane').boundingBox();
    expect(aux!.x).toBeGreaterThan(agent!.x + agent!.width - 2);

    // Dragging the divider gives the agent more room.
    const divider = page.getByRole('separator', { name: /Divisória/ });
    const box = (await divider.boundingBox())!;
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
    await page.mouse.down();
    await page.mouse.move(box.x + 120, box.y + box.height / 2, { steps: 5 });
    await page.mouse.up();
    const wider = await page.locator('.terminal-container').boundingBox();
    expect(wider!.width).toBeGreaterThan(agent!.width + 60);

    await running.close();
    running = await launch(userData);
    page = running.page;
    await page.locator('.session-item', { hasText: 'Ao lado' }).click();
    await expect(page.locator('.session-header')).toBeVisible();
    await expect(page.locator('.aux-pane')).toHaveCount(0);
  } finally {
    await running.close();
    removeDir(userData);
    removeDir(folder);
  }
});
