// The way of a copy's branch to a pull request (ADR 0029): what the dialog shows before pushing.
import type { TaskIssue } from './tasks';

export interface BranchInfo {
  branch: string;
  base: string;
  /** Commits of the branch the base does not have, and their subjects, the oldest first. */
  ahead: number;
  subjects: string[];
  /** Files changed and not committed: a push leaves them behind. */
  dirty: number;
  /** The remote the branch goes to; null without one. */
  remote: string | null;
  /** The repository of that remote on GitHub or GitLab; null when it is neither. */
  repo: string | null;
  /** What the dialog starts with: the card's title, or the first commit. */
  title: string;
  body: string;
  /** The issue of the card the session came from, which the pull request closes. */
  issue: TaskIssue | null;
}

export interface OpenPullInput {
  title: string;
  body: string;
  draft: boolean;
}

/** The text the pull request starts with: the commits, and the issue it closes. */
export function pullBody(subjects: readonly string[], issue: TaskIssue | null): string {
  const lines = subjects.map((s) => `- ${s}`);
  if (issue) lines.push('', `Closes ${issue.ref}`);
  return lines.join('\n').trim();
}
