import { useEffect, useState, type FormEvent } from 'react';
import { AGENT_COMMAND_LIMIT } from '@shared/agents';
import {
  ATTEMPTS_MAX,
  EXPERIMENT_NAME_LIMIT,
  EXPERIMENT_PROMPT_LIMIT,
  type ExperimentCreated,
} from '@shared/experiments';
import type { WorktreeOrigin } from '@shared/ipc';
import type { AgentProfileId } from '@shared/session';
import { errorMessage, PROFILE_LABEL } from '../lib/format';
import { useT } from '../lib/i18n';
import { store, useAppState } from '../lib/store';
import { Dialog } from './Dialog';
import { FolderField } from './FolderField';

interface Props {
  onClose(): void;
  onCreated(created: ExperimentCreated): void;
}

interface Row {
  key: number;
  profile: AgentProfileId;
  command: string;
}

let nextKey = 1;

/** One request, N attempts: each one an agent in a copy of the repository of its own. */
export function ExperimentDialog({ onClose, onCreated }: Props) {
  const t = useT();
  const agents = useAppState((s) => s.agents);
  const defaultFolder = useAppState((s) => s.prefs.defaultFolder);
  const [cwd, setCwd] = useState(() => defaultFolder || (store.get().recentFolders[0] ?? ''));
  const [name, setName] = useState('');
  const [prompt, setPrompt] = useState('');
  const [origin, setOrigin] = useState<WorktreeOrigin | null>(null);
  const [base, setBase] = useState('');
  const [rows, setRows] = useState<Row[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => void store.detectAgents(true), []);
  const usable = agents.filter((a) => a.usable);
  // Two of the first agent to start with: the point is to compare.
  const first = usable[0]?.profile ?? agents[0]?.profile ?? 'claude-code';
  const shown: Row[] =
    rows.length > 0
      ? rows
      : [
          { key: -1, profile: first, command: '' },
          { key: -2, profile: first, command: '' },
        ];

  useEffect(() => {
    const folder = cwd.trim();
    let cancelled = false;
    const timer = window.setTimeout(() => {
      if (!folder) return setOrigin(null);
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
    }, 250);
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [cwd]);

  const edit = (key: number, change: Partial<Row>) => {
    const current = rows.length > 0 ? rows : shown;
    setRows(current.map((row) => (row.key === key ? { ...row, ...change } : row)));
  };
  const add = () => {
    if (shown.length >= ATTEMPTS_MAX) return;
    const last = shown[shown.length - 1];
    setRows([...shown, { key: nextKey++, profile: last?.profile ?? first, command: '' }]);
  };
  const remove = (key: number) => setRows(shown.filter((row) => row.key !== key));

  const isRepo = origin?.repo === true && origin.branches.length > 0;
  const ready = isRepo && name.trim() !== '' && prompt.trim() !== '' && base !== '';

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (!ready || busy) return;
    setBusy(true);
    setError(null);
    try {
      const created = await window.api.invoke('experiments:create', {
        name: name.trim(),
        cwd: cwd.trim(),
        prompt,
        base,
        attempts: shown.map((row) => ({
          profile: row.profile,
          ...(row.command.trim() && { command: row.command.trim() }),
        })),
      });
      onCreated(created);
    } catch (err) {
      setError(errorMessage(err));
      setBusy(false);
    }
  };

  return (
    <Dialog title={t('experiment.title')} onClose={onClose} className="experiment-dialog">
      <form onSubmit={submit} className="form">
        <FolderField
          value={cwd}
          placeholder={t('newSession.folderPlaceholder')}
          onChange={setCwd}
        />
        {cwd.trim() && origin && !isRepo && (
          <p className="muted" role="status">
            {t('experiment.notRepo')}
          </p>
        )}

        <div className="field-row">
          <label className="field">
            <span>{t('experiment.name')}</span>
            <input
              aria-label={t('experiment.name')}
              value={name}
              maxLength={EXPERIMENT_NAME_LIMIT}
              placeholder={t('experiment.namePlaceholder')}
              onChange={(e) => setName(e.target.value)}
            />
          </label>
          <label className="field">
            <span>{t('newSession.base')}</span>
            <select
              aria-label={t('newSession.base')}
              value={base}
              disabled={!isRepo}
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

        <label className="field">
          <span>{t('experiment.prompt')}</span>
          <textarea
            aria-label={t('experiment.prompt')}
            rows={4}
            value={prompt}
            maxLength={EXPERIMENT_PROMPT_LIMIT}
            placeholder={t('experiment.promptPlaceholder')}
            onChange={(e) => setPrompt(e.target.value)}
          />
        </label>

        <fieldset className="field">
          <legend>{t('experiment.attempts')}</legend>
          <div className="experiment-attempts">
            {shown.map((row, index) => (
              <div key={row.key} className="experiment-attempt">
                <select
                  aria-label={t('experiment.attemptAgent', { n: index + 1 })}
                  value={row.profile}
                  onChange={(e) => edit(row.key, { profile: e.target.value as AgentProfileId })}
                >
                  {agents.map((agent) => (
                    <option key={agent.profile} value={agent.profile}>
                      {agent.displayName || PROFILE_LABEL[agent.profile]}
                    </option>
                  ))}
                </select>
                <input
                  aria-label={t('experiment.attemptCommand', { n: index + 1 })}
                  className="command"
                  value={row.command}
                  maxLength={AGENT_COMMAND_LIMIT}
                  spellCheck={false}
                  placeholder={t('experiment.commandPlaceholder')}
                  onChange={(e) => edit(row.key, { command: e.target.value })}
                />
                <button
                  type="button"
                  className="icon-button"
                  title={t('experiment.removeAttempt', { n: index + 1 })}
                  aria-label={t('experiment.removeAttempt', { n: index + 1 })}
                  disabled={shown.length <= 1}
                  onClick={() => remove(row.key)}
                >
                  ×
                </button>
              </div>
            ))}
          </div>
          <div>
            <button type="button" onClick={add} disabled={shown.length >= ATTEMPTS_MAX}>
              {t('experiment.addAttempt')}
            </button>
          </div>
        </fieldset>
        <p className="muted" data-testid="experiment-usage">
          {t('experiment.usage', { count: shown.length })}
        </p>

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
            {busy ? t('experiment.creating') : t('experiment.submit')}
          </button>
        </div>
      </form>
    </Dialog>
  );
}
