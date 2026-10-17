import { Notification } from 'electron';
import type { NotificationRequest } from '@core/sessions/NotificationPolicy';
import type { PermissionChoice } from '@shared/session';

// One live notification per session: a new one replaces the previous instead of piling up.
const live = new Map<string, Notification>();

/**
 * Buttons in a notification exist on Windows and macOS. Elsewhere (Linux) the notification goes
 * without them, and a click opens the session, as for any other notice.
 */
const ACTIONS_SUPPORTED = process.platform === 'win32' || process.platform === 'darwin';

export function showNotification(
  request: NotificationRequest,
  onClick: () => void,
  onAction?: (choice: PermissionChoice) => void,
): void {
  if (!Notification.isSupported()) return;
  live.get(request.sessionId)?.close();
  const actions = ACTIONS_SUPPORTED && onAction ? (request.actions ?? []) : [];
  const notification = new Notification({
    title: request.title,
    body: request.body,
    silent: request.silent,
    ...(actions.length > 0 && {
      actions: actions.map((action) => ({ type: 'button' as const, text: action.label })),
    }),
  });
  notification.on('click', onClick);
  if (actions.length > 0) {
    notification.on('action', (details, index) => {
      const action = actions[details?.actionIndex ?? index];
      if (action) onAction?.(action.choice);
    });
  }
  notification.on('close', () => {
    if (live.get(request.sessionId) === notification) live.delete(request.sessionId);
  });
  live.set(request.sessionId, notification);
  notification.show();
}
