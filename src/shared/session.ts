import type { ChecksSummary } from './checks';
import type { Translate } from './i18n';

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
  order: number;
}

export type HooksMode = 'unknown' | 'active' | 'inactive' | 'unsupported';

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
}

export interface NewSessionInput {
  name: string;
  cwd: string;
  profile: AgentProfileId;
  command?: string;
}

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
