import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  CHANGE_LETTER,
  type DiffBase,
  type FileChange,
  type GitOverview,
  type RepoInfo,
} from '@shared/git';
import type { SessionView } from '@shared/session';
import { errorMessage } from '../lib/format';
import { rich, useT } from '../lib/i18n';
import { useAppState } from '../lib/store';
import { DiffView } from './DiffView';
import { FileTree } from './FileTree';

/** What the panel lists: what git says changed, or every file of the folder. */
export type PanelMode = 'changes' | 'files';

interface Props {
  session: SessionView;
  mode: PanelMode;
  onModeChange(mode: PanelMode): void;
  onClose(): void;
  onCount(count: number | null): void;
  /** The file with unsaved edits, or null: the app asks before anything discards them. */
  onUnsavedChange(file: string | null): void;
}

interface Group {
  key: string;
  /** Set on the first group of a section of the list (staged, not staged), when there are two. */
  section?: 'staged' | 'unstaged';
  /** Set on the first group of a repository, when the session has more than one. */
  repo?: RepoInfo;
  /** Folder of the files, relative to their repository. */
  folder: string;
  files: FileChange[];
}

function groupByFolder(changes: FileChange[], repos: RepoInfo[]): Group[] {
  // With a single repository the list is by folder only, as it always was.
  const sections = repos.length > 1 ? repos.filter((r) => r.count > 0) : [undefined];
  return sections.flatMap((repo) => {
    const skip = repo?.path ? repo.path.length + 1 : 0;
    const folders = new Map<string, FileChange[]>();
    for (const change of changes) {
      if (repo && (change.repo ?? '') !== repo.path) continue;
      const slash = change.path.lastIndexOf('/');
      const folder = slash < skip ? '' : change.path.slice(skip, slash);
      const list = folders.get(folder);
      if (list) list.push(change);
      else folders.set(folder, [change]);
    }
    return [...folders.entries()]
      .sort(([x], [y]) => x.localeCompare(y))
      .map(([folder, files], index) => ({
        key: `${repo?.path ?? ''}:${folder}`,
        repo: index === 0 ? repo : undefined,
        folder,
        files,
      }));
  });
}

const fileName = (path: string) => path.slice(path.lastIndexOf('/') + 1);

