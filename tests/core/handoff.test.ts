import fs from 'node:fs';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { HandoffService, REVIEW_FILE } from '@core/handoff/HandoffService';
import { removeDir, sleep, tempDir } from './helpers';

describe('HandoffService', () => {
  let root: string;
  let service: HandoffService;

  beforeEach(() => {
    root = tempDir('ac handoff ação-');
    service = new HandoffService({ root, pollMs: 20, stableMs: 150 });
  });
  afterEach(() => removeDir(root));

  it('writes the diff and clears an answer left from the request before', async () => {
    const first = await service.prepare('s1', 'diff um');
    fs.writeFileSync(first.reviewFile, '- a.ts — velha');
    const again = await service.prepare('s1', 'diff dois');
    expect(fs.readFileSync(again.diffFile, 'utf8')).toBe('diff dois');
    expect(fs.existsSync(again.reviewFile)).toBe(false);
    expect(path.basename(again.reviewFile)).toBe(REVIEW_FILE);
    expect(path.dirname(again.diffFile)).toBe(path.join(root, 's1'));
  });

  it('refuses an id that is not a plain name', () => {
    expect(() => service.files('../fora')).toThrow();
    expect(() => service.files('a/b')).toThrow();
  });

  it('sees the answer arrive', async () => {
    const files = await service.prepare('s1', 'd');
    const waiting = service.waitForReview('s1', { timeoutMs: 5000 });
    await sleep(60);
    fs.writeFileSync(files.reviewFile, '- a.ts:1 — x\n');
    expect(await waiting).toBe('arrived');
    expect(await service.read('s1')).toBe('- a.ts:1 — x\n');
  });

  it('gives up when the answer does not come', async () => {
    await service.prepare('s1', 'd');
    expect(await service.waitForReview('s1', { timeoutMs: 200 })).toBe('timeout');
    expect(await service.read('s1')).toBeNull();
  });

  it('waits for an answer written in pieces to be finished', async () => {
    const files = await service.prepare('s1', 'd');
    const waiting = service.waitForReview('s1', { timeoutMs: 5000 });
    let outcome: string | null = null;
    void waiting.then((value) => (outcome = value));
    // Each piece comes sooner than the file is taken for finished.
    fs.writeFileSync(files.reviewFile, '- a.ts:1 — primeira\n');
    for (const piece of ['- b.ts:2 — segunda\n', '- c.ts:3 — terceira\n']) {
      await sleep(80);
      expect(outcome).toBeNull();
      fs.appendFileSync(files.reviewFile, piece);
    }
    expect(await waiting).toBe('arrived');
    expect((await service.read('s1'))!.trim().split('\n')).toHaveLength(3);
  });

  it('an empty file is not an answer yet', async () => {
    const files = await service.prepare('s1', 'd');
    fs.writeFileSync(files.reviewFile, '');
    expect(await service.waitForReview('s1', { timeoutMs: 400 })).toBe('timeout');
  });

  it('stops waiting when asked to', async () => {
    await service.prepare('s1', 'd');
    const control = new AbortController();
    const waiting = service.waitForReview('s1', { timeoutMs: 5000, signal: control.signal });
    await sleep(50);
    control.abort();
    expect(await waiting).toBe('cancelled');
  });

  it('removes the handoffs older than 30 days and only those', async () => {
    await service.prepare('velha', 'd');
    await service.prepare('nova', 'd');
    fs.writeFileSync(path.join(root, 'solto.txt'), 'não é uma passagem');
    const old = new Date(Date.now() - 31 * 24 * 60 * 60 * 1000);
    fs.utimesSync(path.join(root, 'velha'), old, old);
    expect(await service.cleanOld()).toBe(1);
    expect(fs.readdirSync(root).sort()).toEqual(['nova', 'solto.txt']);
    expect(await new HandoffService({ root: path.join(root, 'nao-existe') }).cleanOld()).toBe(0);
  });
});
