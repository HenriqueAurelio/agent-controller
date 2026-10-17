import type { ChecksSummary } from './checks';
import type { Translate } from './i18n';
import type { OverlapSummary } from './overlaps';
import type { QueueSummary } from './prompts';
import type { ReviewerSummary } from './reviewer';

export type AgentProfileId = 'claude-code' | 'codex';

export const AGENT_PROFILE_IDS: readonly AgentProfileId[] = ['claude-code', 'codex'];

/** `aguardando` is shown as "aguardando você". */
export type SessionState =
  'parada' | 'iniciando' | 'trabalhando' | 'aguardando' | 'terminou' | 'erro';

export type SignalOrigin = 'hook' | 'titulo' | 'notify' | 'silencio' | 'processo';

export type SignalKind = 'started' | 'working' | 'waiting' | 'done' | 'exited' | 'stopped';

export interface Signal {
  sessionId: string;
  kind: SignalKind;
  origin: SignalOrigin;
  /** Epoch milliseconds of when the signal was observed. */
  at: number;
  /** Exit code, for `exited`. */
  exitCode?: number;
  detail?: string;
}

export interface SessionStatus {
  state: SessionState;
  origin: SignalOrigin;
  /** False when the state was inferred from silence ("possivelmente"). */
  confirmed: boolean;
  since: number;
  detail?: string;
}

/**
 * A session working in a copy of a repository (`git worktree`) the app created for it, on a branch
 * of its own. The folder of the session is the copy.
 */
export interface SessionWorktree {
  /** The repository the copy belongs to. */
  repoRoot: string;
  branch: string;
  /** What the branch started from, for "compare with the base". */
  base: string;
}

/** What is saved to disk. No terminal history, no environment variables. */
export interface Session {
  id: string;
  name: string;
  cwd: string;
  profile: AgentProfileId;
  /**
   * Run in the user's shell in place of the agent's executable, so an alias or a function of
   * theirs works. Absent: the command of the preferences, or the agent's own.
   */
  command?: string;
  worktree?: SessionWorktree;
  /** Launched in the read-only mode of its agent: a reviewer only reads (ADR 0023). */
  readOnly?: boolean;
  /** The group the session is listed in. Absent: listed on its own, above the groups. */
  groupId?: string;
  order: number;
}

/** A named set of sessions in the list, such as the ones of one repository. */
export interface SessionGroup {
  id: string;
  name: string;
  /** Only the header shows, with a summary of the sessions inside. */
  collapsed: boolean;
  /** The group holds the attempts of an experiment, which the header can compare (ADR 0022). */
  experimentId?: string;
}

export const GROUP_NAME_LIMIT = 100;
export const GROUPS_LIMIT = 100;

/** What may change in a group. `sessionIds` replaces the sessions it holds. */
export interface GroupUpdate {
  name?: string;
  collapsed?: boolean;
  sessionIds?: string[];
}

export type HooksMode = 'unknown' | 'active' | 'inactive' | 'unsupported';

/** How a permission request can be answered. Each agent turns them into the keys of its menu. */
export type PermissionChoice = 'allow' | 'allowAlways' | 'deny';

export const PERMISSION_CHOICES: readonly PermissionChoice[] = ['allow', 'allowAlways', 'deny'];

/** What the agent asks permission for, as the list shows it: `Bash: npm install`. */
export interface PermissionAsk {
  /** A new one for every request: an answer names the one it was meant for. */
  id: string;
  tool: string;
  /** The command, file or tool it acts on, already cut to fit. Empty when the agent gave none. */
  target: string;
  /** What the menu on the screen offers. `allowAlways` only where the agent offers it. */
  choices: PermissionChoice[];
}

/**
 * `stale`: the request is no longer the one open on the screen, and nothing was written.
 * `unsupported`: the agent, or its menu, has no such answer.
 */
export type PermissionOutcome = 'answered' | 'stale' | 'unsupported';

/** How long the target of a request may be; a longer one keeps its start and its end. */
export const PERMISSION_TARGET_LIMIT = 120;

/** "Bash: npm install", or the tool alone when the agent said nothing more. */
export const requestText = (ask: { tool: string; target: string }): string =>
  ask.target ? `${ask.tool}: ${ask.target}` : ask.tool;

