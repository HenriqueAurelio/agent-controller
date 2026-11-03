import { useEffect, useState } from 'react';
import type { DiffHunk } from '@shared/git';
import type { FileCommit, LineBlame } from '@shared/history';
import { errorMessage } from '../lib/format';
import { useT } from '../lib/i18n';
import { Dialog } from './Dialog';

interface Props {
  sessionId: string;
  path: string;
  /** The line of the cursor: who last changed it shows on top. */
  line: number | null;
  onClose(): void;
}

const shortDate = (iso: string) => (iso ? new Date(iso).toLocaleString() : '');

/** The commits that touched a file, what each changed in it, and who last changed a line. */
export function FileHistoryDialog({ sessionId, path, line, onClose }: Props) {
  const t = useT();
  const [commits, setCommits] = useState<FileCommit[] | null>(null);
  const [blame, setBlame] = useState<LineBlame | null>(null);
  const [chosen, setChosen] = useState<string | null>(null);
  const [hunks, setHunks] = useState<DiffHunk[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    window.api
      .invoke('git:log', sessionId, path)
      .then((list) => {
        if (cancelled) return;
        setCommits(list);
        setChosen((current) => current ?? list[0]?.sha ?? null);
      })
      .catch((err) => !cancelled && setError(errorMessage(err)));
    if (line) {
      window.api
        .invoke('git:blameLine', sessionId, path, line)
        .then((found) => {
          if (cancelled) return;
          setBlame(found);
          if (found && !found.uncommitted) setChosen(found.sha);
        })
        .catch(() => {});
    }
    return () => {
      cancelled = true;
    };
  }, [sessionId, path, line]);

  useEffect(() => {
    if (!chosen) return;
    let cancelled = false;
    setHunks(null);
    window.api
      .invoke('git:commitDiff', sessionId, path, chosen)
      .then((found) => !cancelled && setHunks(found))
      .catch((err) => !cancelled && setError(errorMessage(err)));
    return () => {
      cancelled = true;
    };
  }, [sessionId, path, chosen]);

  return (
    <Dialog title={t('history.title', { file: path })} onClose={onClose} className="history-dialog">
      {line !== null && blame && (
        <p className="history-blame" data-testid="history-blame">
          {blame.uncommitted
            ? t('history.uncommitted', { line })
            : t('history.blame', {
                line,
                author: blame.author,
                date: shortDate(blame.date),
                subject: blame.subject,
              })}
        </p>
      )}
      {error && (
        <p className="form-error" role="alert">
          {error}
        </p>
      )}
      <div className="history-body">
        <ul className="history-list" data-testid="history-list">
          {commits?.length === 0 && <li className="muted">{t('history.none')}</li>}
          {commits?.map((c) => (
            <li key={c.sha}>
              <button
                className={`history-commit ${c.sha === chosen ? 'current' : ''}`}
                data-testid="history-commit"
                onClick={() => setChosen(c.sha)}
              >
                <span className="history-subject">{c.subject}</span>
                <span className="muted">
                  {c.sha.slice(0, 7)} · {c.author} · {shortDate(c.date)}
                </span>
              </button>
            </li>
          ))}
        </ul>
        <div className="history-diff" data-testid="history-diff">
          {hunks?.map((hunk) => (
            <div key={hunk.id} className="multidiff-lines">
              {hunk.lines.map((l, i) => (
                <div key={i} className={`multidiff-line line-${l.kind}`}>
                  <span className="multidiff-no">{l.oldNo ?? ''}</span>
                  <span className="multidiff-no">{l.newNo ?? ''}</span>
                  <span className="multidiff-sign">
                    {l.kind === 'add' ? '+' : l.kind === 'del' ? '-' : ' '}
                  </span>
                  <span className="multidiff-text">{l.text}</span>
                </div>
              ))}
            </div>
          ))}
        </div>
      </div>
    </Dialog>
  );
}
