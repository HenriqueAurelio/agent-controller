import { useEffect, useState } from 'react';
import type { Translate } from '@shared/i18n';
import {
  PROMPT_TEXT_LIMIT,
  QUEUE_CONDITIONS,
  type QueueCondition,
  type QueueItem,
  type QueueState,
} from '@shared/prompts';
import type { SessionView } from '@shared/session';
import { errorMessage } from '../lib/format';
import { useT } from '../lib/i18n';
import { Dialog } from './Dialog';

/** What the queue is doing, in one sentence. */
export function queueStatusText(t: Translate, state: QueueState, session: SessionView): string {
  if (state.blockedBy === 'sendFailed') {
    return t('queue.state.sendFailed', { error: state.error ?? '' }).trim();
  }
  if (state.blockedBy) return t(`queue.state.${state.blockedBy}`);
  if (state.paused) return t('queue.state.paused');
  if (state.checking) return t('queue.state.checking');
  if (!session.status.confirmed) return t('queue.state.unconfirmed');
  return t('queue.state.running');
}

/** The error of the checks goes to the agent; the queue waits for the turn that fixes it. */
export async function sendQueueFailure(sessionId: string): Promise<void> {
  await window.api.invoke('checks:sendFailure', sessionId);
  await window.api.invoke('queue:resume', sessionId, { afterTurn: true });
}

/** Drops the first item, the one that could not go, and moves on to the next. */
export async function skipQueueItem(sessionId: string): Promise<void> {
  const state = await window.api.invoke('queue:get', sessionId);
  const head = state.items[0];
  if (head) await window.api.invoke('queue:remove', sessionId, head.id);
  await window.api.invoke('queue:resume', sessionId);
}

/** The queue of one session, kept up to date while something is shown of it. */
export function useQueue(sessionId: string): QueueState | null {
  const [state, setState] = useState<QueueState | null>(null);
  useEffect(() => {
    let cancelled = false;
    void window.api
      .invoke('queue:get', sessionId)
      .then((value) => !cancelled && setState(value))
      .catch(() => {});
    const off = window.api.on('queue:changed', (id, value) => {
      if (id === sessionId) setState(value);
    });
    return () => {
      cancelled = true;
      off();
    };
  }, [sessionId]);
  return state;
}

interface Props {
  session: SessionView;
  onClose(): void;
}

