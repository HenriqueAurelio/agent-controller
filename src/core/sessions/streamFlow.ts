// How the output of a session reaches the terminal on screen: how soon, and when the PTY is held
// back because the renderer is behind.

// The terminal in sight is fed once per frame at most. Mounted terminals out of sight are not
// fed at all: they catch up from the history when shown again.
export const FOREGROUND_FLUSH_MS = 8;
export const FLUSH_NOW_CHARS = 128 * 1024;
/** Output up to this size, soon after a key, is taken for its echo. */
export const ECHO_MAX_CHARS = 1024;
/** How soon after a key its echo is expected. */
export const ECHO_WINDOW_MS = 100;

/** When output arrives on a stream, and how much is waiting. */
export interface FlushTiming {
  now: number;
  lastFlushAt: number;
  lastInputAt: number;
  pendingChars: number;
}

/**
 * How long new output waits before it is sent to the terminal on screen. A small piece right
 * after a key (its echo, most of the time) goes at once. Anything else waits for the batch: an
 * agent's spinner sent piece by piece would cost a draw each, measured at 4% of a core more with
 * 6 busy sessions.
 */
export function flushDelay(t: FlushTiming): number {
  const echo =
    t.now - t.lastInputAt <= ECHO_WINDOW_MS &&
    t.now - t.lastFlushAt >= FOREGROUND_FLUSH_MS &&
    t.pendingChars <= ECHO_MAX_CHARS;
  return echo ? 0 : FOREGROUND_FLUSH_MS;
}

/**
 * Between a paste and the Enter that sends it. Where ConPTY drops the paste markers, an Enter in
 * the same burst of keys reads as a line break inside the paste.
 */
export const SUBMIT_DELAY_MS = 200;
/** After output, how long to wait before reading the screen for the menu of a permission. */
export const MENU_CHECK_MS = 80;
// Backpressure thresholds, in characters waiting on the renderer plus the history.
export const HIGH_WATER = 256 * 1024;
export const LOW_WATER = 32 * 1024;
