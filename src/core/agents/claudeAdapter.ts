import { STATUS_DETAIL } from '@shared/session';
import type { HookMessage } from '../signals/HookServer';
import { asRecord, BaseAdapter } from './adapter';
import { CLAUDE_HOOK_SOURCE } from './commandLine';

function notificationType(payload: Record<string, unknown>): 'permission' | 'idle' | null {
  const type = String(payload.notification_type ?? '');
  if (type === 'permission_prompt') return 'permission';
  if (type === 'idle_prompt') return 'idle';
  if (type) return null; // auth_success and others say nothing about the turn.
  // Older versions only sent the message text.
  const message = String(payload.message ?? '');
  if (/permission/i.test(message)) return 'permission';
  if (/waiting for your input/i.test(message)) return 'idle';
  return null;
}

/**
 * Claude Code: hooks are the main signal. `PermissionRequest` fires in the same second as the
 * prompt; `Notification` confirms it later and covers "stopped, waiting for you"; `Stop` ends
 * the turn. The title only tells working from not working.
 */
export class ClaudeAdapter extends BaseAdapter {
  onHook(message: HookMessage): void {
    if (message.source !== CLAUDE_HOOK_SOURCE) return;
    const payload = asRecord(message.payload);
    this.markHooks('active');

    switch (payload.hook_event_name) {
      case 'PermissionRequest':
        this.arm();
        this.resolved();
        this.emit(
          'waiting',
          'hook',
          typeof payload.tool_name === 'string' ? payload.tool_name : undefined,
        );
        break;
      case 'Notification': {
        const type = notificationType(payload);
        if (!type) break;
        this.arm();
        this.resolved();
        this.emit('waiting', 'hook', type === 'idle' ? STATUS_DETAIL.idle : undefined);
        break;
      }
      case 'Stop':
        this.arm();
        this.resolved();
        this.emit('done', 'hook');
        break;
      default:
        // SessionStart and anything else only prove that the hooks are alive.
        break;
    }
  }
}
