import { useState } from 'react';
import { checkpointBase, type CheckpointInfo } from '@shared/checkpoints';
import type { DiffBase } from '@shared/git';
import type { SessionView } from '@shared/session';
import { checkpointLabel, useCheckpoints } from '../lib/checkpoints';
import { errorMessage } from '../lib/format';
import { useT } from '../lib/i18n';
import { useAppState } from '../lib/store';
import { Dialog } from './Dialog';

interface Props {
  session: SessionView;
  onClose(): void;
  /** Opens the changes panel comparing with this base. */
  onCompare(base: DiffBase): void;
}

/** What the folder now is, after going back: the way to undo it, and whether the agent knows. */
interface Restored {
  label: string;
  undoId: string;
  changed: number;
  told: boolean;
}

const NOW = 'now';

/**
 * The timeline of a session (ADR 0021): a checkpoint at the end of each turn that changed files,
 * with what each one changed, going back to one, and undoing that.
 */
export function TimelineDialog({ session, onClose, onCompare }: Props) {
  const t = useT();
  const language = useAppState((s) => s.prefs.language);
  const submit = useAppState((s) => s.prefs.promptSubmit);
  const list = useCheckpoints(session.id);
  const items = list?.items ?? [];
  const newestFirst = [...items].reverse();
  const [restored, setRestored] = useState<Restored | null>(null);
  const [undone, setUndone] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [from, setFrom] = useState<string | null>(null);
  const [to, setTo] = useState<string>(NOW);

  const time = (at: number) =>
    new Date(at).toLocaleString(language, { dateStyle: 'short', timeStyle: 'medium' });
  const pairFrom = from ?? items.at(-2)?.id ?? items[0]?.id ?? '';

  const run = async (work: () => Promise<void>) => {
    setBusy(true);
    setError(null);
    try {
      await work();
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  };

  const restore = (checkpoint: CheckpointInfo) => {
    const label = checkpointLabel(t, checkpoint);
    if (!window.confirm(t('timeline.restoreConfirm', { label }))) return;
    if (session.status.state === 'trabalhando' && !window.confirm(t('timeline.agentWorking'))) {
      return;
    }
    void run(async () => {
      const result = await window.api.invoke('checkpoints:restore', session.id, checkpoint.id);
      setUndone(false);
      setRestored({ label, undoId: result.undoId, changed: result.changed, told: false });
    });
  };
  const undo = () => {
    if (!restored) return;
    if (session.status.state === 'trabalhando' && !window.confirm(t('timeline.agentWorking'))) {
      return;
    }
    void run(async () => {
      await window.api.invoke('checkpoints:restore', session.id, restored.undoId);
      setRestored(null);
      setUndone(true);
    });
  };
  const tellAgent = () =>
    void run(async () => {
      if (!restored) return;
      await window.api.invoke(
        'terminal:sendText',
        [session.id],
        { text: t('timeline.tellAgentText', { label: restored.label }) },
        { submit },
      );
      setRestored({ ...restored, told: true });
    });

  return (
    <Dialog
      title={t('timeline.title', { name: session.name })}
      onClose={onClose}
      className="timeline-dialog"
    >
      <p className="muted timeline-intro">{t('timeline.intro')}</p>

      {list && items.length === 0 && <p className="timeline-empty">{t('timeline.empty')}</p>}

      {restored && (
        <div className="timeline-restored" role="status" data-testid="timeline-restored">
          <span>{t('timeline.restored', { label: restored.label, count: restored.changed })}</span>
          <div className="timeline-restored-actions">
            <button disabled={busy} onClick={undo}>
              {t('timeline.undo')}
            </button>
            <button
              disabled={busy || restored.told || !session.running}
              title={t('timeline.tellAgentHint')}
              onClick={tellAgent}
            >
              {t('timeline.tellAgent')}
            </button>
          </div>
          {restored.told && <span className="muted">{t('timeline.told')}</span>}
        </div>
      )}
      {undone && (
        <p className="timeline-restored" role="status">
          {t('timeline.undone')}
        </p>
      )}

      {items.length > 0 && (
        <ol className="timeline-list" aria-label={t('app.timeline')}>
          {newestFirst.map((checkpoint) => {
            const label = checkpointLabel(t, checkpoint);
            const before = items[items.indexOf(checkpoint) - 1];
            return (
              <li
                key={checkpoint.id}
                className={`timeline-item kind-${checkpoint.kind}`}
                data-checkpoint={checkpoint.id}
              >
                <div className="timeline-body">
                  <span className="timeline-label">
                    <strong>{label}</strong>
                    {checkpoint.checks && (
                      <span
                        className={`timeline-checks checks-${checkpoint.checks}`}
                        title={t(
                          checkpoint.checks === 'passed'
                            ? 'timeline.checksPassed'
                            : 'timeline.checksFailed',
                        )}
                        aria-label={t(
                          checkpoint.checks === 'passed'
                            ? 'timeline.checksPassed'
                            : 'timeline.checksFailed',
                        )}
                      >
                        {checkpoint.checks === 'passed' ? '✓' : '✗'}
                      </span>
                    )}
                  </span>
                  <span className="muted">
                    {time(checkpoint.at)} · {t('timeline.files', { count: checkpoint.files })}
                  </span>
                  {checkpoint.skipped.length > 0 && (
                    <span className="muted timeline-skipped">
                      {t('timeline.skipped', {
                        count: checkpoint.skipped.length,
                        files: checkpoint.skipped.slice(0, 3).join(', '),
                      })}
                    </span>
                  )}
                </div>
                <div className="timeline-actions">
                  {before && (
                    <button
                      title={t('timeline.seeTurnHint')}
                      onClick={() => onCompare(checkpointBase(before.id, checkpoint.id))}
                    >
                      {t('timeline.seeTurn')}
                    </button>
                  )}
                  <button
                    aria-label={t('timeline.restoreOf', { label })}
                    disabled={busy}
                    onClick={() => restore(checkpoint)}
                  >
                    {t('timeline.restore')}
                  </button>
                </div>
              </li>
            );
          })}
        </ol>
      )}

      {items.length > 1 && (
        <fieldset className="field timeline-pair">
          <legend>{t('timeline.pair')}</legend>
          <div className="timeline-pair-row">
            <label className="field-inline">
              <span>{t('timeline.from')}</span>
              <select
                aria-label={t('timeline.from')}
                value={pairFrom}
                onChange={(e) => setFrom(e.target.value)}
              >
                {items.map((c) => (
                  <option key={c.id} value={c.id}>
                    {checkpointLabel(t, c)}
                  </option>
                ))}
              </select>
            </label>
            <label className="field-inline">
              <span>{t('timeline.to')}</span>
              <select
                aria-label={t('timeline.to')}
                value={to}
                onChange={(e) => setTo(e.target.value)}
              >
                <option value={NOW}>{t('timeline.folderNow')}</option>
                {items.map((c) => (
                  <option key={c.id} value={c.id}>
                    {checkpointLabel(t, c)}
                  </option>
                ))}
              </select>
            </label>
            <button
              disabled={to === pairFrom}
              onClick={() => onCompare(checkpointBase(pairFrom, to === NOW ? undefined : to))}
            >
              {t('timeline.compare')}
            </button>
          </div>
        </fieldset>
      )}

      <p className="muted timeline-note">{t('timeline.rewind')}</p>

      {error && (
        <p className="form-error" role="alert">
          {error}
        </p>
      )}
      <div className="dialog-actions">
        <button className="primary" data-autofocus onClick={onClose}>
          {t('common.close')}
        </button>
      </div>
    </Dialog>
  );
}
