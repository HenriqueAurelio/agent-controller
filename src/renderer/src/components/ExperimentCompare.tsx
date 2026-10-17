import { useCallback, useEffect, useRef, useState } from 'react';
import type { AttemptDiff, Comparison, KeepResult } from '@shared/experiments';
import { statusLabel } from '@shared/session';
import { errorMessage, formatBytes, PROFILE_LABEL } from '../lib/format';
import { useT } from '../lib/i18n';
import { store, useAppState } from '../lib/store';
import { ChecksBadge } from './ChecksDialog';
import { Dialog } from './Dialog';

interface Props {
  experimentId: string;
  onClose(): void;
  /** Opens one attempt as the session in sight. */
  onOpenSession(sessionId: string): void;
}

const REFRESH_MS = 3000;

/** m:ss, or h:mm:ss: the time an attempt took is read at a glance. */
function clock(ms: number): string {
  const total = Math.floor(ms / 1000);
  const seconds = String(total % 60).padStart(2, '0');
  const minutes = Math.floor(total / 60);
  return minutes < 60
    ? `${minutes}:${seconds}`
    : `${Math.floor(minutes / 60)}:${String(minutes % 60).padStart(2, '0')}:${seconds}`;
}

/** The lines of a unified diff, colored by what they do. */
function DiffText({ text }: { text: string }) {
  return (
    <pre className="compare-diff" data-testid="compare-diff">
      {text.split('\n').map((line, index) => {
        const kind = line.startsWith('@@')
          ? 'hunk'
          : line.startsWith('+') && !line.startsWith('+++')
            ? 'add'
            : line.startsWith('-') && !line.startsWith('---')
              ? 'del'
              : '';
        return (
          <span key={index} className={`compare-line ${kind}`}>
            {line || ' '}
            {'\n'}
          </span>
        );
      })}
    </pre>
  );
}

/**
 * The attempts of an experiment side by side: one row each, and one file at a time in all of them,
 * against the same base. It follows the attempts while they work.
 */
