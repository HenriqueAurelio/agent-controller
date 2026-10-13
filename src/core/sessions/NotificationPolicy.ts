import type { Preferences } from '@shared/prefs';
import { statusLabel, type SessionStatus, type SessionView } from '@shared/session';

export interface NotificationRequest {
  sessionId: string;
  kind: 'waiting' | 'done';
  title: string;
  body: string;
  silent: boolean;
}

export interface NotificationPolicyOptions {
  /** Repeated notices of the same kind for the same session inside this window are dropped. */
  repeatWindowMs?: number;
  now?: () => number;
}

/**
 * Decides whether a state change deserves a native notification: only when the agent stops
 * working, never for the session being looked at, and without repeating itself.
 */
export class NotificationPolicy {
  private readonly last = new Map<string, { kind: string; at: number }>();
  private readonly repeatWindowMs: number;
  private readonly now: () => number;

  constructor(options: NotificationPolicyOptions = {}) {
    this.repeatWindowMs = options.repeatWindowMs ?? 30_000;
    this.now = options.now ?? Date.now;
  }

  evaluate(
    session: SessionView,
    previous: SessionStatus,
    context: { focused: boolean; prefs: Preferences },
  ): NotificationRequest | null {
    const { state } = session.status;
    if (state !== 'aguardando' && state !== 'terminou') return null;
    // "Ready at the prompt" right after opening, or `terminou` turning into `aguardando` a
    // minute later, are not news.
    if (previous.state !== 'trabalhando') return null;
    if (context.focused) return null;
    const kind = state === 'aguardando' ? 'waiting' : 'done';
    if (kind === 'waiting' ? !context.prefs.notifyWaiting : !context.prefs.notifyDone) return null;

    const now = this.now();
    const last = this.last.get(session.id);
    if (last && last.kind === kind && now - last.at < this.repeatWindowMs) return null;
    this.last.set(session.id, { kind, at: now });

    return {
      sessionId: session.id,
      kind,
      title: session.name,
      body:
        kind === 'done'
          ? 'O agente terminou.'
          : `${statusLabel(session.status)}${session.status.detail ? `: ${session.status.detail}` : '.'}`,
      silent: !context.prefs.notifySound,
    };
  }

  forget(sessionId: string): void {
    this.last.delete(sessionId);
  }
}
