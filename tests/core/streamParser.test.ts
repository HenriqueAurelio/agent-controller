import { describe, expect, it } from 'vitest';
import { CLAUDE_CODE, CODEX } from '@core/agents/profiles';
import { StreamParser, type StreamEvent } from '@core/signals/StreamParser';
import { classifyTitle, parseTitle } from '@core/signals/title';

const feedAll = (chunks: string[]): StreamEvent[] => {
  const parser = new StreamParser();
  return chunks.flatMap((c) => parser.feed(c));
};
const titles = (events: StreamEvent[]) =>
  events.flatMap((e) => (e.type === 'title' ? [e.title] : []));

describe('StreamParser', () => {
  it('reads OSC 0 and OSC 2 titles, with BEL or ST terminators', () => {
    const events = feedAll(['\x1b]0;um\x07texto\x1b]2;dois\x1b\\mais\x1b]1;icone\x07']);
    expect(titles(events)).toEqual(['um', 'dois']);
  });

  it('does not report the BEL that terminates an OSC as a bell', () => {
    const events = feedAll(['\x1b]0;t\x07', 'a\x07b']);
    expect(events.filter((e) => e.type === 'bell')).toHaveLength(1);
  });

  it('survives a sequence split at every possible position', () => {
    const stream = 'abc\x1b]0;⠋ agent-controller\x07def\x1b]2;[ ! ] Action Required\x1b\\ghi\x07';
    for (let cut = 0; cut <= stream.length; cut++) {
      const events = feedAll([stream.slice(0, cut), stream.slice(cut)]);
      expect(titles(events), `cut at ${cut}`).toEqual([
        '⠋ agent-controller',
        '[ ! ] Action Required',
      ]);
      expect(events.filter((e) => e.type === 'bell')).toHaveLength(1);
    }
  });

  it('survives one character per chunk', () => {
    const stream = '\x1b[31mx\x1b]0;✳ Claude Code\x07\x1b[0m';
    expect(titles(feedAll([...stream]))).toEqual(['✳ Claude Code']);
  });

  it('reads OSC 9 and OSC 777 notifications, but not the OSC 9;4 progress report', () => {
    const events = feedAll([
      '\x1b]9;Turno concluído\x07\x1b]9;4;1;50\x07\x1b]777;notify;Codex;Precisa de você\x07',
    ]);
    expect(events).toEqual([
      { type: 'notification', text: 'Turno concluído' },
      { type: 'notification', text: 'Codex: Precisa de você' },
    ]);
  });

  it('ignores other OSC codes and CSI sequences', () => {
    const events = feedAll([
      '\x1b]10;?\x07\x1b]8;;https://x.dev\x1b\\link\x1b]8;;\x1b\\\x1b[2J\x1b[H',
    ]);
    expect(events).toEqual([]);
  });

  it('abandons an OSC interrupted by another escape sequence', () => {
    const events = feedAll(['\x1b]0;incompleto\x1b[31mvermelho\x1b]0;certo\x07']);
    expect(titles(events)).toEqual(['certo']);
  });

  it('gives up on an endless OSC without buffering it', () => {
    const parser = new StreamParser();
    expect(parser.feed('\x1b]0;' + 'x'.repeat(20000))).toEqual([]);
    expect(titles(parser.feed('\x07\x1b]0;depois\x07'))).toEqual(['depois']);
  });
});

describe('title', () => {
  it('separates the activity indicator from the text', () => {
    expect(parseTitle('⠋ agent-controller')).toEqual({ indicator: '⠋', text: 'agent-controller' });
    expect(parseTitle('✳ Claude Code')).toEqual({ indicator: '✳', text: 'Claude Code' });
    expect(parseTitle('[ ! ] Action Required')).toEqual({
      indicator: '[ ! ]',
      text: 'Action Required',
    });
    expect(parseTitle('agent-controller')).toEqual({ indicator: '', text: 'agent-controller' });
    expect(parseTitle('C:\\Users\\dev')).toEqual({ indicator: '', text: 'C:\\Users\\dev' });
    expect(parseTitle('~/projetos/app')).toEqual({ indicator: '', text: '~/projetos/app' });
  });

  // Titles as recorded in the sessions of 2026-10-12 (ADR 0011).
  it.each([
    ['⠋ agent-controller', 'working'],
    ['⠙ agent-controller', 'working'],
    ['⣾ Corrigir teste', 'working'],
    ['[ ! ] Action Required', 'waiting'],
    ['[ . ] Action Required', 'waiting'],
    ['agent-controller', 'idle'],
    ['Corrigir teste', 'idle'],
  ] as const)('Codex: %s → %s', (title, expected) => {
    expect(classifyTitle(CODEX.signals.title, title)).toBe(expected);
  });

  it.each([
    ['◐ Corrigir teste', 'working'],
    ['◑ Corrigir teste', 'working'],
    ['✳ Corrigir teste', 'idle'],
    ['✳ Claude Code', 'idle'],
    ['Claude Code', 'idle'],
  ] as const)('Claude Code: %s → %s', (title, expected) => {
    expect(classifyTitle(CLAUDE_CODE.signals.title, title)).toBe(expected);
  });
});
