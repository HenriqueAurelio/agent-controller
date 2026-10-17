import { useEffect, useState, type FormEvent } from 'react';
import type { WorktreeOrigin } from '@shared/ipc';
import type { AgentProfileId } from '@shared/session';
import {
  draftsFromLines,
  TASK_DESCRIPTION_LIMIT,
  TASK_TITLE_LIMIT,
  TASKS_PER_PASTE_LIMIT,
  type TaskBoardState,
} from '@shared/tasks';
import { errorMessage, PROFILE_LABEL } from '../lib/format';
import { useT } from '../lib/i18n';
import { store, useAppState } from '../lib/store';
import { Dialog } from './Dialog';

interface Props {
  /** The repository of the board the card goes on. */
  folder: string;
  onClose(): void;
  onCreated(state: TaskBoardState): void;
}

/**
 * A new card, or several: one per line of the title, which is what pasting a list gives. Every
 * card gets the same agent and options; a single card also gets the description.
 */
export function TaskDialog({ folder, onClose, onCreated }: Props) {
  const t = useT();
  const agents = useAppState((s) => s.agents);
  const groups = useAppState((s) => s.groups);
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [profile, setProfile] = useState<AgentProfileId | ''>('');
  const [isolated, setIsolated] = useState(true);
  const [groupId, setGroupId] = useState('');
  const [origin, setOrigin] = useState<WorktreeOrigin | null>(null);
  const [base, setBase] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => void store.detectAgents(true), []);
  const usable = agents.filter((a) => a.usable);
  const chosen = profile || usable[0]?.profile || agents[0]?.profile || 'claude-code';

  useEffect(() => {
    let cancelled = false;
    void window.api
      .invoke('worktrees:inspect', folder)
      .then((found) => {
        if (cancelled) return;
        setOrigin(found);
        setBase((current) =>
          current && found.branches.includes(current) ? current : (found.branches[0] ?? ''),
        );
      })
      .catch(() => !cancelled && setOrigin(null));
    return () => {
      cancelled = true;
    };
  }, [folder]);

  const drafts = draftsFromLines(title);
  const many = drafts.length > 1;
  const ready = drafts.length > 0 && drafts.length <= TASKS_PER_PASTE_LIMIT && (!isolated || base);

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (!ready || busy) return;
    setBusy(true);
    setError(null);
    try {
      const state = await window.api.invoke('tasks:create', {
        cwd: folder,
        profile: chosen,
        isolated,
        base: base || 'HEAD',
        ...(groupId && { groupId }),
        drafts: many ? drafts : [{ title: drafts[0]!.title, description }],
      });
      onCreated(state);
    } catch (err) {
      setError(errorMessage(err));
      setBusy(false);
    }
  };

  return (
    <Dialog title={t('task.title')} onClose={onClose} className="task-dialog">
      <form onSubmit={submit} className="form">
        <p className="muted path" title={folder}>
          {folder}
        </p>
        <label className="field">
          <span>{t('task.name')}</span>
          <textarea
            aria-label={t('task.name')}
            data-autofocus
            rows={3}
            value={title}
            maxLength={TASK_TITLE_LIMIT * TASKS_PER_PASTE_LIMIT}
            placeholder={t('task.namePlaceholder')}
            onChange={(e) => setTitle(e.target.value)}
          />
        </label>
        {many ? (
          <p className="muted" role="status" data-testid="task-many">
            {t('task.many', { count: drafts.length })}
          </p>
        ) : (
          <label className="field">
            <span>{t('task.description')}</span>
            <textarea
              aria-label={t('task.description')}
              rows={4}
              value={description}
              maxLength={TASK_DESCRIPTION_LIMIT}
              placeholder={t('task.descriptionPlaceholder')}
              onChange={(e) => setDescription(e.target.value)}
            />
          </label>
        )}
        <div className="field-row">
          <label className="field">
            <span>{t('task.agent')}</span>
            <select
              aria-label={t('task.agent')}
              value={chosen}
              onChange={(e) => setProfile(e.target.value as AgentProfileId)}
            >
              {agents.map((agent) => (
                <option key={agent.profile} value={agent.profile}>
                  {agent.displayName || PROFILE_LABEL[agent.profile]}
                </option>
              ))}
            </select>
          </label>
          <label className="field">
            <span>{t('task.group')}</span>
            <select
              aria-label={t('task.group')}
              value={groupId}
              onChange={(e) => setGroupId(e.target.value)}
            >
              <option value="">{t('task.noGroup')}</option>
              {groups.map((group) => (
                <option key={group.id} value={group.id}>
                  {group.name}
                </option>
              ))}
            </select>
          </label>
        </div>
        <div className="field-row">
          <label className="check">
            <input
              type="checkbox"
              checked={isolated}
              onChange={(e) => setIsolated(e.target.checked)}
            />
            <span>{t('task.isolated')}</span>
          </label>
          <label className="field">
            <span>{t('newSession.base')}</span>
            <select
              aria-label={t('newSession.base')}
              value={base}
              disabled={!isolated || !origin?.repo}
              onChange={(e) => setBase(e.target.value)}
            >
              {(origin?.branches ?? []).map((b) => (
                <option key={b} value={b}>
                  {b}
                </option>
              ))}
            </select>
          </label>
        </div>
        {error && (
          <p className="form-error" role="alert">
            {error}
          </p>
        )}
        <div className="dialog-actions">
          <button type="button" onClick={onClose}>
            {t('common.cancel')}
          </button>
          <button type="submit" className="primary" disabled={!ready || busy}>
            {busy
              ? t('task.creating')
              : many
                ? t('task.submitMany', { count: drafts.length })
                : t('task.submit')}
          </button>
        </div>
      </form>
    </Dialog>
  );
}
