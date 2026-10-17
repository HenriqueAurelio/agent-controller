// What the list and the overview both show of a session besides its state: the permission it asks
// for, its queue of prompts and the files it shares with other sessions.
import type { KeyboardEvent } from 'react';
import { requestText, type PermissionChoice, type SessionView } from '@shared/session';
import { hint } from '../lib/format';
import { useT } from '../lib/i18n';
import { overlapBadgeText } from '../lib/overlaps';
import { store, useAppState } from '../lib/store';

/** What the agent asks permission for and, when the preferences allow, the answers. */
export function PermissionAsk({ session }: { session: SessionView }) {
  const t = useT();
  const shortcuts = useAppState((s) => s.prefs.shortcuts);
  const permissionButtons = useAppState((s) => s.prefs.permissionButtons);
  const ask = session.permission;
  if (!ask) return null;
  const request = requestText(ask);
  const answer = (choice: PermissionChoice) => ({
    onClick: (e: { stopPropagation(): void }) => {
      e.stopPropagation();
      void store.answerPermission(session.id, choice);
    },
    // Enter on a button answers; the row would take it to open the session.
    onKeyDown: (e: KeyboardEvent) => e.stopPropagation(),
    onDoubleClick: (e: { stopPropagation(): void }) => e.stopPropagation(),
  });
  return (
    <span
      className="permission-ask"
      role="group"
      data-testid="permission-ask"
      aria-label={t('permission.region', { name: session.name, request })}
    >
      <span className="permission-text" title={request}>
        <span className="permission-tool">{ask.tool}</span>
        {ask.target && <span className="permission-target">{ask.target}</span>}
      </span>
      {permissionButtons && (
        <span className="permission-buttons">
          <button
            className="permission-button allow"
            title={hint(t('permission.allow'), shortcuts.allowPermission[0])}
            aria-label={t('permission.allowLabel', { name: session.name })}
            {...answer('allow')}
          >
            ✓
          </button>
          {ask.choices.includes('allowAlways') && (
            <button
              className="permission-button always"
              title={t('permission.allowAlways')}
              aria-label={t('permission.alwaysLabel', { name: session.name })}
              {...answer('allowAlways')}
            >
              {t('permission.always')}
            </button>
          )}
          <button
            className="permission-button deny"
            title={hint(t('permission.deny'), shortcuts.denyPermission[0])}
            aria-label={t('permission.denyLabel', { name: session.name })}
            {...answer('deny')}
          >
            ✕
          </button>
        </span>
      )}
    </span>
  );
}

/** ⏵ n: prompts waiting in the queue of the session; ⏸ while it is paused. */
export function QueueBadge({ session }: { session: SessionView }) {
  const t = useT();
  if (!session.queue) return null;
  const label = t(session.queue.paused ? 'sidebar.queuePausedLabel' : 'sidebar.queueLabel', {
    count: session.queue.items,
  });
  return (
    <span
      className={`queue-badge ${session.queue.paused ? 'paused' : ''}`}
      data-testid="queue-badge"
      title={label}
      aria-label={label}
    >
      {session.queue.paused ? '⏸' : '⏵'} {session.queue.items}
    </span>
  );
}

/** ⚠ n: files that sessions in other copies of the repository also changed. */
export function OverlapBadge({ session }: { session: SessionView }) {
  const t = useT();
  const sessions = useAppState((s) => s.sessions);
  if (!session.overlaps) return null;
  const label = overlapBadgeText(t, session.overlaps, sessions);
  return (
    <span
      className={`overlap-badge ${session.overlaps.likely > 0 ? 'likely' : ''}`}
      data-testid="overlap-badge"
      title={label}
      aria-label={label}
    >
      ⚠ {session.overlaps.files}
    </span>
  );
}

/** 🔍 on the session that reviews, and the state of the review on the one that is reviewed. */
export function ReviewBadge({ session }: { session: SessionView }) {
  const t = useT();
  const sessions = useAppState((s) => s.sessions);
  if (session.reviewing) {
    const name = sessions.find((s) => s.id === session.reviewing)?.name ?? '';
    const label = t('reviewer.badge.reviewing', { name });
    return (
      <span
        className="review-badge"
        data-testid="review-badge-reviewer"
        title={label}
        aria-label={label}
      >
        🔍
      </span>
    );
  }
  const review = session.reviewer;
  if (!review || review.state === 'idle') return null;
  const label =
    review.state === 'ready'
      ? t('reviewer.badge.ready', { count: review.count ?? 0 })
      : t(`reviewer.badge.${review.state}`);
  return (
    <span
      className={`review-badge ${review.state}`}
      data-testid="review-badge"
      title={label}
      aria-label={label}
    >
      🔍{review.state === 'ready' ? ` ${review.count ?? 0}` : '…'}
    </span>
  );
}

/** → name: where the rules of the flow send from this session; ✓ when a send waits for a click. */
export function FlowBadge({ session }: { session: SessionView }) {
  const t = useT();
  const sessions = useAppState((s) => s.sessions);
  const flow = session.flow;
  if (!flow || !session.groupId) return null;
  const nameOf = (id: string) => sessions.find((s) => s.id === id)?.name ?? '';
  const groupId = session.groupId;
  const stop = (e: { stopPropagation(): void }) => e.stopPropagation();
  return (
    <>
      {flow.pending.map((pending) => {
        const label = t('flow.mark.pending', { name: nameOf(pending.toId) });
        return (
          <button
            key={pending.id}
            type="button"
            className="flow-badge pending"
            data-testid="flow-pending-badge"
            title={label}
            aria-label={label}
            onClick={(e) => {
              stop(e);
              void window.api.invoke('flows:approve', groupId, pending.id).catch(() => {});
            }}
            onDoubleClick={stop}
            onKeyDown={(e) => e.stopPropagation()}
          >
            → {nameOf(pending.toId)} ✓
          </button>
        );
      })}
      {flow.pending.length === 0 && flow.to.length > 0 && (
        <span
          className={`flow-badge ${flow.paused ? 'paused' : ''}`}
          data-testid="flow-badge"
          title={
            flow.paused
              ? t('flow.mark.paused')
              : flow.to.map((id) => t('flow.mark.to', { name: nameOf(id) })).join(', ')
          }
        >
          →
        </span>
      )}
    </>
  );
}
