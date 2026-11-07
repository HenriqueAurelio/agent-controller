// What a service gives to review a pull request inside the app, and takes back. Apart from
// `ForgeClient`: reading pull requests does not need it, and writing is a step of its own (ADR 0028).
import type {
  MergeOptions,
  NewPull,
  OpenedPull,
  PullReviewData,
  ReviewSubmission,
} from '@shared/pullReview';
import type { ForgeIssue } from '@shared/pulls';

/** A pull request as the review reads it, before the app adds what only it knows. */
export type ForgeReview = Omit<PullReviewData, 'key' | 'mine'>;

export interface ReviewClient {
  review(repo: string, number: number): Promise<ForgeReview>;
  /** Publishes the comments of the user, and the verdict, as one review. */
  submitReview(repo: string, number: number, submission: ReviewSubmission): Promise<void>;
  merge(repo: string, number: number, branch: string, options: MergeOptions): Promise<void>;
}

/** Opens a pull request from a branch already pushed (ADR 0029). */
export interface PullCreator {
  createPull(repo: string, pull: NewPull): Promise<OpenedPull>;
}

export const isPullCreator = (client: unknown): client is PullCreator =>
  !!client && typeof (client as PullCreator).createPull === 'function';

/** The open issues of a repository, for cards of the task board. */
export interface IssueClient {
  issues(repo: string): Promise<ForgeIssue[]>;
}

export const isIssueClient = (client: unknown): client is IssueClient =>
  !!client && typeof (client as IssueClient).issues === 'function';

export const isReviewClient = (client: unknown): client is ReviewClient =>
  !!client &&
  typeof (client as ReviewClient).review === 'function' &&
  typeof (client as ReviewClient).submitReview === 'function' &&
  typeof (client as ReviewClient).merge === 'function';

/**
 * The conversations still open on a pull request that someone other than `me` took part in, as a
 * list for the agent: where, who and what. Resolved ones are done; one only the user wrote in is
 * a note of theirs, not a request.
 */
export function openThreadsText(data: PullReviewData, me: string): string {
  const self = me.toLowerCase();
  const lines: string[] = [];
  for (const thread of data.threads) {
    if (thread.resolved || thread.comments.length === 0) continue;
    if (!thread.comments.some((c) => c.author.toLowerCase() !== self)) continue;
    const where = thread.path ? `${thread.path}${thread.line ? `:${thread.line}` : ''}` : '';
    thread.comments.forEach((comment, index) => {
      const body = comment.body.trim().replace(/\r?\n/g, '\n    ');
      lines.push(
        index === 0
          ? `- ${where ? `${where} — ` : ''}${comment.author}: ${body}`
          : `  - ${comment.author}: ${body}`,
      );
    });
  }
  return lines.join('\n');
}
