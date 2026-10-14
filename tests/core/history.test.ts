import { describe, expect, it } from 'vitest';
import { ScreenHistory } from '@core/history/ScreenHistory';

const make = (cols = 60, rows = 10, scrollback = 100) =>
  new ScreenHistory({ cols, rows, scrollback });

/** Rebuilds a terminal from a snapshot, as a freshly mounted visual terminal does. */
async function rebuild(source: ScreenHistory): Promise<ScreenHistory> {
  await source.flush();
  const copy = make(source.cols, source.rows);
  copy.write(source.serialize());
  await copy.flush();
  return copy;
}

describe('ScreenHistory', () => {
  it('exposes the text of the current screen', async () => {
    const history = make();
    history.write('primeira linha\r\nsegunda linha');
    await history.flush();
    expect(history.screenText()).toBe('primeira linha\nsegunda linha');
  });

  it('a rebuilt terminal has the same screen and cursor', async () => {
    const history = make();
    history.write(
      '\x1b[2J\x1b[H\x1b[1;32m╭─ Agente ─╮\x1b[0m\r\n│ \x1b[38;5;208mtrabalhando\x1b[0m │\r\n╰──────────╯\x1b[2;5H',
    );
    const copy = await rebuild(history);
    expect(copy.screenText()).toBe(history.screenText());
    expect(copy.cursor()).toEqual(history.cursor());
    expect(copy.cursor()).toEqual({ x: 4, y: 1 });
  });

  it('the snapshot carries the colours', async () => {
    const history = make();
    history.write('normal \x1b[1;31mvermelho\x1b[0m \x1b[48;2;10;20;30mfundo\x1b[0m');
    await history.flush();
    const snapshot = history.serialize();
    expect(snapshot).toMatch(/\x1b\[(1;31|31;1)mvermelho/);
    expect(snapshot).toContain('48;2;10;20;30');
    // Serialising the copy gives the same thing: nothing was lost on the way.
    expect((await rebuild(history)).serialize()).toBe(snapshot);
  });

  it('keeps the scrollback, up to the limit', async () => {
    const history = make(40, 5, 20);
    for (let i = 1; i <= 200; i++) history.write(`linha ${i}\r\n`);
    await history.flush();
    const snapshot = history.serialize();
    expect(snapshot).toContain('linha 200');
    expect(snapshot).toContain('linha 180');
    expect(snapshot).not.toContain('linha 100\r');
    history.setScrollback(5);
    for (let i = 201; i <= 230; i++) history.write(`linha ${i}\r\n`);
    await history.flush();
    expect(history.serialize()).not.toContain('linha 215\r');
  });

  it('restores the alternate screen of a full-screen program', async () => {
    const history = make();
    history.write('antes\r\n\x1b[?1049h\x1b[2J\x1b[Htela cheia');
    const copy = await rebuild(history);
    expect(copy.screenText()).toBe('tela cheia');
    copy.write('\x1b[?1049l');
    await copy.flush();
    expect(copy.screenText()).toContain('antes');
  });

  it('stays in sync with the size of the visual terminal', async () => {
    const history = make(80, 24);
    history.write('x'.repeat(100));
    history.resize(120, 40);
    await history.flush();
    expect([history.cols, history.rows]).toEqual([120, 40]);
    expect(history.screenText()).toBe('x'.repeat(100));
    history.resize(1, 0);
    expect([history.cols, history.rows]).toEqual([2, 1]);
  });

  it('counts what is still to be parsed, for the backpressure', async () => {
    const history = make();
    let parsed = 0;
    history.write('a'.repeat(5000), () => parsed++);
    expect(history.pending).toBe(5000);
    await history.flush();
    expect(history.pending).toBe(0);
    expect(parsed).toBe(1);
  });
});
