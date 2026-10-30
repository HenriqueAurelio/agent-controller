import { describe, expect, it } from 'vitest';
import { FAILURE_OVERLAP, FailureScanner } from '@core/sessions/FailureScanner';

describe('FailureScanner', () => {
  it('finds an agent out of usage, and a provider that failed', () => {
    const scanner = new FailureScanner();
    expect(scanner.feed('a', 'Lendo arquivos…\r\n')).toBeNull();
    expect(scanner.feed('a', '\x1b[31mUsage limit reached\x1b[0m, resets at 5pm')).toBe('usage');
    expect(scanner.feed('b', 'stream error: network unavailable')).toBe('provider');
  });

  it('finds a message split between two chunks', () => {
    const scanner = new FailureScanner();
    expect(scanner.feed('a', 'x'.repeat(5000) + 'You have exhausted your to')).toBeNull();
    expect(scanner.feed('a', 'kens for today')).toBe('usage');
  });

  it('keeps the sessions apart', () => {
    const scanner = new FailureScanner();
    expect(scanner.feed('a', 'rate limit')).toBeNull();
    expect(scanner.feed('b', ' reached')).toBeNull();
  });

  it('tells a message once, not again with the next chunk', () => {
    const scanner = new FailureScanner();
    expect(scanner.feed('a', 'quota exhausted')).toBe('usage');
    expect(scanner.feed('a', '\r\n> ')).toBeNull();
  });

  it('reads each character about once, however long the output', () => {
    const scanner = new FailureScanner();
    // A long run of output with the words far apart is never a match...
    for (let i = 0; i < 200; i++) expect(scanner.feed('a', 'token ' + '.'.repeat(500))).toBeNull();
    // ...and what is kept of it does not grow.
    const kept = (scanner as unknown as { tails: Map<string, string> }).tails.get('a')!;
    expect(kept.length).toBe(FAILURE_OVERLAP);
  });

  it('forgets a session', () => {
    const scanner = new FailureScanner();
    scanner.feed('a', 'rate limit');
    scanner.forget('a');
    expect(scanner.feed('a', ' reached')).toBeNull();
  });
});
