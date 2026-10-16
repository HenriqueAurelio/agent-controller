import { useState, type FormEvent } from 'react';
import type { SessionView } from '@shared/session';
import { errorMessage } from '../lib/format';
import { rich, useT } from '../lib/i18n';
import { Dialog } from './Dialog';
import { FolderField } from './FolderField';

interface Props {
  session: SessionView;
  onClose(): void;
  /** The session is in the new folder. `restart`: its agent was running and was ended for it. */
  onChanged(restart: boolean): void;
}

export function ChangeFolderDialog({ session, onClose, onChanged }: Props) {
  const t = useT();
  const [cwd, setCwd] = useState(session.cwd);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      onChanged(await window.api.invoke('sessions:setCwd', session.id, cwd.trim()));
    } catch (err) {
      setError(errorMessage(err));
      setBusy(false);
    }
  };

  return (
    <Dialog title={t('changeFolder.title')} onClose={onClose}>
      <form onSubmit={submit} className="form">
        <FolderField value={cwd} onChange={setCwd} placeholder={t('changeFolder.placeholder')} />
        {session.running && (
          <p className="form-note">
            {rich(t('changeFolder.running'), { name: <strong>{session.name}</strong> })}
          </p>
        )}
        {session.auxOpen && <p className="form-note">{t('changeFolder.aux')}</p>}
        {error && (
          <p className="form-error" role="alert">
            {error}
          </p>
        )}
        <div className="dialog-actions">
          <button type="button" onClick={onClose}>
            {t('common.cancel')}
          </button>
          <button
            type="submit"
            className={session.running ? 'danger' : 'primary'}
            disabled={!cwd.trim() || cwd.trim() === session.cwd || busy}
          >
            {session.running ? t('changeFolder.confirmRunning') : t('changeFolder.title')}
          </button>
        </div>
      </form>
    </Dialog>
  );
}
