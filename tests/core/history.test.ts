import { describe, expect, it } from 'vitest';
import { ScreenHistory, TAIL_LINE_LIMIT } from '@core/history/ScreenHistory';

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

  describe('tail', () => {
    it('gives the last lines as plain text, without colours nor empty lines', async () => {
      const history = make(60, 10);
      for (let i = 1; i <= 30; i++) history.write(`\x1b[32mlinha ${i}\x1b[0m\r\n\r\n`);
      await history.flush();
      expect(history.tail(3)).toEqual(['linha 28', 'linha 29', 'linha 30']);
      expect(history.tail(0)).toEqual([]);
    });

    it('leaves out the frames, rules and spinners of a TUI, and keeps the text inside a box', async () => {
      const history = make(40, 12);
      history.write(
        [
          '\x1b[2J\x1b[H╭──────────────────────────╮',
          '│ \x1b[1mEditando src/app.ts\x1b[0m       │',
          '│                          │',
          '╰──────────────────────────╯',
          '────────────────────────────',
          '  ⠋  ',
          '> rodando os testes',
          '+-------+------+',
          '| ok    |  12  |',
          '========',
        ].join('\r\n'),
      );
      await history.flush();
      expect(history.tail(6)).toEqual(['Editando src/app.ts', '> rodando os testes', 'ok  |  12']);
    });

    it('joins a line the terminal wrapped, and cuts one too long for a glance', async () => {
      const history = make(20, 5);
      const long = 'abcdefghij'.repeat(5);
      history.write(`${long}\r\nfim`);
      await history.flush();
      expect(history.tail(2)).toEqual([long, 'fim']);

      const huge = make(80, 5, 100);
      huge.write('x'.repeat(TAIL_LINE_LIMIT + 50));
      await huge.flush();
      const [line] = huge.tail(1);
      expect([...line!]).toHaveLength(TAIL_LINE_LIMIT);
      expect(line!.endsWith('…')).toBe(true);
    });

    it('keeps wide characters whole', async () => {
      const history = make(20, 5);
      history.write('日本語のテキスト 🚀 ok\r\n終わり');
      await history.flush();
      expect(history.tail(2)).toEqual(['日本語のテキスト 🚀 ok', '終わり']);
    });

    it('does not walk the whole scrollback when there is little to show', async () => {
      const history = make(40, 5, 5000);
      history.write('primeira\r\n');
      for (let i = 0; i < 3000; i++) history.write('────\r\n');
      await history.flush();
      // The only readable line is too far up for a glance.
      expect(history.tail(6)).toEqual([]);
    });
  });
});
