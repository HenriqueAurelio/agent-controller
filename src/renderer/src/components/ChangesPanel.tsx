import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { parseCheckpointBase } from '@shared/checkpoints';
import type { Problem } from '@shared/checks';
import { isCheckpointBase, type DiffBase, type FileChange, type GitOverview } from '@shared/git';
import type { SessionView } from '@shared/session';
import type { FrameMarker, ParentMessage } from '../lib/diffProtocol';
import { checkpointLabel, useCheckpoints } from '../lib/checkpoints';
import { errorMessage } from '../lib/format';
import { rich, useT } from '../lib/i18n';
import { groupChanges } from '../lib/changeGroups';
import { useOverlaps } from '../lib/overlaps';
import { useAppState } from '../lib/store';
import { useReview } from '../lib/review';
import { useProblems } from '../lib/useProblems';
import type { ReviewComment } from '@shared/review';
import type { SonarRun } from '@shared/sonar';
import { ChangeList } from './ChangeList';
import { ChangesHeader } from './ChangesHeader';
import { CommitBar } from './CommitBar';
import { DiffView } from './DiffView';
import { FileTree } from './FileTree';
import { MultiDiffView } from './MultiDiffView';
import { ProblemsList } from './ProblemsList';
import { ReviewList } from './ReviewList';
import { SearchList } from './SearchList';
import { definitionQuery, IDENTIFIER, searchText, type SearchMatch } from '@shared/search';
import { Dialog } from './Dialog';

/**
 * What the panel lists: what git says changed, every file of the folder, the problems the
 * checks found, the comments of the review, or every changed block in one scroll.
 */
export type PanelMode = 'changes' | 'files' | 'problems' | 'review' | 'all' | 'search';

/** A file and the line to put the cursor on; a new nonce asks again. */
export interface LocationRequest {
  path: string;
  line?: number;
  column?: number;
  nonce: number;
}

