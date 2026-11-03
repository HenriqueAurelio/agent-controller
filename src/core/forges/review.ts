// What a service gives to review a pull request inside the app, and takes back. Apart from
// `ForgeClient`: reading pull requests does not need it, and writing is a step of its own (ADR 0028).
import type { MergeOptions, PullReviewData, ReviewSubmission } from '@shared/pullReview';
import type { ForgeIssue } from '@shared/pulls';

/** A pull request as the review reads it, before the app adds what only it knows. */
export type ForgeReview = Omit<PullReviewData, 'key' | 'mine'>;

export interface ReviewClient {
  review(repo: string, number: number): Promise<ForgeReview>;
  /** Publishes the comments of the user, and the verdict, as one review. */
  submitReview(repo: string, number: number, submission: ReviewSubmission): Promise<void>;
  merge(repo: string, number: number, branch: string, options: MergeOptions): Promise<void>;
}

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