/** Cuts a long text in the middle: the start of a command and its end both say what it does. */
export function cutMiddle(text: string, limit = PERMISSION_TARGET_LIMIT): string {
  const flat = text.replace(/\s+/g, ' ').trim();
  const chars = [...flat];
  if (chars.length <= limit) return flat;
  const head = Math.ceil((limit - 1) / 2);
  const tail = limit - 1 - head;
  return `${chars.slice(0, head).join('').trimEnd()}…${chars
    .slice(chars.length - tail)
    .join('')
    .trimStart()}`;
}

export interface SessionView extends Session {
  status: SessionStatus;
  /** True while the agent process is alive. */
  running: boolean;
  hooks: HooksMode;
  /** Unseen "aguardando"/"terminou" since the session was last focused. */
  unread: boolean;
  /** The latest run of the checks of the folder, while the app is open. */
  checks?: ChecksSummary;
  /** Texts waiting for the agent to finish its turn before they are sent to it. */
  pendingSends?: number;
  /** The plain shell beside the agent is open. It never outlives the app. */
  auxOpen?: boolean;
  /** The permission the agent is asking for, once its menu is on the screen. */
  permission?: PermissionAsk;
  /** The prompts waiting in the queue of the session, when there are any. */
  queue?: QueueSummary;
  /** Files other sessions also changed, in other copies of the same repository. */
  overlaps?: OverlapSummary;
  /** The session that reviews the turns of this one, when there is one. */
  reviewer?: ReviewerSummary;
  /** This session is the reviewer of the one with this id. */
  reviewing?: string;
}

export interface NewSessionInput {
  name: string;
  cwd: string;
  profile: AgentProfileId;
  command?: string;
  /** Work in a new copy of the repository of `cwd`, on a new branch. */
  worktree?: { branch: string; base: string };
  groupId?: string;
  /** Launch the agent in its read-only mode, where it has one. */
  readOnly?: boolean;
}

/**
 * The terminal channels carry either a session id, for its agent, or this id, for the plain shell
 * beside it.
 */
/** The shell beside the agent keeps less history: it is for a quick command, not a long run. */
export const AUX_SCROLLBACK = 500;

export const auxTerminalId = (sessionId: string): string => `${sessionId}:aux`;

export function parseTerminalId(id: string): { sessionId: string; aux: boolean } {
  return id.endsWith(':aux')
    ? { sessionId: id.slice(0, -':aux'.length), aux: true }
    : { sessionId: id, aux: false };
}
/** What happens to the copy of a session in a worktree when it is closed. */
export type WorktreeOnClose = 'keep' | 'remove';

export interface TerminalSize {
  cols: number;
  rows: number;
}

/**
 * Details the app words itself. They travel as a code, since who emits them does not know the
 * language; any other detail (a tool name, an error) is shown as it came.
 */
export const STATUS_DETAIL = {
  ready: '@ready',
  idle: '@idle',
  unconfirmed: '@unconfirmed',
} as const;

export function statusLabel(t: Translate, status: SessionStatus): string {
  const label = t(`state.${status.state}`);
  return status.confirmed ? label : t('state.possibly', { state: label.toLowerCase() });
}

export function statusDetail(t: Translate, detail: string | undefined): string | undefined {
  if (detail === STATUS_DETAIL.ready) return t('detail.ready');
  if (detail === STATUS_DETAIL.idle) return t('detail.idle');
  if (detail === STATUS_DETAIL.unconfirmed) return t('detail.unconfirmed');
  return detail;
}

/**
 * Whether text sent to the agent must wait: it is working, or asking something that is not its
 * prompt (a permission), where pasted text would answer the question instead.
 */
export function isBusyForText(status: SessionStatus): boolean {
  if (status.state === 'trabalhando') return true;
  if (status.state !== 'aguardando' || !status.confirmed) return false;
  return status.detail !== STATUS_DETAIL.ready && status.detail !== STATUS_DETAIL.idle;
}

export function initialStatus(at = 0): SessionStatus {
  return { state: 'parada', origin: 'processo', confirmed: true, since: at };
}