/** The prompts waiting for a session: their order, text and condition, and the queue itself. */
export function QueueDialog({ session, onClose }: Props) {
  const t = useT();
  const state = useQueue(session.id);
  const [editing, setEditing] = useState<{ id: string; text: string } | null>(null);
  const [dragged, setDragged] = useState<string | null>(null);
  const [dropTarget, setDropTarget] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const run = (action: () => Promise<unknown>) => {
    setError(null);
    action().catch((err) => setError(errorMessage(err)));
  };
  const items = state?.items ?? [];
  const reorder = (ids: string[]) => run(() => window.api.invoke('queue:reorder', session.id, ids));
  const move = (index: number, offset: number) => {
    const ids = items.map((item) => item.id);
    const [moved] = ids.splice(index, 1);
    ids.splice(index + offset, 0, moved!);
    reorder(ids);
  };
  const dropOn = (target: QueueItem) => {
    if (!dragged || dragged === target.id) return;
    const ids = items.map((item) => item.id).filter((id) => id !== dragged);
    ids.splice(ids.indexOf(target.id), 0, dragged);
    reorder(ids);
  };
  const saveEdit = () => {
    if (!editing) return;
    const { id, text } = editing;
    setEditing(null);
    run(() => window.api.invoke('queue:update', session.id, id, { text }));
  };

  const failed = state?.blockedBy === 'checksFailed';
  const stopped = Boolean(state?.paused);

  return (
    <Dialog
      title={t('queue.title', { name: session.name })}
      onClose={onClose}
      className="queue-dialog"
    >
      {state && (
        <p className="queue-status" role="status" data-testid="queue-status">
          {queueStatusText(t, state, session)}
        </p>
      )}
      {items.length === 0 ? (
        <p className="muted">{t('queue.empty')}</p>
      ) : (
        <ol className="queue-list" aria-label={t('app.queue')}>
          {items.map((item, index) => {
            const n = index + 1;
            return (
              <li
                key={item.id}
                className={[
                  'queue-item',
                  dragged === item.id ? 'dragging' : '',
                  dropTarget === item.id ? 'drop-target' : '',
                ].join(' ')}
                data-testid="queue-item"
                draggable={editing?.id !== item.id}
                title={t('queue.dragHint')}
                onDragStart={(e) => {
                  setDragged(item.id);
                  e.dataTransfer.effectAllowed = 'move';
                }}
                onDragOver={(e) => {
                  if (!dragged) return;
                  e.preventDefault();
                  setDropTarget(item.id);
                }}
                onDragEnd={() => {
                  setDragged(null);
                  setDropTarget(null);
                }}
                onDrop={(e) => {
                  e.preventDefault();
                  dropOn(item);
                  setDragged(null);
                  setDropTarget(null);
                }}
              >
                <span className="queue-index" aria-hidden="true">
                  {n}
                </span>
                <div className="queue-body">
                  {editing?.id === item.id ? (
                    <textarea
                      aria-label={t('queue.itemText', { index: n })}
                      className="prompt-text"
                      rows={3}
                      maxLength={PROMPT_TEXT_LIMIT}
                      spellCheck={false}
                      autoFocus
                      value={editing.text}
                      onChange={(e) => setEditing({ id: item.id, text: e.target.value })}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter' && e.ctrlKey) {
                          e.preventDefault();
                          saveEdit();
                        }
                      }}
                    />
                  ) : (
                    <span className="queue-text" data-testid="queue-text">
                      {item.text}
                    </span>
                  )}
                  <select
                    aria-label={t('queue.conditionLabel', { index: n })}
                    value={item.condition}
                    onChange={(e) =>
                      run(() =>
                        window.api.invoke('queue:update', session.id, item.id, {
                          condition: e.target.value as QueueCondition,
                        }),
                      )
                    }
                  >
                    {QUEUE_CONDITIONS.map((condition) => (
                      <option key={condition} value={condition}>
                        {t(`queue.condition.${condition}`)}
                      </option>
                    ))}
                  </select>
                </div>
                <div className="queue-item-actions">
                  <button
                    className="icon-button"
                    aria-label={t('queue.moveUp', { index: n })}
                    title={t('queue.moveUp', { index: n })}
                    disabled={index === 0}
                    onClick={() => move(index, -1)}
                  >
                    ↑
                  </button>
                  <button
                    className="icon-button"
                    aria-label={t('queue.moveDown', { index: n })}
                    title={t('queue.moveDown', { index: n })}
                    disabled={index === items.length - 1}
                    onClick={() => move(index, 1)}
                  >
                    ↓
                  </button>
                  {editing?.id === item.id ? (
                    <button onClick={saveEdit} disabled={!editing.text.trim()}>
                      {t('queue.save')}
                    </button>
                  ) : (
                    <button
                      aria-label={t('queue.editLabel', { index: n })}
                      onClick={() => setEditing({ id: item.id, text: item.text })}
                    >
                      {t('queue.edit')}
                    </button>
                  )}
                  <button
                    aria-label={t('queue.removeLabel', { index: n })}
                    onClick={() =>
                      run(() => window.api.invoke('queue:remove', session.id, item.id))
                    }
                  >
                    {t('queue.remove')}
                  </button>
                </div>
              </li>
            );
          })}
        </ol>
      )}

      {error && (
        <p className="form-error" role="alert">
          {error}
        </p>
      )}

      <div className="dialog-actions">
        {failed && (
          <>
            <button
              title={t('queue.sendFailureHint')}
              onClick={() => run(() => sendQueueFailure(session.id))}
            >
              {t('queue.sendFailure')}
            </button>
            <button onClick={() => run(() => skipQueueItem(session.id))}>{t('queue.skip')}</button>
          </>
        )}
        {items.length > 0 &&
          (stopped ? (
            <button onClick={() => run(() => window.api.invoke('queue:resume', session.id))}>
              {t('queue.resume')}
            </button>
          ) : (
            <button onClick={() => run(() => window.api.invoke('queue:pause', session.id))}>
              {t('queue.pause')}
            </button>
          ))}
        {items.length > 0 && (
          <button
            title={t('queue.sendNextHint')}
            disabled={!session.running}
            onClick={() => run(() => window.api.invoke('queue:sendNext', session.id))}
          >
            {t('queue.sendNext')}
          </button>
        )}
        <button className="primary" onClick={onClose}>
          {t('common.close')}
        </button>
      </div>
    </Dialog>
  );
}
