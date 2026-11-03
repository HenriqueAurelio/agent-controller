// Comments the user leaves on lines of the diff, kept per session until they go to the agent as
// one prompt.

export interface ReviewComment {
  id: string;
  /** Path of the file, relative to the folder of the session, with forward slashes. */
  file: string;
  /** First and last line commented, 1-based, on the side of the working tree. */
  startLine: number;
  endLine: number;
  /** The commented lines as they were, so the agent finds the place even after it moved. */
  snippet: string;
  text: string;
  createdAt: number;
}

export interface NewReviewComment {
  file: string;
  startLine: number;
  endLine: number;
  snippet: string;
  text: string;
}

/** How many comments one session may hold: a review, not a second copy of the code. */
export const REVIEW_COMMENTS_LIMIT = 200;
export const REVIEW_COMMENT_TEXT_LIMIT = 4000;
/** The snippet kept with a comment is cut here; the line numbers still say where it is. */
export const REVIEW_SNIPPET_LIMIT = 1200;
/** The highest line number taken from the renderer. */
export const REVIEW_LINE_LIMIT = 10_000_000;
/** What `{revisao}` may put in a prompt. */
export const REVIEW_TEXT_LIMIT = 40_000;

/** The factory prompt that sends the review: `{revisao}` is the list of comments. */
export const APPLY_REVIEW_PROMPT_ID = 'apply-review';

/** The comments of a file, in the order of their lines. */
export function commentsOf(comments: readonly ReviewComment[], file: string): ReviewComment[] {
  return comments
    .filter((c) => c.file === file)
    .sort((a, b) => a.startLine - b.startLine || a.createdAt - b.createdAt);
}

/** The commented lines no longer read as they did: the code moved or changed under the comment. */
export function isStale(comment: ReviewComment, lines: readonly string[]): boolean {
  if (!comment.snippet) return false;
  const now = lines.slice(comment.startLine - 1, comment.endLine).join('\n');
  // A cut snippet is compared on what was kept of it.
  return !now.startsWith(comment.snippet) && now !== comment.snippet;
}
