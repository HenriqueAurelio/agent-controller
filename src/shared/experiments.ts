import type { ChecksSummary } from './checks';
import type { AgentProfileId, SessionState } from './session';

// Experiments ("best of N"): one request, several attempts in isolated copies of a repository
// (ADR 0022).

export const ATTEMPTS_MIN = 1;
export const ATTEMPTS_MAX = 4;
export const EXPERIMENT_NAME_LIMIT = 100;
export const EXPERIMENT_PROMPT_LIMIT = 100_000;
/** A diff larger than this is not shown side by side: the table is all there is. */
export const EXPERIMENT_DIFF_LIMIT = 200 * 1024;
/** Files of an attempt the comparison lists. */
export const EXPERIMENT_FILES_LIMIT = 500;

/** One line of the dialog: an agent, and optionally the command to run in its place. */
export interface AttemptSpec {
  profile: AgentProfileId;
  command?: string;
}

export interface NewExperimentInput {
  name: string;
  /** Any folder of the repository the attempts are copies of. */
  cwd: string;
  /** The request every attempt gets. */
  prompt: string;
  /** What every copy starts from: a branch, a tag or a commit. */
  base: string;
  attempts: AttemptSpec[];
}

/** What the renderer needs to know right after creating one. */
export interface ExperimentCreated {
  id: string;
  groupId: string;
  sessionIds: string[];
}

export interface FileStat {
  /** Relative to the root of the copy, with forward slashes. */
  path: string;
  added: number;
  removed: number;
  /** Binary files have no lines to count. */
  binary: boolean;
}

export interface AttemptRow {
  sessionId: string;
  name: string;
  profile: AgentProfileId;
  branch: string;
  state: SessionState;
  running: boolean;
  /** The prompt reached the agent. */
  promptSent: boolean;
  checks?: ChecksSummary;
  files: FileStat[];
  /** True when the copy changed more files than the comparison lists. */
  filesCut: boolean;
  added: number;
  removed: number;
  /** From the prompt to the end of the first turn, or to now while it works; null before it went. */
  elapsedMs: number | null;
  /** This is the attempt the user kept; the others could not be removed yet. */
  chosen: boolean;
}

export interface Comparison {
  id: string;
  name: string;
  prompt: string;
  base: string;
  attempts: AttemptRow[];
  /** The files of every attempt, once each, in alphabetical order. */
  files: string[];
}

export type AttemptDiff =
  | { sessionId: string; kind: 'unchanged' }
  | { sessionId: string; kind: 'binary' }
  | { sessionId: string; kind: 'too-large'; size: number }
  | { sessionId: string; kind: 'text'; text: string };

/** What `keep` could not remove: the session stays, stopped, with its copy. */
export interface KeptAttempt {
  sessionId: string;
  name: string;
  folder: string;
  /** Already worded, in the language of the user. */
  reason: string;
}

export interface KeepResult {
  /** Attempts closed, with their copies removed. */
  removed: number;
  kept: KeptAttempt[];
}

/** `ac/<name>-<n>`: the branch of the attempt, in the characters git takes. */
export function attemptBranch(name: string, index: number): string {
  const slug = name
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9._-]+/g, '-')
    .replace(/^[-.]+|[-.]+$/g, '')
    .slice(0, 40);
  return `ac/${slug || 'experimento'}-${index + 1}`;
}
