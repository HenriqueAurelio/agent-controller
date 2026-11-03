import fs from 'node:fs';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { expandPrompt, promptVariables } from '@core/prompts/expand';
import { ReviewStore } from '@core/review/ReviewStore';
import { buildReviewText } from '@core/review/reviewText';
import { translate } from '@shared/i18n';
import { factoryPrompts } from '@shared/prompts';
import {
  APPLY_REVIEW_PROMPT_ID,
  isStale,
  REVIEW_COMMENTS_LIMIT,
  REVIEW_SNIPPET_LIMIT,
  type ReviewComment,
} from '@shared/review';
import { removeDir, tempDir } from './helpers';

const comment = (over: Partial<ReviewComment>): ReviewComment => ({
  id: 'c1',
  file: 'src/a.ts',
  startLine: 1,
  endLine: 1,
  snippet: '',
  text: 'Ajustar.',
  createdAt: 1,
  ...over,
});

describe('buildReviewText', () => {
  it('writes one comment with its place, code and text', () => {
    const text = buildReviewText([
      comment({
        startLine: 12,
        endLine: 12,
        snippet: 'if (size > MAX) throw x;',
        text: 'Use a constante.',
      }),
    ]);
    expect(text).toBe(
      [
        '1. src/a.ts:12',
        '   ```',
        '   if (size > MAX) throw x;',
        '   ```',
        '   Use a constante.',
      ].join('\n'),
    );
  });

  it('groups by file in the order they were commented, and sorts each file by line', () => {
    const text = buildReviewText([
      comment({ id: 'a', file: 'b.ts', startLine: 30, endLine: 30, text: 'b30', createdAt: 1 }),
      comment({ id: 'b', file: 'a.ts', startLine: 5, endLine: 9, text: 'a5', createdAt: 2 }),
      comment({ id: 'c', file: 'b.ts', startLine: 3, endLine: 3, text: 'b3', createdAt: 3 }),
    ]);
    const heads = text.split('\n').filter((line) => /^\d+\. /.test(line));
    expect(heads).toEqual(['1. b.ts:3', '2. b.ts:30', '3. a.ts:5-9']);
  });

  it('fences code that has backticks with a longer fence', () => {
    const text = buildReviewText([comment({ snippet: 'const s = ```x```;' })]);
    expect(text).toContain('   ````\n   const s = ```x```;\n   ````');
  });

  it('says how many were left out when the text would pass the limit', () => {
    const many = Array.from({ length: 50 }, (_, i) =>
      comment({
        id: `c${i}`,
        startLine: i + 1,
        endLine: i + 1,
        text: 'x'.repeat(100),
        createdAt: i,
      }),
    );
    const text = buildReviewText(many, 1000);
    expect(text.length).toBeLessThan(1100);
    expect(text.trim().split('\n').pop()).toMatch(/^\(\+\d+\)$/);
  });
});

describe('isStale', () => {
  it('compares the lines with the snippet kept', () => {
    const c = comment({ startLine: 2, endLine: 3, snippet: 'b\nc' });
    expect(isStale(c, ['a', 'b', 'c'])).toBe(false);
    expect(isStale(c, ['a', 'x', 'b', 'c'])).toBe(true);
    expect(isStale(comment({ snippet: '' }), ['anything'])).toBe(false);
  });
});

