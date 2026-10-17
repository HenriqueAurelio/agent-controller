// What the tests and the evidences of the links in the terminal share.
import fs from 'node:fs';
import path from 'node:path';
import { expect, type Page } from '@playwright/test';
import { screenText, tempDir } from './harness';

const CLEAR = process.platform === 'win32' ? 'cls' : 'clear';

export function makeFolder(): { folder: string; outside: string } {
  const base = tempDir('ac-e2e-links-');
  const folder = path.join(base, 'projeto');
  fs.mkdirSync(path.join(folder, 'src'), { recursive: true });
  const lines = Array.from({ length: 40 }, (_, i) => `export const linha${i + 1} = ${i + 1};`);
  fs.writeFileSync(path.join(folder, 'src', 'exemplo.ts'), `${lines.join('\n')}\n`);
  const outside = path.join(base, 'fora.txt');
  fs.writeFileSync(outside, 'segredo\n');
  return { folder, outside };
}

/** Prints `text` on a clean screen and returns where its row is, in cells. */
export async function printLine(
  page: Page,
  terminalId: string,
  text: string,
): Promise<{ row: number }> {
  await page.keyboard.type(`${CLEAR} && echo ${text}`);
  await page.keyboard.press('Enter');
  let row = -1;
  await expect
    .poll(
      async () => {
        const lines = (await screenText(page, terminalId)).split('\n');
        row = lines.findIndex((line) => line.startsWith(text));
        return row;
      },
      { timeout: 20_000 },
    )
    .toBeGreaterThanOrEqual(0);
  return { row };
}

/** Moves the mouse onto a cell of the visible terminal (or of the side one) and returns the point. */
export async function pointAt(
  page: Page,
  host: ReturnType<Page['locator']>,
  row: number,
  col: number,
) {
  const cols = Number(await host.getAttribute('data-cols'));
  const rows = Number(await host.getAttribute('data-rows'));
  const screen = (await host.locator('.xterm-screen').boundingBox())!;
  return {
    x: screen.x + (screen.width / cols) * (col + 0.5),
    y: screen.y + (screen.height / rows) * (row + 0.5),
  };
}

export async function ctrlClick(page: Page, point: { x: number; y: number }) {
  // Coming from elsewhere, as a hand does: the terminal looks for links as the mouse enters a row.
  await page.mouse.move(point.x, point.y + 120);
  await page.mouse.move(point.x - 3, point.y);
  await page.keyboard.down('Control');
  await page.mouse.move(point.x, point.y, { steps: 3 });
  // The paths are checked with the main process before they become links.
  await page.waitForTimeout(500);
  await page.mouse.down();
  await page.mouse.up();
  await page.keyboard.up('Control');
}
