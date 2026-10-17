import { useEffect, useMemo, useRef, useState } from 'react';
import {
  REVIEW_TRIGGERS,
  reviewText,
  type ReviewResult,
  type ReviewTrigger,
} from '@shared/reviewer';
import { AGENT_PROFILE_IDS, type AgentProfileId, type SessionView } from '@shared/session';
import { errorMessage, PROFILE_LABEL } from '../lib/format';
import { useT } from '../lib/i18n';
import { useAppState } from '../lib/store';
import { Dialog } from './Dialog';

/** The review of one session, kept up to date while something is shown of it. */
export function useReview(sessionId: string, active: boolean): ReviewResult | null {
  const [result, setResult] = useState<ReviewResult | null>(null);
  useEffect(() => {
    if (!active) {
      setResult(null);
      return;
    }
    let cancelled = false;
    const load = () =>
      void window.api
        .invoke('reviewer:result', sessionId)
        .then((value) => !cancelled && setResult(value))
        .catch(() => !cancelled && setResult(null));
    load();
    const off = window.api.on('reviewer:changed', (id) => {
      if (id === sessionId) load();
    });
    return () => {
      cancelled = true;
      off();
    };
  }, [sessionId, active]);
  return result;
}

interface Props {
  session: SessionView;
  onClose(): void;
  /** The text of the observations picked, to be sent to the agent of the session. */
  onReturn(text: string): void;
  /** Opens the session of the reviewer, to see what it is doing. */
  onOpenReviewer(id: string): void;
}

