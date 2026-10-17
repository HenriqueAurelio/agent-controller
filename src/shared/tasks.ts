import type { ChecksSummary } from './checks';
import type { QueueSummary } from './prompts';
import type { AgentProfileId, SessionState } from './session';

// The task board: cards that become sessions. The column of a card is never stored; it is read
// from the state of its session (ADR 0025).

export const TASK_COLUMNS = ['todo', 'doing', 'attention', 'review', 'done'] as const;
export type TaskColumn = (typeof TASK_COLUMNS)[number];

export const TASK_TITLE_LIMIT = 200;
export const TASK_DESCRIPTION_LIMIT = 100_000;
/** Cards one board keeps. */
export const TASKS_PER_BOARD_LIMIT = 200;
/** Cards created by one paste of a list. */
export const TASKS_PER_PASTE_LIMIT = 50;
/** Sessions one click on "start" creates: each one is a copy of the repository and an agent. */
export const TASK_START_MAX = 4;

/** What is kept of a card. The column is not part of it. */
export interface Task {
  id: string;
  title: string;
  /** Becomes the first prompt; the title stands in when it is empty. */
  description: string;
  profile: AgentProfileId;
  command?: string;
  /** Work in a copy of the repository, on a branch of its own. */
  isolated: boolean;
  /** What the copy starts from, and what "the branch got into the base" is checked against. */
  base: string;
  groupId?: string;
  sessionId?: string;
  /** The branch of the copy; kept after the session is closed by hand. */
  branch?: string;
  /** Where the branch was when the copy was made: a branch that has not moved is not "in the base". */
  startCommit?: string;
  /** Epoch ms of when the prompt reached the agent. */
  sentAt?: number;
  /** The session was closed without the card being finished. */
  sessionClosed?: boolean;
  /** Marked by the user, or because the branch got into the base. */
  done?: boolean;
}

/** One card to create: the rest is the options of the whole dialog. */
export interface TaskDraft {
  title: string;
  description: string;
}

export interface NewTasksInput {
  /** Any folder of the repository the board belongs to. */
  cwd: string;
  profile: AgentProfileId;
  command?: string;
  isolated: boolean;
  base: string;
  groupId?: string;
  drafts: TaskDraft[];
}

export interface TaskBoardState {
  /** The root of the repository. */
  repo: string;
  tasks: Task[];
  /** Every repository that has a board, for the picker at the top. */
  repos: string[];
}

export interface TaskStartResult {
  started: string[];
  /** Cards that could not start, with the reason in the user's language. */
  failed: { taskId: string; reason: string }[];
}

/** What `columnOf` reads of the session of a card. */
export interface TaskSessionFacts {
  state: SessionState;
  running: boolean;
  checks?: Pick<ChecksSummary, 'state'>;
  queue?: Pick<QueueSummary, 'items'>;
}

/**
 * The column a card is in, from the card and its session. A pure function of both, so the board
 * cannot disagree with the list of sessions.
 */
export function columnOf(task: Task, session?: TaskSessionFacts | null): TaskColumn {
  if (task.done) return 'done';
  if (!task.sessionId || !session) return 'todo';
  // Before the first prompt reached the agent, the agent being ready is not "waiting for you".
  if (task.sentAt === undefined) return session.running ? 'doing' : 'attention';
  if (!session.running || session.state === 'aguardando' || session.state === 'erro') {
    return 'attention';
  }
  if (session.checks?.state === 'failed') return 'attention';
  if (
    session.state === 'trabalhando' ||
    session.state === 'iniciando' ||
    (session.queue?.items ?? 0) > 0 ||
    session.checks?.state === 'queued' ||
    session.checks?.state === 'running'
  ) {
    return 'doing';
  }
  return 'review';
}

/** `ac/<title>`: the branch of the card, in the characters git takes. */
export function taskBranch(title: string): string {
  const slug = title
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9._-]+/g, '-')
    .replace(/^[-.]+|[-.]+$/g, '')
    .slice(0, 40)
    .replace(/[-.]+$/g, '');
  return `ac/${slug || 'tarefa'}`;
}

/** The text sent to the agent. */
export const taskPrompt = (task: Pick<Task, 'title' | 'description'>): string =>
  task.description.trim() || task.title;

/** One draft per non-empty line of a pasted list. */
export function draftsFromLines(text: string): TaskDraft[] {
  return text
    .split(/\r?\n/)
    .map((line) => line.replace(/^\s*(?:[-*+]\s+(?:\[[ xX]\]\s+)?|\d+[.)]\s+)/, '').trim())
    .filter(Boolean)
    .map((title) => ({ title: title.slice(0, TASK_TITLE_LIMIT), description: '' }));
}
