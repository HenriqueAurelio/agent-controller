import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { TAIL_INTERVAL_MS, TailFeed } from '@core/sessions/TailFeed';

describe('TailFeed', () => {
  let ids: string[];
  let seq: Record<string, number>;
  let lines: Record<string, string[]>;
  let reads: string[];
  let batches: Record<string, string[]>[];
  let feed: TailFeed;

  const write = (id: string, ...text: string[]) => {
    seq[id] = (seq[id] ?? 0) + 1;
    lines[id] = text;
  };
  const tick = () => vi.advanceTimersByTimeAsync(TAIL_INTERVAL_MS);

  beforeEach(() => {
    vi.useFakeTimers();
    ids = ['a', 'b', 'c'];
    seq = {};
    lines = {};
    reads = [];
    batches = [];
    feed = new TailFeed({
      sessionIds: () => ids,
      outputSeq: (id) => seq[id] ?? 0,
      tail: async (id, count) => {
        reads.push(id);
        return (lines[id] ?? []).slice(-count);
      },
      onTails: (batch) => batches.push(batch),
    });
  });

  afterEach(() => {
    feed.dispose();
    vi.useRealTimers();
  });

  it('reads nothing while nobody watches', async () => {
    write('a', 'oi');
    await tick();
    await tick();
    expect(reads).toEqual([]);
    expect(batches).toEqual([]);
    expect(feed.watching).toBe(false);
  });

  it('starts with the lines of every session, then sends only the ones that changed', async () => {
    write('a', 'a1');
    write('b', 'b1', 'b2');
    expect(await feed.watch(true)).toEqual({ a: ['a1'], b: ['b1', 'b2'], c: [] });

    await tick();
    expect(batches).toEqual([]);

    write('b', 'b2', 'b3');
    await tick();
    expect(batches).toEqual([{ b: ['b2', 'b3'] }]);
  });

  it('batches what changed within a second into one event', async () => {
    await feed.watch(true);
    reads = [];
    for (let i = 0; i < 50; i++) write('a', `a${i}`);
    write('c', 'c1');
    await tick();
    expect(batches).toEqual([{ a: ['a49'], c: ['c1'] }]);
    // Fifty writes, one read each of the sessions that wrote.
    expect(reads.sort()).toEqual(['a', 'c']);
  });

  it('sends nothing when the output moved but the lines are the same', async () => {
    write('a', 'igual');
    await feed.watch(true);
    write('a', 'igual');
    await tick();
    expect(reads.filter((id) => id === 'a')).toHaveLength(2);
    expect(batches).toEqual([]);
  });

  it('stops reading when the overview closes, and forgets the sessions that went', async () => {
    await feed.watch(true);
    expect(await feed.watch(false)).toEqual({});
    reads = [];
    write('a', 'depois');
    await tick();
    expect(reads).toEqual([]);

    ids = ['a'];
    expect(await feed.watch(true)).toEqual({ a: ['depois'] });
  });

  it('a slow read is not stacked on another', async () => {
    let release!: () => void;
    const slow = new TailFeed({
      sessionIds: () => ['a'],
      outputSeq: () => seq.a ?? 0,
      tail: async () => {
        reads.push('a');
        await new Promise<void>((resolve) => (release = resolve));
        return ['x'];
      },
      onTails: (batch) => batches.push(batch),
    });
    const started = slow.watch(true);
    release();
    await started;
    reads = [];
    write('a', 'x');
    await tick();
    write('a', 'y');
    await tick();
    await tick();
    expect(reads).toEqual(['a']);
    release();
    await tick();
    slow.dispose();
  });
});
