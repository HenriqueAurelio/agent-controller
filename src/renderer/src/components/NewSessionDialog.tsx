import { useEffect, useState, type FormEvent } from 'react';
import { AGENT_COMMAND_LIMIT, type AgentAvailability } from '@shared/agents';
import type { Translate } from '@shared/i18n';
import type { WorktreeOrigin } from '@shared/ipc';
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

/** A branch name out of a session name: `ac/` and the name, in the characters git takes. */
export function branchFor(name: string): string {
  const slug = name
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9._-]+/g, '-')
    .replace(/^[-.]+|[-.]+$/g, '')
    .slice(0, 50);
  return `ac/${slug || 'sessao'}`;
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
  const agentCommands = useAppState((s) => s.prefs.agentCommands);
  const sessions = useAppState((s) => s.sessions);
  // With no folder asked for and none set as the initial one, the latest one used is offered.
  const [suggested] = useState(
    () => initialCwd || defaultFolder || (store.get().recentFolders[0] ?? ''),
  );
  const [name, setName] = useState(baseName(suggested));
  const [nameEdited, setNameEdited] = useState(false);
  const [cwd, setCwd] = useState(suggested);
  const [profile, setProfile] = useState<AgentProfileId | null>(null);
  const [command, setCommand] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  // A copy of the repository (git worktree): only offered when the folder is in one.
  const [origin, setOrigin] = useState<WorktreeOrigin | null>(null);
  const [isolated, setIsolated] = useState(false);
  const [branch, setBranch] = useState('');
  const [branchEdited, setBranchEdited] = useState(false);
  const [baseBranch, setBaseBranch] = useState('');
  const [copies, setCopies] = useState<{ folder: string; setup: string } | null>(null);

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
          setBaseBranch((current) =>
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
  useEffect(() => {
    if (!isolated || copies) return;
    void window.api
      .invoke('worktrees:list')
      .then((info) => setCopies({ folder: info.folder, setup: info.setup }))
      .catch(() => {});
  }, [isolated, copies]);
  const canIsolate = origin?.repo === true && origin.branches.length > 0;
  const worktree = isolated && canIsolate;
  const shownBranch = branchEdited ? branch : branchFor(name || baseName(cwd));

  // The agent may have been installed since the app opened.
  useEffect(() => void store.detectAgents(true), []);

  // A command is found by the shell of the user: with one, the agent need not be on the PATH.
  const selectable = (agent: AgentAvailability) =>
    agent.usable || Boolean(command.trim() || agentCommands[agent.profile]);
  const chosen = profile ?? agents.find(selectable)?.profile ?? null;
  const chosenAgent = agents.find((a) => a.profile === chosen);
  const canCreate = chosenAgent !== undefined && selectable(chosenAgent);
  // What runs when the field is left empty, and the commands other sessions of the agent use.
  const defaultCommand = chosen ? agentCommands[chosen] || (chosenAgent?.executable ?? '') : '';
  const knownCommands = [
    ...new Set(sessions.filter((s) => s.profile === chosen && s.command).map((s) => s.command!)),
  ];

  const applyFolder = (folder: string) => {
    setCwd(folder);
    if (!nameEdited) setName(baseName(folder));
  };

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (!chosen || !canCreate || busy) return;
    setBusy(true);
    setError(null);
    try {
      const session = await window.api.invoke('sessions:create', {
        name: name.trim() || baseName(cwd),
        cwd: cwd.trim(),
        profile: chosen,
        command: command.trim() || undefined,
        ...(worktree && { worktree: { branch: shownBranch.trim(), base: baseBranch } }),
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
                  className={`profile-option ${chosen === agent.profile ? 'chosen' : ''} ${selectable(agent) ? '' : 'disabled'}`}
                >
                  <input
                    type="radio"
                    name="profile"
                    value={agent.profile}
                    disabled={!selectable(agent)}
                    checked={chosen === agent.profile}
                    onChange={() => setProfile(agent.profile)}
                  />
                  <span className="profile-name">
                    {agent.displayName}
                    {agent.version && <span className="profile-version"> {agent.version}</span>}
                  </span>
                  {note && (
                    <span className={`profile-note ${selectable(agent) ? 'warning' : 'blocking'}`}>
                      {note}
                    </span>
                  )}
                </label>
              );
            })}
            {agents.length === 0 && <span className="muted">{t('newSession.detecting')}</span>}
          </div>
        </fieldset>

        <label className="field">
          <span>{t('newSession.command')}</span>
          <input
            aria-label={t('newSession.command')}
            className="command"
            value={command}
            placeholder={defaultCommand}
            maxLength={AGENT_COMMAND_LIMIT}
            spellCheck={false}
            list="known-commands"
            onChange={(e) => setCommand(e.target.value)}
          />
          <datalist id="known-commands">
            {knownCommands.map((known) => (
              <option key={known} value={known} />
            ))}
          </datalist>
          <span className="muted">{t('newSession.commandHint', { command: defaultCommand })}</span>
        </label>

        {canIsolate && (
          <fieldset className="field worktree-option">
            <label className="check">
              <input
                type="checkbox"
                checked={isolated}
                onChange={(e) => setIsolated(e.target.checked)}
              />
              {t('newSession.worktree')}
            </label>
            <span className="muted">{t('newSession.worktreeHint')}</span>
            {isolated && (
              <div className="field-row">
                <label className="field">
                  <span>{t('newSession.branch')}</span>
                  <input
                    aria-label={t('newSession.branch')}
                    className="command"
                    value={shownBranch}
                    spellCheck={false}
                    onChange={(e) => {
                      setBranch(e.target.value);
                      setBranchEdited(true);
                    }}
                  />
                </label>
                <label className="field">
                  <span>{t('newSession.base')}</span>
                  <select
                    aria-label={t('newSession.base')}
                    value={baseBranch}
                    onChange={(e) => setBaseBranch(e.target.value)}
                  >
                    {origin.branches.map((b) => (
                      <option key={b} value={b}>
                        {b}
                      </option>
                    ))}
                  </select>
                </label>
              </div>
            )}
            {isolated && copies && (
              <span className="muted">
                {t('newSession.worktreeWhere', { folder: copies.folder })}
                {copies.setup && ` ${t('newSession.worktreeSetup', { command: copies.setup })}`}
              </span>
            )}
          </fieldset>
        )}

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
            className="primary"
            disabled={!canCreate || !cwd.trim() || busy || (worktree && !shownBranch.trim())}
          >
            {busy && worktree ? t('newSession.creatingCopy') : t('newSession.submit')}
          </button>
        </div>
      </form>
    </Dialog>
  );
}
