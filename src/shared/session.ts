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
}

export interface NewSessionInput {
  name: string;
  cwd: string;
  profile: AgentProfileId;
}

export interface TerminalSize {
  cols: number;
  rows: number;
}

export const STATE_LABEL: Record<SessionState, string> = {
  parada: 'Parada',
  iniciando: 'Iniciando',
  trabalhando: 'Trabalhando',
  aguardando: 'Aguardando você',
  terminou: 'Terminou',
  erro: 'Erro',
};

export function statusLabel(status: SessionStatus): string {
  const label = STATE_LABEL[status.state];
  return status.confirmed ? label : `Possivelmente ${label.toLowerCase()}`;
}

export function initialStatus(at = 0): SessionStatus {
  return { state: 'parada', origin: 'processo', confirmed: true, since: at };
}