export function ExperimentCompare({ experimentId, onClose, onOpenSession }: Props) {
  const t = useT();
  const sessions = useAppState((s) => s.sessions);
  const [comparison, setComparison] = useState<Comparison | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [file, setFile] = useState<string | null>(null);
  const [diffs, setDiffs] = useState<AttemptDiff[] | null>(null);
  const [asking, setAsking] = useState<string | null>(null);
  const [keeping, setKeeping] = useState(false);
  const [result, setResult] = useState<KeepResult | null>(null);
  const fileRef = useRef<string | null>(null);
  fileRef.current = file;

  const refresh = useCallback(async () => {
    try {
      const next = await window.api.invoke('experiments:compare', experimentId);
      setComparison(next);
      setError(null);
      const open = fileRef.current;
      if (open) {
        const found = await window.api.invoke('experiments:diff', experimentId, open);
        if (fileRef.current === open) setDiffs(found);
      }
    } catch (err) {
      setError(errorMessage(err));
    }
  }, [experimentId]);

  useEffect(() => {
    void refresh();
    const timer = window.setInterval(() => void refresh(), REFRESH_MS);
    return () => window.clearInterval(timer);
  }, [refresh]);

  const pick = (path: string) => {
    setFile(path);
    fileRef.current = path;
    setDiffs(null);
    void window.api
      .invoke('experiments:diff', experimentId, path)
      .then((found) => fileRef.current === path && setDiffs(found))
      .catch((err) => setError(errorMessage(err)));
  };

  const keep = async (sessionId: string) => {
    setKeeping(true);
    setError(null);
    try {
      const outcome = await window.api.invoke('experiments:keep', experimentId, sessionId);
      setResult(outcome);
      setAsking(null);
      if (outcome.kept.length === 0) {
        store.select(sessionId);
        onClose();
        return;
      }
      void refresh();
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setKeeping(false);
    }
  };

  const nameOf = (sessionId: string) =>
    comparison?.attempts.find((a) => a.sessionId === sessionId)?.name ?? '';
  const statusOf = (sessionId: string) => sessions.find((s) => s.id === sessionId)?.status;

  return (
    <Dialog
      title={t('compare.title', { name: comparison?.name ?? '' })}
      onClose={onClose}
      className="experiment-compare"
    >
      {comparison && (
        <>
          <p className="muted compare-prompt" title={comparison.prompt}>
            {t('compare.base', { base: comparison.base })} · {comparison.prompt}
          </p>
          <table className="compare-table" data-testid="compare-table">
            <thead>
              <tr>
                <th>{t('compare.attempt')}</th>
                <th>{t('compare.state')}</th>
                <th>{t('compare.checks')}</th>
                <th>{t('compare.files')}</th>
                <th>{t('compare.lines')}</th>
                <th>{t('compare.time')}</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {comparison.attempts.map((attempt) => {
                const status = statusOf(attempt.sessionId);
                return (
                  <tr key={attempt.sessionId} data-testid="compare-row">
                    <td>
                      <button
                        type="button"
                        className="link-button"
                        title={t('compare.open', { name: attempt.name })}
                        aria-label={t('compare.open', { name: attempt.name })}
                        onClick={() => {
                          onOpenSession(attempt.sessionId);
                        }}
                      >
                        {attempt.name}
                      </button>
                      <span className="muted compare-sub">
                        {PROFILE_LABEL[attempt.profile]} · {attempt.branch}
                        {attempt.chosen && ` · ${t('compare.chosen')}`}
                      </span>
                    </td>
                    <td>
                      {status ? statusLabel(t, status) : attempt.state}
                      {!attempt.promptSent && (
                        <span className="muted compare-sub">{t('compare.notSent')}</span>
                      )}
                    </td>
                    <td>
                      {attempt.checks ? (
                        <ChecksBadge summary={attempt.checks} />
                      ) : (
                        <span className="muted">{t('compare.checksNone')}</span>
                      )}
                    </td>
                    <td data-testid="compare-files">{attempt.files.length}</td>
                    <td data-testid="compare-lines">
                      <span className="compare-add">+{attempt.added}</span>{' '}
                      <span className="compare-del">−{attempt.removed}</span>
                    </td>
                    <td>{attempt.elapsedMs === null ? '–' : clock(attempt.elapsedMs)}</td>
                    <td>
                      <button
                        type="button"
                        disabled={keeping}
                        aria-label={`${t('compare.keep')}: ${attempt.name}`}
                        onClick={() => setAsking(attempt.sessionId)}
                      >
                        {t('compare.keep')}
                      </button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>

          {asking && (
            <div className="compare-ask" role="alertdialog" data-testid="compare-ask">
              <p>
                {t('compare.keepAsk', {
                  name: nameOf(asking),
                  count: comparison.attempts.length - 1,
                })}
              </p>
              <div className="dialog-actions">
                <button type="button" onClick={() => setAsking(null)} disabled={keeping}>
                  {t('common.cancel')}
                </button>
                <button
                  type="button"
                  className="primary"
                  disabled={keeping}
                  onClick={() => void keep(asking)}
                >
                  {keeping ? t('compare.keeping') : t('compare.keepConfirm')}
                </button>
              </div>
            </div>
          )}

          {result && result.kept.length > 0 && (
            <div className="compare-kept" role="status" data-testid="compare-kept">
              <p>{t('compare.notRemoved')}</p>
              <ul>
                {result.kept.map((kept) => (
                  <li key={kept.sessionId}>
                    <strong>{kept.name}</strong> <span className="muted">{kept.folder}</span>
                    <div>{kept.reason}</div>
                  </li>
                ))}
              </ul>
            </div>
          )}

          <h3 className="compare-heading">{t('compare.filesTitle')}</h3>
          {comparison.files.length === 0 ? (
            <p className="muted">{t('compare.noFiles')}</p>
          ) : (
            <div className="compare-files" role="listbox" aria-label={t('compare.filesTitle')}>
              {comparison.files.map((path) => (
                <button
                  key={path}
                  type="button"
                  role="option"
                  aria-selected={file === path}
                  className={`compare-file ${file === path ? 'selected' : ''}`}
                  onClick={() => pick(path)}
                >
                  {path}
                </button>
              ))}
            </div>
          )}
          {comparison.attempts.some((a) => a.filesCut) && (
            <p className="muted">{t('compare.filesCut')}</p>
          )}
          {file === null && comparison.files.length > 0 && (
            <p className="muted">{t('compare.pickFile')}</p>
          )}

          {file !== null && diffs && (
            <div
              className="compare-columns"
              style={{
                gridTemplateColumns: `repeat(${comparison.attempts.length}, minmax(0, 1fr))`,
              }}
            >
              {comparison.attempts.map((attempt) => {
                const diff = diffs.find((d) => d.sessionId === attempt.sessionId);
                return (
                  <section key={attempt.sessionId} className="compare-column">
                    <header>{attempt.name}</header>
                    {!diff || diff.kind === 'unchanged' ? (
                      <p className="muted">{t('compare.unchanged')}</p>
                    ) : diff.kind === 'binary' ? (
                      <p className="muted">{t('compare.binary')}</p>
                    ) : diff.kind === 'too-large' ? (
                      <p className="muted">
                        {t('compare.tooLarge', { size: formatBytes(diff.size) })}
                      </p>
                    ) : (
                      <DiffText text={diff.text} />
                    )}
                  </section>
                );
              })}
            </div>
          )}
        </>
      )}

      {error && (
        <p className="form-error" role="alert">
          {error}
        </p>
      )}
      <div className="dialog-actions">
        <button type="button" onClick={onClose}>
          {t('common.close')}
        </button>
      </div>
    </Dialog>
  );
}
