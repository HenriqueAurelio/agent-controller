import { Notification } from 'electron';
import type { NotificationRequest } from '@core/sessions/NotificationPolicy';

// One live notification per session: a new one replaces the previous instead of piling up.
const live = new Map<string, Notification>();

export function showNotification(request: NotificationRequest, onClick: () => void): void {
  if (!Notification.isSupported()) return;
  live.get(request.sessionId)?.close();
  const notification = new Notification({
    title: request.title,
    body: request.body,
    silent: request.silent,
  });
  notification.on('click', onClick);
  notification.on('close', () => {
    if (live.get(request.sessionId) === notification) live.delete(request.sessionId);
  });
  live.set(request.sessionId, notification);
  notification.show();
}