describe('ReviewStore', () => {
  let dir = '';
  afterEach(() => dir && removeDir(dir));

  const open = () => {
    dir ||= tempDir();
    let n = 0;
    return new ReviewStore({
      file: path.join(dir, 'review.json'),
      now: () => ++n,
      newId: () => `id-${n + 1}`,
    });
  };

  it('keeps the comments of each session apart and on disk', () => {
    const store = open();
    const changes: string[] = [];
    store.on('changed', (id, list) => changes.push(`${id}:${list.length}`));
    store.add('s1', {
      file: 'src\\x.ts',
      startLine: 3,
      endLine: 4,
      snippet: 'a\nb',
      text: ' Corrigir ',
    });
    store.add('s2', { file: './y.ts', startLine: 1, endLine: 1, snippet: '', text: 'Outro' });
    expect(changes).toEqual(['s1:1', 's2:1']);

    const again = open();
    const [first] = again.list('s1');
    expect(first).toMatchObject({ file: 'src/x.ts', startLine: 3, endLine: 4, text: 'Corrigir' });
    expect(again.list('s2')[0]!.file).toBe('y.ts');
  });

  it('edits, removes and clears only what was asked', () => {
    const store = open();
    const a = store.add('s', { file: 'a.ts', startLine: 1, endLine: 1, snippet: '', text: 'a' });
    const b = store.add('s', { file: 'a.ts', startLine: 2, endLine: 2, snippet: '', text: 'b' });
    store.add('s', { file: 'a.ts', startLine: 3, endLine: 3, snippet: '', text: 'c' });
    store.update('s', a.id, 'a2');
    expect(store.list('s').map((c) => c.text)).toEqual(['a2', 'b', 'c']);
    store.remove('s', b.id);
    // Only the comments that went to the agent leave: one written meanwhile stays.
    store.clear('s', [a.id]);
    expect(store.list('s').map((c) => c.text)).toEqual(['c']);
    store.clear('s');
    expect(store.list('s')).toEqual([]);
  });

  it('refuses what a comment cannot be', () => {
    const store = open();
    const add = (over: object) =>
      store.add('s', { file: 'a.ts', startLine: 1, endLine: 1, snippet: '', text: 'x', ...over });
    expect(() => add({ text: '   ' })).toThrow();
    expect(() => add({ startLine: 0 })).toThrow();
    expect(() => add({ startLine: 5, endLine: 4 })).toThrow();
    expect(() => add({ file: '../fora.ts' })).toThrow();
    expect(() => add({ file: '/etc/passwd' })).toThrow();
    expect(() => add({ file: 'C:/Windows/x' })).toThrow();
    expect(() => store.update('s', 'nope', 'x')).toThrow();
    expect(add({ snippet: 'y'.repeat(REVIEW_SNIPPET_LIMIT + 50) }).snippet).toHaveLength(
      REVIEW_SNIPPET_LIMIT,
    );
  });

  it('stops at the limit of comments of a session', () => {
    const store = open();
    for (let i = 0; i < REVIEW_COMMENTS_LIMIT; i++) {
      store.add('s', { file: 'a.ts', startLine: i + 1, endLine: i + 1, snippet: '', text: 't' });
    }
    expect(() =>
      store.add('s', { file: 'a.ts', startLine: 1, endLine: 1, snippet: '', text: 't' }),
    ).toThrow();
  });

  it('forgets a removed session, and survives a broken file', () => {
    const store = open();
    store.add('s', { file: 'a.ts', startLine: 1, endLine: 1, snippet: '', text: 'x' });
    store.forget('s');
    expect(open().list('s')).toEqual([]);

    fs.writeFileSync(path.join(dir, 'review.json'), '{ not json');
    fs.rmSync(path.join(dir, 'review.json.bak'), { force: true });
    expect(open().list('s')).toEqual([]);
  });
});

describe('the prompt "Apply the review"', () => {
  it('is a factory prompt in every language, and fills {revisao}', () => {
    for (const language of ['pt-BR', 'en', 'es'] as const) {
      const prompt = factoryPrompts(language).find((p) => p.id === APPLY_REVIEW_PROMPT_ID);
      expect(prompt?.name).toBe(translate(language, 'prompts.factory.applyReview.name'));
      expect(promptVariables(prompt!.text)).toEqual(['review']);
      expect(expandPrompt(prompt!.text, { review: 'LISTA' })).toContain('LISTA');
    }
    expect(expandPrompt('{revisão} {review}', { review: 'x' })).toBe('x x');
  });
});