interface Props {
  session: SessionView;
  mode: PanelMode;
  onModeChange(mode: PanelMode): void;
  onClose(): void;
  onCount(count: number | null): void;
  /** The file with unsaved edits, or null: the app asks before anything discards them. */
  onUnsavedChange(file: string | null): void;
  /** The file open in the panel, which a prompt may name; null when none is. */
  onOpenFile(file: string | null): void;
  /** "Send to the agent with a prompt…" on a selection of the editor. */
  onSendSelection(file: string, selection: string): void;
  /** "Send to the agent" on problems of the list: the prompt dialog opens with them. */
  onSendProblems(problems: Problem[]): void;
  /** "Send to the agent" on the review: the prompt dialog opens with its comments. */
  onSendReview(): void;
  /** "Send to the agent" on search results: the prompt dialog opens with them. */
  onSendSearch(text: string): void;
  /** The latest Sonar analysis of the session: its issues join the problems of the checks. */
  sonarRun?: SonarRun;
  /** A base asked for from outside (the timeline); a new nonce applies it again. */
  requestedBase?: { base: DiffBase; nonce: number } | null;
  /** A file to open, asked for from another session that also changed it. */
  requestedFile?: { path: string; nonce: number } | null;
  /** A place to open in the editor, from a link in a terminal: the panel goes to "all files". */
  requestedLocation?: LocationRequest | null;
  /** Opens a file in the panel of another session: the ⚠ of a file that both changed. */
  onOpenInSession(sessionId: string, file: string): void;
}

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
  onOpenFile,
  onSendSelection,
  onSendProblems,
  onSendReview,
  onSendSearch,
  sonarRun,
  requestedBase,
  requestedFile,
  requestedLocation,
  onOpenInSession,
}: Props) {
  const t = useT();
  const prefs = useAppState((s) => s.prefs);
  const overlapFiles = useOverlaps(session.id, session.overlaps);
  const overlapOf = useMemo(
    () => new Map(overlapFiles.map((file) => [file.path, file] as const)),
    [overlapFiles],
  );
  /** The file asked for from another session, until the list that has it arrives. */
  const [wantedFile, setWantedFile] = useState(requestedFile?.path ?? null);
  const [appliedFile, setAppliedFile] = useState(requestedFile?.nonce);
  if (requestedFile && requestedFile.nonce !== appliedFile) {
    setAppliedFile(requestedFile.nonce);
    setWantedFile(requestedFile.path);
  }
  const [overview, setOverview] = useState<GitOverview | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [base, setBase] = useState<DiffBase>(requestedBase?.base ?? 'head');
  const timeline = useCheckpoints(session.id, session.cwd);
  // A comparison asked for by the timeline, each time it is asked (a new nonce), applied while
  // rendering so the panel never loads the old base first.
  const [appliedRequest, setAppliedRequest] = useState(requestedBase?.nonce);
  if (requestedBase && requestedBase.nonce !== appliedRequest) {
    setAppliedRequest(requestedBase.nonce);
    setBase(requestedBase.base);
  }
  const [selected, setSelected] = useState<string | null>(null);
  /** The file open from the tree of all files; the list of changes keeps its own. */
  const [browsed, setBrowsed] = useState<string | null>(requestedLocation?.path ?? null);
  /** The line the editor goes to once the file shows. */
  const [reveal, setReveal] = useState<LocationRequest | null>(requestedLocation ?? null);
  const appliedLocation = useRef(requestedLocation?.nonce);
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
  const commitRef = useRef<HTMLTextAreaElement>(null);
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
  // The file another session asked for. Committed in a copy, it is only in the list against the
  // base of the branch, which is what the warning compares.
  useEffect(() => {
    if (!wantedFile || !overview?.ok) return;
    if (overview.changes.some((c) => c.path === wantedFile)) {
      setSelected(wantedFile);
      setWantedFile(null);
    } else if (overview.base === 'head' && overview.hasBranchBase) {
      setBase('branchBase');
    } else {
      setWantedFile(null);
    }
  }, [wantedFile, overview]);

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
  /** How the select names a comparison the timeline asked for. */
  const checkpointName = useMemo(() => {
    const parsed = overview?.ok ? parseCheckpointBase(overview.base) : null;
    if (!parsed) return null;
    const name = (id: string) => {
      const found = timeline?.items.find((c) => c.id === id);
      return found ? checkpointLabel(t, found) : `#${id}`;
    };
    return parsed.to
      ? t('changes.base.pair', { from: name(parsed.from), to: name(parsed.to) })
      : t('changes.base.checkpoint', { label: name(parsed.from) });
  }, [overview, timeline, t]);
  const repos = useMemo(() => (overview?.ok ? overview.repos : []), [overview]);
  /** Against the last commit, the list is also what can be staged, committed and discarded. */
  const operable = overview?.ok === true && overview.base === 'head';
  const stagedChanges = useMemo(
    () => (operable ? changes.filter((c) => c.staged) : []),
    [operable, changes],
  );
  const groups = useMemo(
    () => groupChanges(changes, stagedChanges, repos),
    [changes, stagedChanges, repos],
  );
  const untouched = repos.length > 1 ? repos.filter((r) => r.count === 0) : [];
  const flat = useMemo(() => groups.flatMap((g) => g.files), [groups]);
  const kinds = useMemo(() => new Map(changes.map((c) => [c.path, c.kind])), [changes]);
  const repoFolders = useMemo(
    () => new Map(repos.length > 1 ? repos.map((r) => [r.path, r] as const) : []),
    [repos],
  );
  const files = mode === 'files';
  const problemsMode = mode === 'problems';
  const reviewMode = mode === 'review';
  const allMode = mode === 'all';
  const searchMode = mode === 'search';
  const [openMatch, setOpenMatch] = useState<SearchMatch | null>(null);
  /** Where a name may be declared, when there is more than one place. */
  const [definitions, setDefinitions] = useState<{ word: string; matches: SearchMatch[] } | null>(
    null,
  );
  const [definitionNote, setDefinitionNote] = useState<string | null>(null);
  /** The tree and the lists of problems and of comments open files in the editor next to them. */
  const browsing = files || problemsMode || reviewMode || searchMode;
  const comments = useReview(session.id);
  const [openComment, setOpenComment] = useState<string | null>(null);
  /** The file in the editor. */
  const current = browsing ? browsed : selected;
  const checksFound = useProblems(session.id);
  const found = useMemo(
    () =>
      sonarRun && sonarRun.problems.length > 0
        ? {
            ...checksFound,
            problems: [...checksFound.problems, ...sonarRun.problems],
            more: checksFound.more + sonarRun.more,
            ran: true,
          }
        : checksFound,
    [checksFound, sonarRun],
  );
  const [openProblem, setOpenProblem] = useState<Problem | null>(null);
  /** The lines of the open file that the checks complained about. */
  const markers = useMemo<FrameMarker[]>(
    () =>
      found.problems
        .filter((p) => p.file === browsed)
        .map(({ line, column, severity, message }) => ({ line, column, severity, message })),
    [found.problems, browsed],
  );

  // The panel covers the terminal, so it takes the keyboard too: Esc closes it even when there
  // is no list to focus (no git, no changes).
  // The tree of all files takes the keyboard by itself.
  useEffect(() => {
    if (!browsing) (listRef.current ?? panelRef.current)?.focus();
  }, [browsing, overview?.ok, changes.length]);

  useEffect(() => {
    onUnsavedChange(dirty ? current : null);
  }, [dirty, current, onUnsavedChange]);
  useEffect(() => () => onUnsavedChange(null), [onUnsavedChange]);
  useEffect(() => {
    onOpenFile(current);
  }, [current, onOpenFile]);
  useEffect(() => () => onOpenFile(null), [onOpenFile]);

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

  /** A problem of the list: its file opens in the editor, on its line. */
  const openProblemInPanel = (problem: Problem) => {
    if (problem.file !== browsed && !mayLeave()) return;
    setOpenProblem(problem);
    setBrowsed(problem.file);
    setReveal({
      path: problem.file,
      line: problem.line,
      column: problem.column,
      nonce: Date.now(),
    });
  };

  /** Opens a place of the project in the editor of all files, on its line. */
  const openPlace = (match: SearchMatch) => {
    if (match.file !== current && !mayLeave()) return;
    if (!files) onModeChange('files');
    setBrowsed(match.file);
    setReveal({ path: match.file, line: match.line, column: match.column, nonce: Date.now() });
  };
  /** F12: where the name is declared; one place opens at once, more are listed. */
  const goToDefinition = (word: string) => {
    if (!IDENTIFIER.test(word)) return;
    setDefinitionNote(null);
    window.api
      .invoke('search:run', sessionId, definitionQuery(word))
      .then(({ matches }) => {
        if (matches.length === 1) openPlace(matches[0]!);
        else if (matches.length > 1) setDefinitions({ word, matches: matches.slice(0, 50) });
        else setDefinitionNote(t('definition.none', { word }));
      })
      .catch((err) => setDefinitionNote(errorMessage(err)));
  };

  /** "Open in the file" of a block: the editor of all files, on the line. */
  const openFromAll = (path: string, line: number) => {
    onModeChange('files');
    setBrowsed(path);
    setReveal({ path, line, nonce: Date.now() });
  };

  /** A comment of the review: its file opens in the editor, on its first line. */
  const openCommentInPanel = (comment: ReviewComment) => {
    if (comment.file !== browsed && !mayLeave()) return;
    setOpenComment(comment.id);
    setBrowsed(comment.file);
    setReveal({ path: comment.file, line: comment.startLine, nonce: Date.now() });
  };

  // A link clicked in a terminal while the panel is already open.
  useEffect(() => {
    if (!requestedLocation || appliedLocation.current === requestedLocation.nonce) return;
    appliedLocation.current = requestedLocation.nonce;
    const same = files && browsed === requestedLocation.path;
    if (!same && dirty && !window.confirm(t('common.unsavedConfirm', { file: current ?? '' }))) {
      return;
    }
    if (!files) onModeChange('files');
    setBrowsed(requestedLocation.path);
    setReveal(requestedLocation);
  }, [requestedLocation, files, browsed, dirty, current, t, onModeChange]);

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

  const editorFrame = () =>
    panelRef.current?.querySelector<HTMLIFrameElement>('iframe.diff-editor') ?? null;
  /** The keyboard goes into the editor of the open file, on the side that can be edited. */
  const focusEditor = () => {
    const frame = editorFrame();
    if (!frame || frame.style.visibility === 'hidden') return;
    frame.focus();
    frame.contentWindow?.postMessage({ type: 'focus' } satisfies ParentMessage, '*');
  };
  /** F6 and Shift+F6: the list (or the tree), the editor, the commit message, in turn. */
  const cycleFocus = (delta: number) => {
    const list = listRef.current ?? panelRef.current?.querySelector<HTMLElement>('[role="tree"]');
    const frame = editorFrame();
    const parts = [
      list,
      frame?.style.visibility === 'hidden' ? null : frame,
      commitRef.current,
    ].filter((part): part is HTMLElement => Boolean(part));
    if (parts.length === 0) return;
    const active = document.activeElement;
    const at = parts.findIndex((part) => part === active || part.contains(active));
    const next = parts[(at + delta + parts.length) % parts.length]!;
    if (next === frame) focusEditor();
    else next.focus();
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
        if (e.key === 'F6') {
          e.preventDefault();
          e.stopPropagation();
          cycleFocus(e.shiftKey ? -1 : 1);
        } else if (e.key === 'Escape') {
          e.stopPropagation();
          close();
        }
      }}
    >
      <ChangesHeader
        mode={mode}
        problems={{ count: found.problems.length, more: found.more > 0 }}
        commentCount={comments.length}
        showHidden={prefs.showHiddenFiles}
        overview={overview}
        worktreeBase={session.worktree?.base}
        timeline={timeline}
        checkpointName={checkpointName}
        inline={inline}
        onToggleInline={() => setInline((v) => !v)}
        onSwitchMode={switchMode}
        onBase={(next) => {
          if (mayLeave()) setBase(next);
        }}
        onClose={close}
      />

      {!browsing && error && (
        <div className="panel-message error">{t('changes.loadError', { error })}</div>
      )}
      {!browsing && !error && !overview && (
        <div className="panel-message">{t('changes.loading')}</div>
      )}
      {!browsing && !error && overview && !overview.ok && <Unavailable overview={overview} />}
      {!browsing && !error && overview?.ok && changes.length === 0 && (
        <div className="panel-message">
          <h3>{t('changes.none.title')}</h3>
          <p>
            {isCheckpointBase(overview.base)
              ? t('changes.none.checkpoint')
              : overview.base === 'session'
                ? t('changes.none.session')
                : overview.base === 'branchBase'
                  ? t('changes.none.branchBase')
                  : repos.length > 1
                    ? t('changes.none.repos', {
                        count: repos.length,
                        names: repos.map((r) => r.name).join(', '),
                      })
                    : t('changes.none.head')}
          </p>
        </div>
      )}

      {browsing && (
        <div className="changes-body">
          {files ? (
            <FileTree
              sessionId={sessionId}
              showHidden={prefs.showHiddenFiles}
              selected={browsed}
              revision={revision}
              changes={kinds}
              repos={repoFolders}
              onSelect={browse}
            />
          ) : searchMode ? (
            <SearchList
              sessionId={sessionId}
              current={openMatch}
              onOpen={(match) => {
                if (match.file !== browsed && !mayLeave()) return;
                setOpenMatch(match);
                setBrowsed(match.file);
                setReveal({
                  path: match.file,
                  line: match.line,
                  column: match.column,
                  nonce: Date.now(),
                });
              }}
              onSend={(text, matches) =>
                onSendSearch(
                  t('search.prompt', { text, results: searchText(matches.slice(0, 300)) }),
                )
              }
            />
          ) : reviewMode ? (
            <ReviewList
              sessionId={sessionId}
              comments={comments}
              current={openComment}
              onOpen={openCommentInPanel}
              onSend={onSendReview}
            />
          ) : (
            <ProblemsList
              sessionId={sessionId}
              state={found}
              stale={session.status.state === 'trabalhando'}
              current={openProblem}
              onOpen={openProblemInPanel}
              onSend={onSendProblems}
              onRunChecks={() => void window.api.invoke('checks:run', sessionId).catch(() => {})}
            />
          )}
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
              onSendSelection={onSendSelection}
              reveal={reveal?.line ? { ...reveal, line: reveal.line } : null}
              markers={markers}
              comments={comments}
              onDefinition={goToDefinition}
            />
          ) : (
            <div className="panel-message">{t('changes.pickFile')}</div>
          )}
        </div>
      )}

      {allMode && !error && overview?.ok && changes.length > 0 && (
        <MultiDiffView
          sessionId={sessionId}
          base={overview.base}
          revision={revision}
          comments={comments}
          agentWorking={agentWorking}
          onOpenFile={openFromAll}
        />
      )}

      {!browsing && !allMode && !error && overview?.ok && changes.length > 0 && (
        <div className="changes-body">
          <ChangeList
            listRef={listRef}
            groups={groups}
            flat={flat}
            changes={changes}
            stagedCount={stagedChanges.length}
            untouched={untouched}
            selected={selected}
            operable={operable}
            operating={operating}
            marking={marking}
            overlapOf={overlapOf}
            onSelect={select}
            onMove={moveSelection}
            onFocusCommit={() => commitRef.current?.focus()}
            onFocusEditor={focusEditor}
            onToggleStaged={toggleStaged}
            onDiscard={discardFile}
            onOpenInSession={onOpenInSession}
          />
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
              onSendSelection={onSendSelection}
              comments={comments}
              onDefinition={goToDefinition}
            />
          )}
        </div>
      )}
      {definitionNote && (
        <div className="changes-toast" role="status" data-testid="definition-note">
          <span>{definitionNote}</span>
          <button
            type="button"
            className="toast-close"
            aria-label={t('common.close')}
            onClick={() => setDefinitionNote(null)}
          >
            ×
          </button>
        </div>
      )}
      {definitions && (
        <Dialog
          title={t('definition.title', { word: definitions.word })}
          onClose={() => setDefinitions(null)}
          className="definition-dialog"
        >
          <ul className="definition-list" data-testid="definition-list">
            {definitions.matches.map((match) => (
              <li key={`${match.file}:${match.line}`}>
                <button
                  onClick={() => {
                    setDefinitions(null);
                    openPlace(match);
                  }}
                >
                  <span className="definition-place">
                    {match.file}:{match.line}
                  </span>
                  <span className="muted search-line">{match.text.trim()}</span>
                </button>
              </li>
            ))}
          </ul>
        </Dialog>
      )}

      {!browsing && (discarded || opError || committed) && (
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

      {!browsing && !allMode && operable && stagedChanges.length > 0 && (
        <CommitBar
          commitRef={commitRef}
          goingIn={goingIn}
          stagedRepos={stagedRepos}
          repoToCommit={repoToCommit}
          repos={repos}
          message={message}
          operating={operating}
          onRepo={setCommitRepo}
          onMessage={setMessage}
          onCommit={commitStaged}
        />
      )}
    </section>
  );
}
