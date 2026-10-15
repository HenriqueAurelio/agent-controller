import { summarizeRun, type ChecksRun } from '@shared/checks';
import { translator } from '@shared/i18n';
import type { Preferences } from '@shared/prefs';
import { statusDetail, statusLabel, type SessionStatus, type SessionView } from '@shared/session';

export interface NotificationRequest {
  sessionId: string;
  kind: 'waiting' | 'done' | 'checks';
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

    const t = translator(context.prefs.language);
    const detail = statusDetail(t, session.status.detail);
    return {
      sessionId: session.id,
      kind,
      title: session.name,
      body:
        kind === 'done'
          ? t('notification.done')
          : `${statusLabel(t, session.status)}${detail ? `: ${detail}` : '.'}`,
      silent: !context.prefs.notifySound,
    };
  }

  /**
   * The checks that run when a turn ends failed. "Terminou" was already told, but it said nothing
   * about whether the work is good: this does, and only when it is not.
   */
  evaluateChecks(
    session: SessionView,
    run: ChecksRun,
    context: { focused: boolean; prefs: Preferences },
  ): NotificationRequest | null {
    if (run.state !== 'done' || run.trigger !== 'turnEnd') return null;
    const summary = summarizeRun(run);
    if (summary.state !== 'failed') return null;
    if (context.focused || !context.prefs.notifyDone) return null;
    const t = translator(context.prefs.language);
    return {
      sessionId: session.id,
      kind: 'checks',
      title: session.name,
      body: t('notification.checksFailed', { failed: summary.failed, total: summary.total }),
      silent: !context.prefs.notifySound,
    };
  }

  forget(sessionId: string): void {
    this.last.delete(sessionId);
  }
}
