import { useState, type FormEvent } from 'react';
import type { SessionView } from '@shared/session';
import { errorMessage } from '../lib/format';
import { Dialog } from './Dialog';
import { FolderField } from './FolderField';

interface Props {
  session: SessionView;
  onClose(): void;
  /** The session is in the new folder. `restart`: its agent was running and was ended for it. */
  onChanged(restart: boolean): void;
}

export function ChangeFolderDialog({ session, onClose, onChanged }: Props) {
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
    <Dialog title="Trocar pasta" onClose={onClose}>
      <form onSubmit={submit} className="form">
        <FolderField value={cwd} onChange={setCwd} placeholder="Nova pasta da sessão" />
        {session.running && (
          <p className="form-note">
            O agente de <strong>{session.name}</strong> está rodando. Trocar a pasta vai encerrá-lo,
            junto com o que ele tiver iniciado, e abri-lo de novo na nova pasta: a conversa atual
            não continua.
          </p>
        )}
        {error && (
          <p className="form-error" role="alert">
            {error}
          </p>
        )}
        <div className="dialog-actions">
          <button type="button" onClick={onClose}>
            Cancelar
          </button>
          <button
            type="submit"
            className={session.running ? 'danger' : 'primary'}
            disabled={!cwd.trim() || cwd.trim() === session.cwd || busy}
          >
            {session.running ? 'Encerrar e trocar' : 'Trocar pasta'}
          </button>
        </div>
      </form>
    </Dialog>
  );
}
