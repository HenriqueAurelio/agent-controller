import { useEffect, useState, type FormEvent } from 'react';
import type { WorktreeOrigin } from '@shared/ipc';
import type { AgentProfileId } from '@shared/session';
import type { IssueList } from '@shared/pulls';
import {
  draftFromIssue,
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
  /** The open issues of the repository, once asked for; the picked ones become the cards. */
  const [issues, setIssues] = useState<IssueList | null>(null);
  const [loadingIssues, setLoadingIssues] = useState(false);
  const [picked, setPicked] = useState<ReadonlySet<number>>(new Set());
  const [issueFilter, setIssueFilter] = useState('');

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

  const fromIssues = (issues?.issues ?? []).filter((i) => picked.has(i.number));
  const drafts = fromIssues.length > 0 ? fromIssues.map(draftFromIssue) : draftsFromLines(title);
  const many = drafts.length > 1 || fromIssues.length > 0;
  const loadIssues = async () => {
    setLoadingIssues(true);
    try {
      setIssues(await window.api.invoke('tasks:issues', folder));
    } catch (err) {
      setIssues({ repo: null, issues: [], error: errorMessage(err) });
    } finally {
      setLoadingIssues(false);
    }
  };
  const shownIssues = (issues?.issues ?? []).filter((issue) => {
    const query = issueFilter.trim().toLowerCase();
    return !query || `#${issue.number} ${issue.title}`.toLowerCase().includes(query);
  });
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
        <div className="task-issues">
          <button
            type="button"
            data-testid="task-import-issues"
            disabled={loadingIssues}
            title={t('task.issues.hint')}
            onClick={() => void loadIssues()}
          >
            {loadingIssues ? t('task.issues.loading') : t('task.issues.import')}
          </button>
          {issues && (
            <div className="task-issues-list" data-testid="task-issues">
              {issues.error ? (
                <p className="form-error">{issues.error}</p>
              ) : !issues.repo ? (
                <p className="muted">{t('task.issues.noRemote')}</p>
              ) : issues.issues.length === 0 ? (
                <p className="muted">{t('task.issues.none', { repo: issues.repo })}</p>
              ) : (
                <>
                  <input
                    aria-label={t('task.issues.filter')}
                    placeholder={t('task.issues.filter')}
                    value={issueFilter}
                    onChange={(e) => setIssueFilter(e.target.value)}
                  />
                  <ul>
                    {shownIssues.map((issue) => (
                      <li key={issue.number}>
                        <label className="check">
                          <input
                            type="checkbox"
                            data-testid="task-issue"
                            checked={picked.has(issue.number)}
                            onChange={() =>
                              setPicked((current) => {
                                const next = new Set(current);
                                if (!next.delete(issue.number)) next.add(issue.number);
                                return next;
                              })
                            }
                          />
                          <span className="muted">#{issue.number}</span> {issue.title}
                          {issue.labels.length > 0 && (
                            <span className="muted"> · {issue.labels.join(', ')}</span>
                          )}
                        </label>
                      </li>
                    ))}
                  </ul>
                </>
              )}
            </div>
          )}
        </div>
        {fromIssues.length > 0 && (
          <p className="muted" role="status" data-testid="task-from-issues">
            {t('task.issues.picked', { count: fromIssues.length })}
          </p>
        )}
        {fromIssues.length === 0 && (
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
        )}
        {fromIssues.length > 0 ? null : many ? (
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
