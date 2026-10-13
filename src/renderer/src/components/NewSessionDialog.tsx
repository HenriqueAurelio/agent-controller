import { useEffect, useState, type FormEvent } from 'react';
import type { AgentProfileId, SessionView } from '@shared/session';
import { baseName, errorMessage } from '../lib/format';
import { store, useAppState } from '../lib/store';
import { Dialog } from './Dialog';

interface Props {
  onClose(): void;
  onCreated(session: SessionView): void;
}

export function NewSessionDialog({ onClose, onCreated }: Props) {
  const agents = useAppState((s) => s.agents);
  const testMode = useAppState((s) => s.info.testMode);
  const [name, setName] = useState('');
  const [nameEdited, setNameEdited] = useState(false);
  const [cwd, setCwd] = useState('');
  const [profile, setProfile] = useState<AgentProfileId | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  // The agent may have been installed since the app opened.
  useEffect(() => void store.detectAgents(true), []);

  const usable = agents.filter((a) => a.usable);
  const chosen = profile ?? usable[0]?.profile ?? null;

  const pickFolder = async () => {
    const folder = await window.api.invoke('dialog:pickFolder', cwd || undefined);
    if (!folder) return;
    setCwd(folder);
    if (!nameEdited) setName(baseName(folder));
  };

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (!chosen || busy) return;
    setBusy(true);
    setError(null);
    try {
      const session = await window.api.invoke('sessions:create', {
        name: name.trim() || baseName(cwd),
        cwd: cwd.trim(),
        profile: chosen,
      });
      onCreated(session);
    } catch (err) {
      setError(errorMessage(err));
      setBusy(false);
    }
  };

  return (
    <Dialog title="Nova sessão" onClose={onClose}>
      <form onSubmit={submit} className="form">
        <label className="field">
          <span>Pasta</span>
          <div className="field-row">
            <input
              data-autofocus
              aria-label="Pasta"
              value={cwd}
              placeholder="Pasta onde o agente vai trabalhar"
              onChange={(e) => {
                setCwd(e.target.value);
                if (!nameEdited) setName(baseName(e.target.value));
              }}
            />
            {/* In test mode the native folder dialog cannot be driven; the path is typed. */}
            {!testMode && (
              <button type="button" onClick={pickFolder}>
                Escolher…
              </button>
            )}
          </div>
        </label>

        <label className="field">
          <span>Nome</span>
          <input
            aria-label="Nome"
            value={name}
            placeholder="Como a sessão aparece na barra lateral"
            onChange={(e) => {
              setName(e.target.value);
              setNameEdited(true);
            }}
          />
        </label>

        <fieldset className="field">
          <legend>Agente</legend>
          <div className="profile-options">
            {agents.map((agent) => (
              <label
                key={agent.profile}
                className={`profile-option ${chosen === agent.profile ? 'chosen' : ''} ${agent.usable ? '' : 'disabled'}`}
              >
                <input
                  type="radio"
                  name="profile"
                  value={agent.profile}
                  disabled={!agent.usable}
                  checked={chosen === agent.profile}
                  onChange={() => setProfile(agent.profile)}
                />
                <span className="profile-name">
                  {agent.displayName}
                  {agent.version && <span className="profile-version"> {agent.version}</span>}
                </span>
                {agent.message && (
                  <span className={`profile-note ${agent.usable ? 'warning' : 'blocking'}`}>
                    {agent.message}
                  </span>
                )}
              </label>
            ))}
            {agents.length === 0 && (
              <span className="muted">Procurando os agentes instalados…</span>
            )}
          </div>
        </fieldset>

        {error && (
          <p className="form-error" role="alert">
            {error}
          </p>
        )}

        <div className="dialog-actions">
          <button type="button" onClick={onClose}>
            Cancelar
          </button>
          <button type="submit" className="primary" disabled={!chosen || !cwd.trim() || busy}>
            Criar e iniciar
          </button>
        </div>
      </form>
    </Dialog>
  );
}
