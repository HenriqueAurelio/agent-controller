// The history of a file in the panel: its commits, and who last changed a line.

export interface FileCommit {
  sha: string;
  author: string;
  /** ISO 8601. */
  date: string;
  subject: string;
}

/** Who last changed a line; `uncommitted` when it is not in any commit yet. */
export type LineBlame =
  | { uncommitted: true }
  | { uncommitted: false; sha: string; author: string; date: string; subject: string };
