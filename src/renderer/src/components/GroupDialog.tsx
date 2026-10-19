import { useState, type FormEvent } from 'react';
import { GROUP_NAME_LIMIT, type SessionGroup } from '@shared/session';
import { baseName, errorMessage } from '../lib/format';
import { useT } from '../lib/i18n';
import { store, useAppState } from '../lib/store';
import { Dialog } from './Dialog';

interface Props {
  /** The group being edited; absent, a new one is created. */
  group?: SessionGroup;
  /** A context-menu session enters its new group even when it was in another group. */
  initialSessionId?: string;
  onClose(): void;
}

/**
 * Names a group and picks its sessions. A new one starts from the folder of the session in sight:
 * its name, and every session open in that folder, which is what a group of a repository holds.
 */
export function GroupDialog({ group, initialSessionId, onClose }: Props) {
  const t = useT();
  const sessions = useAppState((s) => s.sessions);
  const groups = useAppState((s) => s.groups);
  const [initial] = useState(() => {
    if (group) {
      return { name: group.name, ids: sessions.filter((s) => s.groupId === group.id) };
    }
    const { selectedId, info } = store.get();
    const selected = sessions.find((s) => s.id === selectedId);
    if (!selected) return { name: '', ids: [] };
    // Windows does not tell `C:\Repo` from `c:\repo`.
    const key = (folder: string) => (info.platform === 'win32' ? folder.toLowerCase() : folder);
    const folder = key(selected.cwd);
    return {
      name: baseName(selected.cwd),
      ids: sessions.filter(
        (s) => key(s.cwd) === folder && (!s.groupId || s.id === initialSessionId),
      ),
    };
  });
  const [name, setName] = useState(initial.name);
  const [chosen, setChosen] = useState(() => new Set(initial.ids.map((s) => s.id)));
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const toggle = (id: string, on: boolean) => {
    const next = new Set(chosen);
    if (on) next.add(id);
    else next.delete(id);
    setChosen(next);
  };

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (busy) return;
    setBusy(true);
    setError(null);
    // In the order of the list, so they keep their places among themselves.
    const ids = sessions.filter((s) => chosen.has(s.id)).map((s) => s.id);
    try {
      if (group) await window.api.invoke('groups:update', group.id, { name, sessionIds: ids });
      else await window.api.invoke('groups:create', name, ids);
      onClose();
    } catch (err) {
      setError(errorMessage(err));
      setBusy(false);
    }
  };

  const groupName = (id: string | undefined) => groups.find((g) => g.id === id)?.name;

  return (
    <Dialog
      title={group ? t('groupDialog.editTitle') : t('groupDialog.createTitle')}
      onClose={onClose}
    >
      <form onSubmit={submit} className="form">
        <label className="field">
          <span>{t('groupDialog.name')}</span>
          <input
            aria-label={t('groupDialog.name')}
            value={name}
            maxLength={GROUP_NAME_LIMIT}
            placeholder={t('groupDialog.namePlaceholder')}
            onChange={(e) => setName(e.target.value)}
          />
        </label>

        <fieldset className="field">
          <legend>{t('groupDialog.sessions')}</legend>
          {sessions.length === 0 ? (
            <span className="muted">{t('groupDialog.noSessions')}</span>
          ) : (
            <div className="group-choices">
              {sessions.map((session) => {
                const other = session.groupId !== group?.id && groupName(session.groupId);
                return (
                  <label key={session.id} className="group-choice">
                    <input
                      type="checkbox"
                      checked={chosen.has(session.id)}
                      onChange={(e) => toggle(session.id, e.target.checked)}
                    />
                    <span className="group-choice-name">{session.name}</span>
                    <span className="muted group-choice-folder" title={session.cwd}>
                      {session.cwd}
                    </span>
                    {other && (
                      <span className="muted">{t('groupDialog.inOther', { group: other })}</span>
                    )}
                  </label>
                );
              })}
            </div>
          )}
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
          <button type="submit" className="primary" disabled={!name.trim() || busy}>
            {group ? t('groupDialog.save') : t('groupDialog.create')}
          </button>
        </div>
      </form>
    </Dialog>
  );
}
