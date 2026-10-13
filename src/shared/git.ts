export type ChangeKind = 'added' | 'modified' | 'removed' | 'renamed' | 'untracked' | 'conflict';

export interface FileChange {
  /** Path relative to the repository root, with forward slashes. */
  path: string;
  /** Previous path, for renames. */
  origPath?: string;
  kind: ChangeKind;
}

export type GitUnavailableReason = 'git-missing' | 'git-too-old' | 'not-a-repo';

export type GitOverview =
  | { ok: true; root: string; changes: FileChange[]; base: DiffBase; hasSessionBase: boolean }
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
