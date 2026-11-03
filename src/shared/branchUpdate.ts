/** What "update with the base" did in the copy. */
export interface BaseUpdate {
  /** `current`: nothing to bring; `merged`: the base came in; `conflict`: it stopped on conflicts. */
  status: 'current' | 'merged' | 'conflict';
  /** What was merged: the base as the remote has it, or the local one. */
  from: string;
  conflicts: string[];
}
