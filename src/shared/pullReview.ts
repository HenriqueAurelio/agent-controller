// Reviewing a pull request inside the app: its changes, the comments already on it, and what the
// user writes back (comments, approval, merge). The app writes to the service only when the user
// clicks to (ADR 0028).
import type { DiffHunk } from './git';

export type PullFileStatus = 'added' | 'modified' | 'removed' | 'renamed';

export interface PullFile {
  path: string;
  oldPath?: string;
  status: PullFileStatus;
  hunks: DiffHunk[];
  /** The service sent no patch: binary, or too large to show. */
  noPatch?: boolean;
}

export interface PullComment {
  author: string;
  body: string;
  /** ISO 8601. */
  createdAt: string;
}

/** A conversation on a line of the pull request, or about the whole of it (`path` null). */
export interface PullThread {
  id: string;
  path: string | null;
  /** The line on the new side; null when the line no longer exists (outdated) or for none. */
  line: number | null;
  /** The line is on the old side: a removed line. */
  oldSide?: boolean;
  resolved: boolean;
  comments: PullComment[];
}

export type MergeState = 'ready' | 'blocked' | 'conflict' | 'draft' | 'unknown' | 'merged';

export interface PullReviewData {
  key: string;
  title: string;
  url: string;
  author: string;
  branch: string;
  base: string;
  /** The commit the comments are written against. */
  headSha: string;
  files: PullFile[];
  threads: PullThread[];
  /** More files changed than the review carries. */
  truncated: boolean;
  merge: MergeState;
  /** The pull request is the user's own: the service does not let them approve it. */
  mine: boolean;
}

/** A comment written in the app, on a line, before the review is published. */
export interface ReviewDraftComment {
  path: string;
  line: number;
  /** On a removed line: the line of the old side. */
  oldSide?: boolean;
  body: string;
}

/** COMMENT only comments; APPROVE and REQUEST_CHANGES also give the verdict. */
export type ReviewVerdict = 'COMMENT' | 'APPROVE' | 'REQUEST_CHANGES';

export interface ReviewSubmission {
  verdict: ReviewVerdict;
  /** The text of the review as a whole; may be empty when there are line comments. */
  body: string;
  comments: ReviewDraftComment[];
  /** The commit the user reviewed: a pull request that moved since is refused by the service. */
  headSha: string;
}

export interface MergeOptions {
  /** Squash the commits into one, as the Maestro does. */
  squash: boolean;
  deleteBranch: boolean;
}

export const REVIEW_BODY_LIMIT = 20_000;
export const REVIEW_DRAFTS_LIMIT = 100;
/** Files read of a pull request. */
export const PULL_FILES_LIMIT = 300;