export function ReviewerDialog({ session, onClose, onReturn, onOpenReviewer }: Props) {
  const t = useT();
  const sessions = useAppState((s) => s.sessions);
  const summary = session.reviewer;
  const review = useReview(session.id, summary !== undefined);
  const reviewerSession = summary && sessions.find((s) => s.id === summary.reviewerId);

  // The choices of the form that links a reviewer.
  const [kind, setKind] = useState<'new' | 'existing'>('new');
  const [profile, setProfile] = useState<AgentProfileId>(session.profile);
  const candidates = useMemo(
    () => sessions.filter((s) => s.id !== session.id && !s.reviewer && !s.reviewing),
    [sessions, session.id],
  );
  const [existing, setExisting] = useState('');
  const [trigger, setTrigger] = useState<ReviewTrigger>('turn');
  const [picked, setPicked] = useState<Set<number>>(new Set());
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const closeButton = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (summary) setTrigger(summary.trigger);
  }, [summary]);
  useEffect(() => {
    setPicked(new Set());
  }, [review?.requestedAt, review?.state]);
  useEffect(() => {
    if (!existing && candidates[0]) setExisting(candidates[0].id);
  }, [candidates, existing]);

  const run = async (action: () => Promise<unknown>) => {
    setBusy(true);
    setError(null);
    try {
      await action();
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
      // The button that was pressed may be gone by now; Esc needs the focus to be in the dialog.
      setTimeout(() => {
        if (!document.activeElement || document.activeElement === document.body) {
          closeButton.current?.focus();
        }
      }, 0);
    }
  };

  const link = () =>
    run(() =>
      window.api.invoke('reviewer:set', {
        sessionId: session.id,
        trigger,
        reviewer: kind === 'new' ? { kind, profile } : { kind, sessionId: existing },
      }),
    );
  const changeTrigger = (next: ReviewTrigger) => {
    setTrigger(next);
    if (!summary) return;
    void run(() =>
      window.api.invoke('reviewer:set', {
        sessionId: session.id,
        trigger: next,
        reviewer: { kind: 'existing', sessionId: summary.reviewerId },
      }),
    );
  };
  const unlink = () =>
    run(() =>
      window.api.invoke('reviewer:set', { sessionId: session.id, trigger, reviewer: null }),
    );
  const reviewNow = () => run(() => window.api.invoke('reviewer:runNow', session.id));

  const items = review?.items ?? [];
  const toggle = (index: number) => {
    const next = new Set(picked);
    if (next.has(index)) next.delete(index);
    else next.add(index);
    setPicked(next);
  };
  const giveBack = () =>
    onReturn(
      t('reviewer.returnText', {
        items: reviewText(items.filter((_, index) => picked.has(index))),
      }),
    );

  const triggerSelect = (
    <fieldset className="field">
      <legend>{t('reviewer.when')}</legend>
      {REVIEW_TRIGGERS.map((option) => (
        <label key={option} className="check">
          <input
            type="radio"
            name="review-trigger"
            checked={trigger === option}
            onChange={() => changeTrigger(option)}
          />
          {t(`reviewer.trigger.${option}`)}
        </label>
      ))}
    </fieldset>
  );

  return (
    <Dialog
      title={t('reviewer.title', { name: session.name })}
      onClose={onClose}
      className="reviewer-dialog"
    >
      <div className="form" data-testid="reviewer-dialog">
        <p className="muted">{t('reviewer.intro')}</p>

        {!summary && (
          <>
            <fieldset className="field">
              <legend>{t('reviewer.who')}</legend>
              <label className="check">
                <input
                  type="radio"
                  name="review-who"
                  checked={kind === 'new'}
                  onChange={() => setKind('new')}
                />
                {t('reviewer.new')}
              </label>
              {kind === 'new' && (
                <label className="field-inline">
                  <span>{t('reviewer.agent')}</span>
                  <select
                    aria-label={t('reviewer.agent')}
                    value={profile}
                    onChange={(e) => setProfile(e.target.value as AgentProfileId)}
                  >
                    {AGENT_PROFILE_IDS.map((id) => (
                      <option key={id} value={id}>
                        {PROFILE_LABEL[id]}
                      </option>
                    ))}
                  </select>
                </label>
              )}
              <label className="check">
                <input
                  type="radio"
                  name="review-who"
                  checked={kind === 'existing'}
                  disabled={candidates.length === 0}
                  onChange={() => setKind('existing')}
                />
                {t('reviewer.existing')}
              </label>
              {kind === 'existing' && (
                <label className="field-inline">
                  <span>{t('reviewer.session')}</span>
                  <select
                    aria-label={t('reviewer.session')}
                    value={existing}
                    onChange={(e) => setExisting(e.target.value)}
                  >
                    {candidates.map((s) => (
                      <option key={s.id} value={s.id}>
                        {s.name} · {PROFILE_LABEL[s.profile]}
                      </option>
                    ))}
                  </select>
                </label>
              )}
            </fieldset>
            {triggerSelect}
            <p className="form-note">{t('reviewer.costNote')}</p>
          </>
        )}

        {summary && (
          <>
            <p data-testid="reviewer-current">
              {t('reviewer.current', { name: reviewerSession?.name ?? '' })}{' '}
              <button
                type="button"
                className="link-button"
                onClick={() => onOpenReviewer(summary.reviewerId)}
              >
                {t('reviewer.openReviewer')}
              </button>
            </p>
            {triggerSelect}
            <p className="form-note" role="status" data-testid="reviewer-state">
              {review?.state === 'failed'
                ? t('reviewer.state.failed', { error: review.error ?? '' })
                : t(`reviewer.state.${review?.state ?? summary.state}`)}
            </p>
            {review?.state === 'ready' && (
              <section className="review-items">
                <h3>{t('reviewer.items', { count: items.length })}</h3>
                {items.length === 0 && <p className="muted">{t('reviewer.empty')}</p>}
                <ul className="review-list" data-testid="review-list">
                  {items.map((item, index) => (
                    <li key={index}>
                      <label className="check review-item">
                        <input
                          type="checkbox"
                          data-testid="review-item"
                          checked={picked.has(index)}
                          onChange={() => toggle(index)}
                        />
                        <span>
                          {item.file && (
                            <code className="review-place">
                              {item.file}
                              {item.line ? `:${item.line}` : ''}
                            </code>
                          )}
                          <span className="review-text">{item.text}</span>
                        </span>
                      </label>
                    </li>
                  ))}
                </ul>
                {items.length > 0 && (
                  <button
                    type="button"
                    className="link-button"
                    onClick={() =>
                      setPicked(picked.size === items.length ? new Set() : new Set(items.keys()))
                    }
                  >
                    {picked.size === items.length ? t('reviewer.clear') : t('reviewer.selectAll')}
                  </button>
                )}
              </section>
            )}
          </>
        )}

        {error && (
          <p className="form-error" role="alert">
            {error}
          </p>
        )}

        <div className="dialog-actions">
          <button type="button" ref={closeButton} onClick={onClose}>
            {t('common.close')}
          </button>
          {summary ? (
            <>
              <button type="button" disabled={busy} onClick={() => void unlink()}>
                {t('reviewer.disable')}
              </button>
              <button
                type="button"
                data-testid="reviewer-run-now"
                disabled={busy || summary.state === 'preparing' || summary.state === 'waiting'}
                onClick={() => void reviewNow()}
              >
                {t('reviewer.runNow')}
              </button>
              {review?.state === 'ready' && (
                <button
                  type="button"
                  className="primary"
                  data-testid="reviewer-return"
                  disabled={picked.size === 0}
                  onClick={giveBack}
                >
                  {t('reviewer.return', { count: picked.size })}
                </button>
              )}
            </>
          ) : (
            <button
              type="button"
              className="primary"
              data-testid="reviewer-enable"
              disabled={busy || (kind === 'existing' && !existing)}
              onClick={() => void link()}
            >
              {t('reviewer.enable')}
            </button>
          )}
        </div>
      </div>
    </Dialog>
  );
}