function Unavailable({ overview }: { overview: Extract<GitOverview, { ok: false }> }) {
  const t = useT();
  if (overview.reason === 'git-missing') {
    return (
      <div className="panel-message">
        <h3>{t('git.missing.title')}</h3>
        <p>{rich(t('git.missing.body'), { url: <code>https://git-scm.com</code> })}</p>
      </div>
    );
  }
  if (overview.reason === 'git-too-old') {
    return (
      <div className="panel-message">
        <h3>{t('git.tooOld.title')}</h3>
        <p>
          {t('git.tooOld.body', { found: overview.gitVersion ?? '', min: overview.minVersion })}
        </p>
      </div>
    );
  }
  return (
    <div className="panel-message">
      <h3>{t('git.notRepo.title')}</h3>
      <p>{rich(t('git.notRepo.body'), { command: <code>git init</code> })}</p>
    </div>
  );
}

/** "See changes": what the agent changed, with the working-tree side open for editing. */
export function ChangesPanel({
  session,
  mode,
  onModeChange,
  onClose,
  onCount,
  onUnsavedChange,
}: Props) {
  const t = useT();
  const prefs = useAppState((s) => s.prefs);
  const [overview, setOverview] = useState<GitOverview | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [base, setBase] = useState<DiffBase>('head');
  const [selected, setSelected] = useState<string | null>(null);
  /** The file open from the tree of all files; the list of changes keeps its own. */
  const [browsed, setBrowsed] = useState<string | null>(null);
  const [inline, setInline] = useState(false);
  const [revision, setRevision] = useState(0);
  const [dirty, setDirty] = useState(false);
  const [message, setMessage] = useState('');
  const [commitRepo, setCommitRepo] = useState('');
  const [operating, setOperating] = useState(false);
  const [opError, setOpError] = useState<string | null>(null);
  /** The latest file discarded, while it can still be given back. */
  const [discarded, setDiscarded] = useState<{ id: string; file: string } | null>(null);
  const [committed, setCommitted] = useState<string | null>(null);
  /** Boxes clicked whose change git has not confirmed yet: they show the click at once. */
  const [marking, setMarking] = useState<Record<string, boolean>>({});
  const listRef = useRef<HTMLUListElement>(null);
  const panelRef = useRef<HTMLElement>(null);
  const sessionId = session.id;

  const apply = useCallback(
    (result: GitOverview) => {
      setOverview(result);
      setMarking({});
      setError(null);
      onCount(result.ok && result.base === 'head' ? result.changes.length : null);
      setRevision((r) => r + 1);
      if (!result.ok) return;
      // Keep the open file when it is still in the list; otherwise open the first one.
      setSelected((current) =>
        current && result.changes.some((c) => c.path === current)
          ? current
          : (result.changes[0]?.path ?? null),
      );
    },
    [onCount],
  );

  useEffect(() => {
    let cancelled = false;
    const load = (channel: 'git:open' | 'git:refresh') =>
      window.api
        .invoke(channel, sessionId, base)
        .then((result) => !cancelled && apply(result))
        .catch((err) => !cancelled && setError(errorMessage(err)));
    void load('git:open');
    const off = window.api.on('git:changed', (id) => {
      if (id === sessionId) void load('git:refresh');
    });
    return () => {
      cancelled = true;
      off();
    };
  }, [sessionId, base, apply]);

  // The watcher only runs while the panel is open.
  useEffect(() => () => void window.api.invoke('git:close', sessionId), [sessionId]);

  const changes = useMemo(() => (overview?.ok ? overview.changes : []), [overview]);
  const repos = useMemo(() => (overview?.ok ? overview.repos : []), [overview]);
  /** Against the last commit, the list is also what can be staged, committed and discarded. */
  const operable = overview?.ok === true && overview.base === 'head';
  const stagedChanges = useMemo(
    () => (operable ? changes.filter((c) => c.staged) : []),
    [operable, changes],
  );
  // What is staged first, the rest after: what goes into the commit is the reviewed part.
  const groups = useMemo(() => {
    if (stagedChanges.length === 0) return groupByFolder(changes, repos);
    const mark = (list: Group[], section: Group['section']) =>
      list.map((group, index) => ({
        ...group,
        key: `${section}:${group.key}`,
        ...(index === 0 && { section }),
      }));
    return [
      ...mark(groupByFolder(stagedChanges, repos), 'staged'),
      ...mark(
        groupByFolder(
          changes.filter((c) => !c.staged),
          repos,
        ),
        'unstaged',
      ),
    ];
  }, [changes, stagedChanges, repos]);
  const untouched = repos.length > 1 ? repos.filter((r) => r.count === 0) : [];
  const flat = useMemo(() => groups.flatMap((g) => g.files), [groups]);
  const kinds = useMemo(() => new Map(changes.map((c) => [c.path, c.kind])), [changes]);
  const repoFolders = useMemo(
    () => new Map(repos.length > 1 ? repos.map((r) => [r.path, r] as const) : []),
    [repos],
  );
  const files = mode === 'files';
  /** The file in the editor. */
  const current = files ? browsed : selected;

  // The panel covers the terminal, so it takes the keyboard too: Esc closes it even when there
  // is no list to focus (no git, no changes).
  // The tree of all files takes the keyboard by itself.
  useEffect(() => {
    if (!files) (listRef.current ?? panelRef.current)?.focus();
  }, [files, overview?.ok, changes.length]);

  useEffect(() => {
    onUnsavedChange(dirty ? current : null);
  }, [dirty, current, onUnsavedChange]);
  useEffect(() => () => onUnsavedChange(null), [onUnsavedChange]);

  /** Leaving the open file (another file, another base, closing) would lose unsaved edits. */
  const mayLeave = () =>
    !dirty || window.confirm(t('common.unsavedConfirm', { file: current ?? '' }));
  const select = (path: string) => {
    if (path !== selected && mayLeave()) setSelected(path);
  };
  const browse = (path: string) => {
    if (path !== browsed && mayLeave()) setBrowsed(path);
  };
  const switchMode = (next: PanelMode) => {
    if (mayLeave()) onModeChange(next);
  };
  const close = () => {
    if (mayLeave()) onClose();
  };

  /** With the agent working, whatever touches the repository asks once more. */
  const agentWorking = session.status.state === 'trabalhando';
  const run = async (operation: () => Promise<void>) => {
    setOperating(true);
    setOpError(null);
    try {
      await operation();
    } catch (err) {
      setOpError(errorMessage(err));
    } finally {
      setOperating(false);
    }
  };
  const toggleStaged = (change: FileChange) => {
    const toStage = change.staged !== 'all';
    setMarking((current) => ({ ...current, [change.path]: toStage }));
    void run(async () => {
      setCommitted(null);
      try {
        await window.api.invoke(toStage ? 'git:stage' : 'git:unstage', sessionId, [change.path]);
      } catch (err) {
        setMarking(({ [change.path]: _, ...rest }) => rest);
        throw err;
      }
    });
  };
  const discardFile = (change: FileChange) => {
    const question = [
      t('changes.discardConfirm', { file: change.path }),
      ...(agentWorking ? [t('changes.agentWorking')] : []),
    ].join('\n\n');
    if ((change.path === current && !mayLeave()) || !window.confirm(question)) return;
    void run(async () => {
      const { id } = await window.api.invoke('git:discard', sessionId, change.path);
      setDiscarded({ id, file: change.path });
      setCommitted(null);
    });
  };
  const undoDiscard = () =>
    void run(async () => {
      if (!discarded) return;
      await window.api.invoke('git:undoDiscard', sessionId, discarded.id);
      setDiscarded(null);
    });
  // The repository of the commit: the one at the root, or the one picked among those with
  // something staged.
  const stagedRepos = [...new Set(stagedChanges.map((c) => c.repo ?? ''))];
  const repoToCommit = stagedRepos.includes(commitRepo) ? commitRepo : (stagedRepos[0] ?? '');
  const goingIn = stagedChanges.filter((c) => (c.repo ?? '') === repoToCommit);
  const commitStaged = () => {
    if (agentWorking && !window.confirm(t('changes.agentWorking'))) return;
    void run(async () => {
      const { commit } = await window.api.invoke('git:commit', sessionId, repoToCommit, message);
      setMessage('');
      setDiscarded(null);
      setCommitted(commit.slice(0, 7));
    });
  };

  const moveSelection = (delta: number) => {
    if (flat.length === 0) return;
    const index = flat.findIndex((c) => c.path === selected);
    const next = flat[Math.max(0, Math.min(flat.length - 1, index + delta))]!;
    if (next.path === selected || !mayLeave()) return;
    setSelected(next.path);
    document.getElementById(`change-${flat.indexOf(next)}`)?.scrollIntoView({ block: 'nearest' });
  };

  return (
    <section
      ref={panelRef}
      tabIndex={-1}
      className="changes-panel"
      data-files={prefs.layout.files}
      aria-label={t('changes.title')}
      onKeyDown={(e) => {
        if (e.key === 'Escape') {
          e.stopPropagation();
          close();
        }
      }}
    >
      <header className="changes-header">
        <h2>
          {t('changes.title')} <span className="count">{overview?.ok ? changes.length : ''}</span>
        </h2>
        <button
          className={files ? 'active' : ''}
          aria-pressed={files}
          onClick={() => switchMode(files ? 'changes' : 'files')}
          title={t('changes.allFilesHint')}
        >
          {t('changes.allFiles')}
        </button>
        {files && (
          <label className="check">
            <input
              type="checkbox"
              checked={prefs.showHiddenFiles}
              onChange={(e) =>
                void window.api.invoke('prefs:set', { showHiddenFiles: e.target.checked })
              }
            />
            {t('changes.hidden')}
          </label>
        )}
        <span className="readonly-tag" title={t('changes.editableHint')}>
          {t('changes.editable')}
        </span>
        <span className="spacer" />
        {overview?.ok && (
          <>
            <label className="field-inline">
              <span>{t('changes.compareWith')}</span>
              <select
                aria-label={t('changes.compareWith')}
                value={overview.base}
                onChange={(e) => {
                  if (mayLeave()) setBase(e.target.value === 'session' ? 'session' : 'head');
                }}
              >
                <option value="head">{t('changes.base.head')}</option>
                <option value="session" disabled={!overview.hasSessionBase}>
                  {t('changes.base.session')}
                </option>
              </select>
            </label>
            <button
              className={inline ? 'active' : ''}
              aria-pressed={inline}
              onClick={() => setInline((v) => !v)}
              title={t('changes.viewHint')}
            >
              {inline ? t('changes.inline') : t('changes.sideBySide')}
            </button>
          </>
        )}
        <button onClick={close} title={t('changes.closeHint')} aria-label={t('changes.close')}>
          ×
        </button>
      </header>

      {!files && error && (
        <div className="panel-message error">{t('changes.loadError', { error })}</div>
      )}
      {!files && !error && !overview && <div className="panel-message">{t('changes.loading')}</div>}
      {!files && !error && overview && !overview.ok && <Unavailable overview={overview} />}
      {!files && !error && overview?.ok && changes.length === 0 && (
        <div className="panel-message">
          <h3>{t('changes.none.title')}</h3>
          <p>
            {overview.base === 'session'
              ? t('changes.none.session')
              : repos.length > 1
                ? t('changes.none.repos', {
                    count: repos.length,
                    names: repos.map((r) => r.name).join(', '),
                  })
                : t('changes.none.head')}
          </p>
        </div>
      )}

      {files && (
        <div className="changes-body">
          <FileTree
            sessionId={sessionId}
            showHidden={prefs.showHiddenFiles}
            selected={browsed}
            revision={revision}
            changes={kinds}
            repos={repoFolders}
            onSelect={browse}
          />
          {browsed ? (
            <DiffView
              sessionId={sessionId}
              path={browsed}
              base={overview?.ok ? overview.base : 'head'}
              inline={inline}
              revision={revision}
              theme={prefs.theme}
              fontSize={prefs.fontSize}
              plain={overview !== null && !overview.ok}
              onDirtyChange={setDirty}
            />
          ) : (
            <div className="panel-message">{t('changes.pickFile')}</div>
          )}
        </div>
      )}

      {!files && !error && overview?.ok && changes.length > 0 && (
        <div className="changes-body">
          <ul
            ref={listRef}
            className="changes-list"
            role="listbox"
            tabIndex={0}
            aria-label={t('changes.modifiedFiles')}
            aria-activedescendant={
              selected ? `change-${flat.findIndex((c) => c.path === selected)}` : undefined
            }
            onKeyDown={(e) => {
              if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
                e.preventDefault();
                moveSelection(e.key === 'ArrowDown' ? 1 : -1);
              } else if (e.key === 'Home' || e.key === 'End') {
                e.preventDefault();
                moveSelection(e.key === 'Home' ? -flat.length : flat.length);
              }
            }}
          >
            {groups.map((group) => (
              <li key={group.key} role="presentation">
                {group.section && (
                  <div className={`changes-section section-${group.section}`}>
                    {group.section === 'staged'
                      ? t('changes.section.staged', { count: stagedChanges.length })
                      : t('changes.section.unstaged', {
                          count: changes.length - stagedChanges.length,
                        })}
                  </div>
                )}
                {group.repo && (
                  <div
                    className="changes-repo"
                    data-repo={group.repo.path}
                    title={t('changes.repo', { name: group.repo.name })}
                  >
                    <span className="changes-repo-name">{group.repo.name}</span>
                    {group.repo.branch && <span className="muted">{group.repo.branch}</span>}
                    <span className="spacer" />
                    <span className="count">{group.repo.count}</span>
                  </div>
                )}
                <div className="changes-folder">{group.folder || t('changes.root')}</div>
                <ul role="presentation">
                  {group.files.map((change) => (
                    <li
                      key={change.path}
                      id={`change-${flat.indexOf(change)}`}
                      role="option"
                      aria-selected={change.path === selected}
                      data-path={change.path}
                      data-kind={change.kind}
                      className={`change-item ${change.path === selected ? 'selected' : ''}`}
                      title={
                        change.origPath
                          ? `${t(`change.${change.kind}`)}: ${change.origPath} → ${change.path}`
                          : `${t(`change.${change.kind}`)}: ${change.path}`
                      }
                      data-staged={change.staged ?? 'none'}
                      onClick={() => select(change.path)}
                    >
                      {operable && (
                        <input
                          type="checkbox"
                          className="stage-box"
                          aria-label={t('changes.stageOf', { file: change.path })}
                          title={t(
                            change.staged === 'partial'
                              ? 'changes.stagePartial'
                              : 'changes.stageHint',
                          )}
                          checked={marking[change.path] ?? change.staged === 'all'}
                          ref={(box) => {
                            if (box) {
                              box.indeterminate =
                                marking[change.path] === undefined && change.staged === 'partial';
                            }
                          }}
                          disabled={operating}
                          onClick={(e) => e.stopPropagation()}
                          onChange={() => toggleStaged(change)}
                        />
                      )}
                      <span className="change-name">{fileName(change.path)}</span>
                      {operable && change.kind !== 'conflict' && (
                        <button
                          type="button"
                          className="discard-button"
                          aria-label={t('changes.discardOf', { file: change.path })}
                          title={t('changes.discardHint')}
                          disabled={operating}
                          onClick={(e) => {
                            e.stopPropagation();
                            discardFile(change);
                          }}
                        >
                          ↺
                        </button>
                      )}
                      <span className={`change-kind kind-${change.kind}`}>
                        {CHANGE_LETTER[change.kind]}
                      </span>
                    </li>
                  ))}
                </ul>
              </li>
            ))}
            {untouched.length > 0 && (
              <li role="presentation" className="changes-untouched">
                {t('changes.untouched', { names: untouched.map((r) => r.name).join(', ') })}
              </li>
            )}
          </ul>
          {selected && (
            <DiffView
              sessionId={sessionId}
              path={selected}
              base={overview.base}
              inline={inline}
              revision={revision}
              theme={prefs.theme}
              fontSize={prefs.fontSize}
              onDirtyChange={setDirty}
            />
          )}
        </div>
      )}

      {!files && (discarded || opError || committed) && (
        <div
          className={`changes-toast ${opError ? 'error' : ''}`}
          role={opError ? 'alert' : 'status'}
        >
          {opError ? (
            <pre className="changes-error">{opError}</pre>
          ) : discarded ? (
            <>
              <span>{t('changes.discarded', { file: discarded.file })}</span>
              <button type="button" disabled={operating} onClick={undoDiscard}>
                {t('changes.undo')}
              </button>
            </>
          ) : (
            <span>{t('changes.committed', { commit: committed ?? '' })}</span>
          )}
          <button
            type="button"
            className="toast-close"
            aria-label={t('common.close')}
            onClick={() => {
              setOpError(null);
              setDiscarded(null);
              setCommitted(null);
            }}
          >
            ×
          </button>
        </div>
      )}

      {!files && operable && stagedChanges.length > 0 && (
        <footer className="commit-bar" role="group" aria-label={t('changes.commitArea')}>
          <div className="commit-going-in" data-testid="commit-going-in">
            {t('changes.goingIn', {
              count: goingIn.length,
              files: goingIn.map((c) => fileName(c.path)).join(', '),
            })}
          </div>
          <div className="commit-row">
            {stagedRepos.length > 1 && (
              <select
                aria-label={t('changes.commitRepo')}
                value={repoToCommit}
                onChange={(e) => setCommitRepo(e.target.value)}
              >
                {stagedRepos.map((repo) => (
                  <option key={repo} value={repo}>
                    {repos.find((r) => r.path === repo)?.name ?? repo}
                  </option>
                ))}
              </select>
            )}
            <textarea
              aria-label={t('changes.commitMessage')}
              placeholder={t('changes.commitMessage')}
              value={message}
              rows={2}
              spellCheck={false}
              onChange={(e) => setMessage(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && e.ctrlKey && message.trim()) {
                  e.preventDefault();
                  commitStaged();
                }
              }}
            />
            <button
              type="button"
              className="primary"
              disabled={operating || !message.trim()}
              title={t('changes.commitHint')}
              onClick={commitStaged}
            >
              {t('changes.commit')}
            </button>
          </div>
        </footer>
      )}
    </section>
  );
}
