import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { SilenceDetector } from '@core/signals/SilenceDetector';

beforeEach(() => vi.useFakeTimers({ now: 0 }));
afterEach(() => vi.useRealTimers());

describe('SilenceDetector', () => {
  it('fires once, N seconds after the last output', () => {
    const fired: number[] = [];
    const detector = new SilenceDetector(20000, (at) => fired.push(at));
    detector.activity();
    vi.advanceTimersByTime(19999);
    expect(fired).toEqual([]);
    vi.advanceTimersByTime(1);
    expect(fired).toEqual([20000]);
    vi.advanceTimersByTime(120000);
    expect(fired).toHaveLength(1);
  });

  it('keeps being pushed back while output arrives', () => {
    const fired: number[] = [];
    const detector = new SilenceDetector(20000, (at) => fired.push(at));
    for (let t = 0; t < 60000; t += 5000) {
      detector.activity();
      vi.advanceTimersByTime(5000);
    }
    expect(fired).toEqual([]);
    vi.advanceTimersByTime(20000);
    expect(fired).toEqual([75000]);
  });

  it('does not fire without previous activity', () => {
    const fired: number[] = [];
    new SilenceDetector(1000, (at) => fired.push(at));
    vi.advanceTimersByTime(60000);
    expect(fired).toEqual([]);
  });

  it('fires again after new activity', () => {
    const fired: number[] = [];
    const detector = new SilenceDetector(1000, (at) => fired.push(at));
    detector.activity();
    vi.advanceTimersByTime(1000);
    detector.activity();
    vi.advanceTimersByTime(1000);
    expect(fired).toEqual([1000, 2000]);
  });

  it('the window is configurable, and 0 turns it off', () => {
    const fired: number[] = [];
    const detector = new SilenceDetector(20000, (at) => fired.push(at));
    detector.activity();
    detector.setWindow(3000);
    vi.advanceTimersByTime(3000);
    expect(fired).toEqual([3000]);
    detector.setWindow(0);
    detector.activity();
    vi.advanceTimersByTime(600000);
    expect(fired).toHaveLength(1);
  });

  it('dispose cancels a pending notice', () => {
    const fired: number[] = [];
    const detector = new SilenceDetector(1000, (at) => fired.push(at));
    detector.activity();
    detector.dispose();
    vi.advanceTimersByTime(5000);
    expect(fired).toEqual([]);
  });
});
