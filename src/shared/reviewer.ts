// A session can have a reviewer: another session that reads what a turn changed and writes its
// observations to a file, which the app shows on the first one (ADR 0023).
import type { AgentProfileId } from './session';

/** When the reviewer is asked: at the end of each turn that passed the checks, or on demand. */
export type ReviewTrigger = 'turn' | 'manual';

export const REVIEW_TRIGGERS: readonly ReviewTrigger[] = ['turn', 'manual'];

/**
 * `idle`: nothing asked yet. `preparing`: the diff is being written and the reviewer started.
 * `waiting`: the reviewer has the request and the file has not come. `ready`: the observations
 * are there. `timedOut`: the reviewer did not write the file in time. `failed`: the request could
 * not be made (`ReviewResult.error` says why).
 */
export type ReviewState = 'idle' | 'preparing' | 'waiting' | 'ready' | 'timedOut' | 'failed';

/** What the list shows of the reviewer of a session. */
export interface ReviewerSummary {
  reviewerId: string;
  trigger: ReviewTrigger;
  state: ReviewState;
  /** Observations in the file, when `ready`. */
  count?: number;
}

export interface ReviewItem {
  /** Relative to the folder of the session, with `/`. */
  file?: string;
  line?: number;
  text: string;
}

export interface ReviewResult {
  state: ReviewState;
  items: ReviewItem[];
  /** Epoch ms of the request the observations answer. */
  requestedAt?: number;
  /** Why the request failed, as the user reads it. */
  error?: string;
}

/** Who reviews: a session that exists, or a new one, in the same folder, that only reads. */
export type ReviewerChoice =
  | { kind: 'existing'; sessionId: string }
  | { kind: 'new'; profile: AgentProfileId; command?: string };

export interface ReviewerSetInput {
  sessionId: string;
  trigger: ReviewTrigger;
  /** Null: the session no longer has a reviewer. */
  reviewer: ReviewerChoice | null;
}

/** The id of the saved prompt the reviewer is asked with, if the user kept it in their list. */
export const REVIEW_PROMPT_ID = 'review-turn';

/** The diff of the turn is written to a file up to this size; above it the file lists the files. */
export const REVIEW_DIFF_LIMIT = 200_000;
/** The file of observations is read up to this size. */
export const REVIEW_FILE_LIMIT = 200_000;
export const REVIEW_ITEMS_LIMIT = 200;
export const REVIEW_TEXT_LIMIT = 4000;
/** After this long without the file, the app gives up and says so. */
export const REVIEW_TIMEOUT_MS = 15 * 60 * 1000;
/** Days a handoff folder is kept. */
export const HANDOFF_DAYS = 30;

/** What goes back to the main agent: one line for each observation chosen. */
export function reviewText(items: readonly ReviewItem[]): string {
  return items
    .map((item) => {
      const place = item.file ? `${item.file}${item.line ? `:${item.line}` : ''} — ` : '';
      return `- ${place}${item.text}`;
    })
    .join('\n');
}
