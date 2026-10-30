export type FailureReason = 'usage' | 'provider';

const USAGE =
  /(?:token|usage|rate limit|quota).{0,80}(?:exhaust|limit|reached)|(?:exhaust|limit).{0,80}(?:token|usage|quota)/i;
const PROVIDER =
  /(?:authentication|unauthori[sz]ed|provider|network).{0,80}(?:error|failed|unavailable)|(?:error|failed|unavailable).{0,80}(?:authentication|provider|network)/i;

/**
 * How much of what came before a chunk is read again with it: more than the longest text one
 * match can span (two words and the 80 characters between them), so a message split between
 * two chunks is still found.
 */
export const FAILURE_OVERLAP = 256;

/**
 * Looks in the output of each session for an agent saying it ran out of usage or that its
 * provider failed. Each character is read about once: the new chunk and the end of the previous
 * one. (Reading the last 8 KB again on every chunk took most of the main process' time while
 * agents printed a lot.)
 */
export class FailureScanner {
  private readonly tails = new Map<string, string>();

  feed(id: string, chunk: string): FailureReason | null {
    const text = (this.tails.get(id) ?? '') + chunk;
    const reason = USAGE.test(text) ? 'usage' : PROVIDER.test(text) ? 'provider' : null;
    // A message found is not found again in the next chunk.
    this.tails.set(id, reason ? '' : text.slice(-FAILURE_OVERLAP));
    return reason;
  }

  forget(id: string): void {
    this.tails.delete(id);
  }
}
