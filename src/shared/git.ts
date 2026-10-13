export type ChangeKind = 'added' | 'modified' | 'removed' | 'renamed' | 'untracked' | 'conflict';

export interface FileChange {
  /** Path relative to the repository root, with forward slashes. */
  path: string;
  /** Previous path, for renames. */
  origPath?: string;
  kind: ChangeKind;
  /**
   * The repository the file is in, as a path from the root, when it is not the root itself: a
   * session may hold more than one repository.
   */
  repo?: string;
}

/** One repository of a session, in the order the panel lists them. */
export interface RepoInfo {
  /** Path from the root of the session, with forward slashes; '' is the root itself. */
  path: string;
  name: string;
  /** Checked-out branch; null when detached, or when there is only one repository. */
  branch: string | null;
  /** How many of the changes are in it. */
  count: number;
}

export type GitUnavailableReason = 'git-missing' | 'git-too-old' | 'not-a-repo';

export type GitOverview =
  | {
      ok: true;
      root: string;
      changes: FileChange[];
      /** Almost always one. More when the folder of the session holds several repositories. */
      repos: RepoInfo[];
      base: DiffBase;
      hasSessionBase: boolean;
    }
  | { ok: false; reason: GitUnavailableReason; gitVersion?: string; minVersion: string };

/** `head`: against the last commit. `session`: against the snapshot taken when the session started. */
export type DiffBase = 'head' | 'session';

export type SideContent =
  | { kind: 'text'; text: string }
  | { kind: 'missing' }
  | { kind: 'binary'; size: number }
  | { kind: 'too-large'; size: number };

export interface FileDiff {
  path: string;
  original: SideContent;
  modified: SideContent;
}

/** One line of the "all files" tree. */
export interface FileEntry {
  name: string;
  /** Path relative to the root of the listing, with forward slashes. */
  path: string;
  kind: 'dir' | 'file';
  /** A dotfile, or something .gitignore covers. */
  hidden: boolean;
}

export interface FileListing {
  entries: FileEntry[];
  /** The folder has more entries than the listing carries. */
  truncated: boolean;
}

export const CHANGE_LABEL: Record<ChangeKind, string> = {
  added: 'Adicionado',
  modified: 'Modificado',
  removed: 'Removido',
  renamed: 'Renomeado',
  untracked: 'Não rastreado',
  conflict: 'Em conflito',
};

export const CHANGE_LETTER: Record<ChangeKind, string> = {
  added: 'A',
  modified: 'M',
  removed: 'D',
  renamed: 'R',
  untracked: 'U',
  conflict: '!',
};
