import { summarizeRun, type ChecksRun } from '@shared/checks';
import { translator } from '@shared/i18n';
import type { Preferences } from '@shared/prefs';
import {
  requestText,
  statusDetail,
  statusLabel,
  type PermissionChoice,
  type SessionStatus,
  type SessionView,
} from '@shared/session';

export interface NotificationAction {
  label: string;
  choice: PermissionChoice;
}

export interface NotificationRequest {
  sessionId: string;
  kind: 'waiting' | 'done' | 'checks' | 'permission';
  title: string;
  body: string;
  silent: boolean;
  /** For `permission`: the request the buttons answer. */
  askId?: string;
  /** Buttons, where the system shows them; without them, a click opens the session. */
  actions?: NotificationAction[];
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
  /** The latest request told for each session: each one is told once. */
  private readonly lastAsk = new Map<string, string>();
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

  /**
   * The menu of a permission request showed up: the notice of "aguardando você" gives way to one
   * that says what is asked, with Allow and Deny. Not when the buttons are turned off.
   */
  evaluatePermission(
    session: SessionView,
    context: { focused: boolean; prefs: Preferences },
  ): NotificationRequest | null {
    const ask = session.permission;
    if (!ask || context.focused) return null;
    if (!context.prefs.notifyWaiting || !context.prefs.permissionButtons) return null;
    if (this.lastAsk.get(session.id) === ask.id) return null;
    this.lastAsk.set(session.id, ask.id);
    const t = translator(context.prefs.language);
    return {
      sessionId: session.id,
      kind: 'permission',
      title: session.name,
      body: t('notification.permission', { request: requestText(ask) }),
      silent: !context.prefs.notifySound,
      askId: ask.id,
      // "Always" is a choice to make looking at the terminal, not from a toast.
      actions: [
        { label: t('permission.allow'), choice: 'allow' },
        { label: t('permission.deny'), choice: 'deny' },
      ],
    };
  }

  forget(sessionId: string): void {
    this.last.delete(sessionId);
    this.lastAsk.delete(sessionId);
  }
}
