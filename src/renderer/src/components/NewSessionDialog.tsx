import { useEffect, useState, type FormEvent } from 'react';
import type { AgentAvailability } from '@shared/agents';
import type { Translate } from '@shared/i18n';
import type { AgentProfileId, SessionView } from '@shared/session';
import { baseName, errorMessage } from '../lib/format';
import { useT } from '../lib/i18n';
import { store, useAppState } from '../lib/store';
import { Dialog } from './Dialog';
import { FolderField } from './FolderField';

interface Props {
  /** The folder the dialog opens with, when it was asked for one (a folder dropped on the app). */
  initialCwd?: string;
  onClose(): void;
  onCreated(session: SessionView): void;
}

/** What is wrong with an agent that is not found, or not in a version the app knows. */
function availabilityNote(t: Translate, agent: AgentAvailability): string | null {
  const { displayName: name, version = '' } = agent;
  if (agent.status === 'missing') {
    return t('agent.missing', { name, command: agent.installCommand });
  }
  if (agent.status === 'outdated') {
    return t('agent.outdated', { name, version, min: agent.minVersion });
  }
  if (agent.status === 'newer-than-tested') {
    return t('agent.newer', { version, tested: agent.lastTestedVersion });
  }
  return null;
}

export function NewSessionDialog({ initialCwd, onClose, onCreated }: Props) {
  const t = useT();
  const agents = useAppState((s) => s.agents);
  const defaultFolder = useAppState((s) => s.prefs.defaultFolder);
  // With no folder asked for and none set as the initial one, the latest one used is offered.
  const [suggested] = useState(
    () => initialCwd || defaultFolder || (store.get().recentFolders[0] ?? ''),
  );
  const [name, setName] = useState(baseName(suggested));
  const [nameEdited, setNameEdited] = useState(false);
  const [cwd, setCwd] = useState(suggested);
  const [profile, setProfile] = useState<AgentProfileId | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  // The agent may have been installed since the app opened.
  useEffect(() => void store.detectAgents(true), []);

  const usable = agents.filter((a) => a.usable);
  const chosen = profile ?? usable[0]?.profile ?? null;

  const applyFolder = (folder: string) => {
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
    <Dialog title={t('shortcut.newSession')} onClose={onClose}>
      <form onSubmit={submit} className="form">
        <FolderField
          value={cwd}
          placeholder={t('newSession.folderPlaceholder')}
          onChange={applyFolder}
        />

        <label className="field">
          <span>{t('newSession.name')}</span>
          <input
            aria-label={t('newSession.name')}
            value={name}
            placeholder={t('newSession.namePlaceholder')}
            onChange={(e) => {
              setName(e.target.value);
              setNameEdited(true);
            }}
          />
        </label>

        <fieldset className="field">
          <legend>{t('newSession.agent')}</legend>
          <div className="profile-options">
            {agents.map((agent) => {
              const note = availabilityNote(t, agent);
              return (
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
                  {note && (
                    <span className={`profile-note ${agent.usable ? 'warning' : 'blocking'}`}>
                      {note}
                    </span>
                  )}
                </label>
              );
            })}
            {agents.length === 0 && <span className="muted">{t('newSession.detecting')}</span>}
          </div>
        </fieldset>

        {error && (
          <p className="form-error" role="alert">
            {error}
          </p>
        )}

        <div className="dialog-actions">
          <button type="button" onClick={onClose}>
            {t('common.cancel')}
          </button>
          <button type="submit" className="primary" disabled={!chosen || !cwd.trim() || busy}>
            {t('newSession.submit')}
          </button>
        </div>
      </form>
    </Dialog>
  );
}
