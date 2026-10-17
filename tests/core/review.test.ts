import { describe, expect, it } from 'vitest';
import { parseReview } from '@core/handoff/review';
import { reviewText } from '@shared/reviewer';

describe('parseReview', () => {
  it('reads the format the prompt asks for', () => {
    const items = parseReview(
      [
        '- src/auth/login.ts:42 — O token não expira nunca.',
        '- src/auth/session.ts:7 — Falta tratar o erro de rede.',
        '- Falta um teste para o caso de senha vazia.',
      ].join('\n'),
    );
    expect(items).toEqual([
      { file: 'src/auth/login.ts', line: 42, text: 'O token não expira nunca.' },
      { file: 'src/auth/session.ts', line: 7, text: 'Falta tratar o erro de rede.' },
      { text: 'Falta um teste para o caso de senha vazia.' },
    ]);
  });

  it('is tolerant to the way an agent words a list (Claude Code)', () => {
    const items = parseReview(
      [
        '## Review of the turn',
        '',
        '1. **`src/db.ts:10-14`** - The query is built by concatenating the input.',
        '2. `src/db.ts` (line 30): The connection is never closed.',
        '3. src/util/format.ts L8 – Two branches do the same thing.',
        '',
        '* tests/db.test.ts: no test covers the empty result.',
      ].join('\n'),
    );
    expect(items).toEqual([
      { file: 'src/db.ts', line: 10, text: 'The query is built by concatenating the input.' },
      { file: 'src/db.ts', line: 30, text: 'The connection is never closed.' },
      { file: 'src/util/format.ts', line: 8, text: 'Two branches do the same thing.' },
      { file: 'tests/db.test.ts', text: 'no test covers the empty result.' },
    ]);
  });

  it('is tolerant to the way an agent words a list (Codex)', () => {
    const items = parseReview(
      [
        '- [ ] `src\\core\\store.ts:120` — Escrita não é atômica.',
        '    - detalhe: pode truncar o arquivo',
        '+ README.md: a seção de uso ficou desatualizada',
        '',
        'Nota geral sem arquivo, que continua',
        'na linha seguinte.',
      ].join('\n'),
    );
    expect(items).toEqual([
      {
        file: 'src/core/store.ts',
        line: 120,
        text: 'Escrita não é atômica.\n- detalhe: pode truncar o arquivo',
      },
      { file: 'README.md', text: 'a seção de uso ficou desatualizada' },
      { text: 'Nota geral sem arquivo, que continua\nna linha seguinte.' },
    ]);
  });

  it('does not take a word before a colon for a file', () => {
    expect(parseReview('- Atenção: isto pode quebrar. e.g.: o login')).toEqual([
      { text: 'Atenção: isto pode quebrar. e.g.: o login' },
    ]);
  });

  it('keeps a code block inside the observation it belongs to', () => {
    const items = parseReview(
      [
        '- a.ts:1 — troque por:',
        '```ts',
        '- not an item',
        'const x = 1;',
        '```',
        '- b.ts:2 — ok',
      ].join('\n'),
    );
    expect(items).toHaveLength(2);
    expect(items[0]!.text).toContain('- not an item');
    expect(items[1]).toEqual({ file: 'b.ts', line: 2, text: 'ok' });
  });

  it('accepts files with CRLF and an answer that says there is nothing', () => {
    expect(parseReview('- a.ts:3 — x\r\n- b.ts — y\r\n')).toHaveLength(2);
    expect(parseReview('Sem observações.')).toEqual([]);
    expect(parseReview('No observations.\n')).toEqual([]);
    expect(parseReview('')).toEqual([]);
  });
});

describe('reviewText', () => {
  it('writes the observations back in the format they were asked in', () => {
    expect(
      reviewText([
        { file: 'a.ts', line: 3, text: 'x' },
        { file: 'b.ts', text: 'y' },
        { text: 'z' },
      ]),
    ).toBe('- a.ts:3 — x\n- b.ts — y\n- z');
  });
});
