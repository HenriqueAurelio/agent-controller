import { useEffect, useState } from 'react';
import type { FileChange } from '@shared/git';
import type { SessionView, WorktreeOnClose } from '@shared/session';
import { errorMessage } from '../lib/format';
import { rich, useT } from '../lib/i18n';
import { useAppState } from '../lib/store';
import { Dialog } from './Dialog';

interface Props {
  session: SessionView;
  onClose(): void;
}

/**
 * Asks before closing a session whose agent is running, and, for a session in a copy of its
 * repository, what to do with the copy: keep it (the default) or remove it, which is only offered
 * when nothing in it is uncommitted and no other session works in it.
 */
export function CloseSessionDialog({ session, onClose }: Props) {
  const t = useT();
  const sessions = useAppState((s) => s.sessions);
  const worktree = session.worktree;
  const [choice, setChoice] = useState<WorktreeOnClose>('keep');
  const [pending, setPending] = useState<FileChange[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const sharedWith = sessions.find((s) => s.id !== session.id && s.cwd === session.cwd);

  useEffect(() => {
    if (!worktree) return;
    let cancelled = false;
    void window.api
      .invoke('worktrees:status', session.id)
      .then((changes) => !cancelled && setPending(changes))
      .catch((err) => !cancelled && setError(errorMessage(err)));
    return () => {
      cancelled = true;
    };
  }, [session.id, worktree]);

  const canRemove = pending !== null && pending.length === 0 && !sharedWith;
  const close = async () => {
    setBusy(true);
    setError(null);
    try {
      await window.api.invoke('sessions:remove', session.id, {
        worktree: worktree && canRemove ? choice : 'keep',
      });
      onClose();
    } catch (err) {
      setError(errorMessage(err));
      setBusy(false);
    }
  };

  return (
    <Dialog title={t('app.closeSession.title')} onClose={onClose}>
      {session.running && (
        <p>{rich(t('app.closeSession.body'), { name: <strong>{session.name}</strong> })}</p>
      )}
      {worktree && (
        <fieldset className="field worktree-close">
          <legend>{t('closeWorktree.question')}</legend>
          <span className="muted path" title={session.cwd}>
            {session.cwd}
          </span>
          <label className="check">
            <input
              type="radio"
              name="worktree"
              checked={choice === 'keep'}
              onChange={() => setChoice('keep')}
            />
            <span>
              {t('closeWorktree.keep')}
              <span className="muted">
                {' '}
                — {t('closeWorktree.keepHint', { branch: worktree.branch })}
              </span>
            </span>
          </label>
          <label className={`check ${canRemove ? '' : 'disabled'}`}>
            <input
              type="radio"
              name="worktree"
              disabled={!canRemove}
              checked={choice === 'remove'}
              onChange={() => setChoice('remove')}
            />
            <span>
              {t('closeWorktree.remove')}
              <span className="muted">
                {' '}
                — {t('closeWorktree.removeHint', { branch: worktree.branch })}
              </span>
            </span>
          </label>
          {pending === null && !error && (
            <span className="muted">{t('closeWorktree.checking')}</span>
          )}
          {sharedWith && (
            <p className="form-note">{t('closeWorktree.shared', { name: sharedWith.name })}</p>
          )}
          {pending && pending.length > 0 && (
            <div className="form-note" data-testid="worktree-pending">
              {t('closeWorktree.dirty', { count: pending.length })}
              <ul className="worktree-pending">
                {pending.slice(0, 10).map((change) => (
                  <li key={change.path}>
                    <code>{change.path}</code>
                  </li>
                ))}
                {pending.length > 10 && (
                  <li className="muted">
                    {t('closeWorktree.more', { count: pending.length - 10 })}
                  </li>
                )}
              </ul>
            </div>
          )}
        </fieldset>
      )}
      {error && (
        <p className="form-error" role="alert">
          {error}
        </p>
      )}
      <div className="dialog-actions">
        <button data-autofocus onClick={onClose}>
          {t('common.cancel')}
        </button>
        <button className="danger" disabled={busy} onClick={() => void close()}>
          {session.running ? t('app.closeSession.confirm') : t('closeWorktree.confirm')}
        </button>
      </div>
    </Dialog>
  );
}
