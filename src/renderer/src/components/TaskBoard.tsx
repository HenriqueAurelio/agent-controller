import { useCallback, useEffect, useMemo, useRef, useState, type KeyboardEvent } from 'react';
import type { SessionView } from '@shared/session';
import {
  columnOf,
  TASK_COLUMNS,
  TASK_START_MAX,
  type Task,
  type TaskBoardState,
  type TaskColumn,
} from '@shared/tasks';
import { errorMessage, hint, PROFILE_LABEL } from '../lib/format';
import { useT } from '../lib/i18n';
import { store, useAppState } from '../lib/store';
import { SessionSummary, useGitInfo, useNow, useTails } from './Overview';
import { TaskDialog } from './TaskDialog';

interface Props {
  /** Opens a session: the board gives way to its terminal. */
  onOpen(sessionId: string): void;
  onClose(): void;
  /** Asks what to do with the session (and its copy) of a card that is done. */
  onCloseSession(session: SessionView): void;
  /** Bumped to open the dialog of a new card (the palette). */
  newCardRequest: number;
}

// The repository the board was left on, for the next time it opens while the app runs.
const remembered = { folder: '' };

const factsOf = (s: SessionView | undefined) =>
  s && { state: s.status.state, running: s.running, checks: s.checks, queue: s.queue };

/** Only these two columns take a card by hand; the others follow the session. */
const DROPPABLE: readonly TaskColumn[] = ['todo', 'done'];

/**
 * The cards of one repository in five columns. The column of a card is read from its session as
 * it is now (`columnOf`); the only moves by hand are "to do" to "done", and the order inside a
 * column (ADR 0025).
 */
export function TaskBoard({ onOpen, onClose, onCloseSession, newCardRequest }: Props) {
  const t = useT();
  const sessions = useAppState((s) => s.sessions);
  const selectedId = useAppState((s) => s.selectedId);
  const defaultFolder = useAppState((s) => s.prefs.defaultFolder);
  const recent = useAppState((s) => s.recentFolders);
  const shortcuts = useAppState((s) => s.prefs.shortcuts);
  const [folder, setFolder] = useState(() => {
    if (remembered.folder) return remembered.folder;
    const current = store.get().sessions.find((s) => s.id === store.get().selectedId);
    return current?.worktree?.repoRoot ?? current?.cwd ?? defaultFolder ?? recent[0] ?? '';
  });
  const [state, setState] = useState<TaskBoardState | null>(null);
  const [problem, setProblem] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [selected, setSelected] = useState<string[]>([]);
  const [dialog, setDialog] = useState(false);
  const [dragging, setDragging] = useState<string | null>(null);
  const [starting, setStarting] = useState(false);
  const root = useRef<HTMLElement>(null);
  const asked = useRef(0);
  const now = useNow(10_000);
  const tails = useTails();

  const byId = useMemo(() => new Map(sessions.map((s) => [s.id, s])), [sessions]);
  const tasks = useMemo(() => state?.tasks ?? [], [state]);
  const cardSessions = useMemo(
    () => tasks.flatMap((task) => (task.sessionId && byId.get(task.sessionId)) || []),
    [tasks, byId],
  );
  const git = useGitInfo(cardSessions);

  const load = useCallback(() => {
    if (!folder.trim()) {
      setState(null);
      return;
    }
    const mine = ++asked.current;
    void window.api
      .invoke('tasks:list', folder)
      .then((board) => {
        if (mine !== asked.current) return;
        remembered.folder = board.repo;
        setState(board);
        setProblem(null);
      })
      .catch((err) => {
        if (mine !== asked.current) return;
        setState(null);
        setProblem(errorMessage(err));
      });
  }, [folder]);
  useEffect(load, [load]);
  useEffect(
    () =>
      window.api.on('tasks:changed', (repo) => {
        if (repo === state?.repo) load();
      }),
    [state?.repo, load],
  );
  useEffect(() => {
    if (newCardRequest > 0) setDialog(true);
  }, [newCardRequest]);
  useEffect(() => root.current?.focus(), []);

  const columnFor = (task: Task): TaskColumn =>
    columnOf(task, factsOf(task.sessionId ? byId.get(task.sessionId) : undefined));

  const columns = useMemo(() => {
    const result = Object.fromEntries(TASK_COLUMNS.map((c) => [c, [] as Task[]])) as Record<
      TaskColumn,
      Task[]
    >;
    for (const task of tasks) {
      result[columnOf(task, factsOf(task.sessionId ? byId.get(task.sessionId) : undefined))].push(
        task,
      );
    }
    return result;
  }, [tasks, byId]);

  const run = async (action: () => Promise<TaskBoardState | void>) => {
    setNotice(null);
    try {
      const board = await action();
      if (board) setState(board);
    } catch (err) {
      setNotice(errorMessage(err));
    }
  };

  const start = async (ids: string[]) => {
    if (starting || ids.length === 0) return;
    setStarting(true);
    setNotice(null);
    try {
      const result = await window.api.invoke('tasks:start', ids);
      setSelected([]);
      if (result.failed.length > 0) {
        setNotice(
          result.failed
            .map(({ taskId, reason }) =>
              t('board.startFailed', {
                title: tasks.find((x) => x.id === taskId)?.title ?? '',
                reason,
              }),
            )
            .join('\n'),
        );
      }
      load();
    } catch (err) {
      setNotice(errorMessage(err));
    } finally {
      setStarting(false);
    }
  };

  const markDone = (task: Task) =>
    run(async () => {
      const board = await window.api.invoke('tasks:done', task.id, true);
      const session = task.sessionId ? byId.get(task.sessionId) : undefined;
      if (session) onCloseSession(session);
      return board;
    });

  const drop = (target: TaskColumn, beforeId: string | null) => {
    const id = dragging;
    setDragging(null);
    const dragged = tasks.find((task) => task.id === id);
    if (!dragged || !state) return;
    const from = columnFor(dragged);
    if (!DROPPABLE.includes(from) || !DROPPABLE.includes(target)) return;
    void run(async () => {
      if (from !== target) await window.api.invoke('tasks:done', dragged.id, target === 'done');
      const order = tasks.map((task) => task.id).filter((other) => other !== dragged.id);
      const at = beforeId ? order.indexOf(beforeId) : -1;
      if (at < 0) order.push(dragged.id);
      else order.splice(at, 0, dragged.id);
      return window.api.invoke('tasks:reorder', state.repo, order);
    });
  };

  const pickFolder = async () => {
    const picked = await window.api.invoke('dialog:pickFolder', folder || undefined);
    if (picked) {
      setSelected([]);
      setFolder(picked);
    }
  };

  const onKey = (event: KeyboardEvent) => {
    if (event.key !== 'Escape' || dialog) return;
    event.preventDefault();
    event.stopPropagation();
    onClose();
  };

  const renderCard = (task: Task, column: TaskColumn) => {
    const session = task.sessionId ? byId.get(task.sessionId) : undefined;
    const movable = DROPPABLE.includes(column) && !session;
    const label = t(`board.column.${column}`);
    const picked = selected.includes(task.id);
    return (
      <article
        key={task.id}
        role="listitem"
        className={`board-card ${session && session.id === selectedId ? 'current' : ''} ${
          dragging === task.id ? 'dragging' : ''
        }`}
        data-testid="board-card"
        data-task-id={task.id}
        data-column={column}
        data-state={session?.status.state}
        aria-label={t('board.card', { title: task.title, column: label })}
        draggable={movable}
        onDragStart={(e) => {
          if (!movable) return e.preventDefault();
          e.dataTransfer.effectAllowed = 'move';
          e.dataTransfer.setData('text/plain', task.id);
          setDragging(task.id);
        }}
        onDragEnd={() => setDragging(null)}
        onDragOver={(e) => {
          if (dragging && DROPPABLE.includes(column)) e.preventDefault();
        }}
        onDrop={(e) => {
          if (!dragging || !DROPPABLE.includes(column)) return;
          e.preventDefault();
          e.stopPropagation();
          drop(column, task.id);
        }}
      >
        {session ? (
          <div
            className="board-card-summary"
            onClick={() => onOpen(session.id)}
            title={t('board.open.session')}
          >
            <SessionSummary
              session={session}
              lines={(tails[session.id] ?? []).slice(-3)}
              info={git[session.id]}
              now={now}
            />
          </div>
        ) : (
          <div className="board-card-plain">
            <div className="board-card-title">
              {column === 'todo' && (
                <input
                  type="checkbox"
                  aria-label={t('board.select', { title: task.title })}
                  checked={picked}
                  onChange={(e) =>
                    setSelected((current) =>
                      e.target.checked
                        ? [...current, task.id]
                        : current.filter((x) => x !== task.id),
                    )
                  }
                />
              )}
              <strong className="board-card-name">{task.title}</strong>
              <span className={`profile-tag profile-${task.profile}`}>
                {PROFILE_LABEL[task.profile]}
              </span>
            </div>
            {task.description.trim() && (
              <p className="board-card-description">{task.description.trim()}</p>
            )}
            {task.sessionClosed && (
              <p
                className="board-card-closed"
                data-testid="board-session-closed"
                title={
                  task.branch
                    ? t('board.sessionClosedHint', { branch: task.branch })
                    : t('board.sessionClosedNoBranch')
                }
              >
                {t('board.sessionClosed')}
                {task.branch && (
                  <>
                    {' · '}
                    <span aria-hidden="true">⑂</span> {task.branch}
                  </>
                )}
              </p>
            )}
            {!task.sessionClosed && column === 'done' && task.branch && (
              <p className="board-card-closed" title={t('board.merged')}>
                <span aria-hidden="true">⑂</span> {task.branch}
              </p>
            )}
          </div>
        )}
        <div className="board-card-actions">
          {column === 'todo' && (
            <button
              className="primary"
              data-testid="board-start"
              disabled={starting}
              title={t('board.startHint', {
                isolated: task.isolated ? t('board.isolatedHint') : '',
              })}
              onClick={() => void start([task.id])}
            >
              {t('board.start')}
            </button>
          )}
          {session && (
            <button data-testid="board-open" onClick={() => onOpen(session.id)}>
              {t('board.open.session')}
            </button>
          )}
          {column !== 'done' && (
            <button
              data-testid="board-done"
              title={t('board.markDoneHint')}
              onClick={() => void markDone(task)}
            >
              {t('board.markDone')}
            </button>
          )}
          {column === 'done' && (
            <button
              data-testid="board-reopen"
              onClick={() => void run(() => window.api.invoke('tasks:done', task.id, false))}
            >
              {t('board.reopen')}
            </button>
          )}
          {!session && (
            <button
              className="icon-button"
              data-testid="board-remove"
              title={t('board.removeHint')}
              aria-label={t('board.remove')}
              onClick={() => void run(() => window.api.invoke('tasks:remove', task.id))}
            >
              ×
            </button>
          )}
        </div>
      </article>
    );
  };

  const overLimit = selected.length > TASK_START_MAX;

  return (
    <section
      ref={root}
      className="board"
      aria-label={t('board.title')}
      tabIndex={-1}
      data-testid="task-board"
      onKeyDown={onKey}
    >
      <header className="board-header">
        <h2>{t('board.title')}</h2>
        <select
          aria-label={t('board.repo')}
          data-testid="board-repo"
          value={state?.repo ?? ''}
          onChange={(e) => {
            setSelected([]);
            setFolder(e.target.value);
          }}
        >
          {!state && <option value="">—</option>}
          {(state?.repos ?? []).map((repo) => (
            <option key={repo} value={repo}>
              {repo}
            </option>
          ))}
        </select>
        <button onClick={() => void pickFolder()}>{t('board.otherFolder')}</button>
        <span className="spacer" />
        {selected.length > 0 && (
          <button
            className="primary"
            data-testid="board-start-selected"
            disabled={starting || overLimit}
            title={t('board.startLimit', { max: TASK_START_MAX })}
            onClick={() => void start(selected)}
          >
            {t('board.startSelected', { count: selected.length })}
          </button>
        )}
        <button
          className="primary"
          data-testid="board-new"
          disabled={!state}
          onClick={() => setDialog(true)}
        >
          {t('board.newCard')}
        </button>
        <button onClick={onClose} title={hint(t('board.back'), shortcuts.board[0])}>
          {t('board.back')}
        </button>
      </header>
      {selected.length > 1 && (
        <p className="muted board-note" data-testid="board-usage">
          {t('experiment.usage', { count: selected.length })}{' '}
          {t('board.startLimit', { max: TASK_START_MAX })}
        </p>
      )}
      {problem && (
        <p className="form-error board-note" role="alert" data-testid="board-problem">
          {problem}
        </p>
      )}
      {!problem && !folder.trim() && <p className="muted board-note">{t('board.notRepo')}</p>}
      {notice && (
        <p className="form-error board-note" role="alert" data-testid="board-notice">
          {notice}
        </p>
      )}
      {state && tasks.length === 0 && (
        <p className="muted board-note" data-testid="board-empty">
          {t('board.empty')}
        </p>
      )}
      <div className="board-columns">
        {TASK_COLUMNS.map((column) => (
          <section
            key={column}
            className={`board-column ${dragging && DROPPABLE.includes(column) ? 'droppable' : ''}`}
            data-testid={`board-column-${column}`}
            data-column={column}
            aria-label={t(`board.column.${column}`)}
            onDragOver={(e) => {
              if (dragging && DROPPABLE.includes(column)) e.preventDefault();
            }}
            onDrop={(e) => {
              if (!dragging || !DROPPABLE.includes(column)) return;
              e.preventDefault();
              drop(column, null);
            }}
          >
            <h3 title={t(`board.column.${column}Hint`)}>
              {t(`board.column.${column}`)}{' '}
              <span className="group-count" data-testid="board-count">
                {columns[column].length}
              </span>
            </h3>
            <div className="board-cards" role="list">
              {columns[column].length === 0 && (
                <p className="muted board-column-empty">{t('board.columnEmpty')}</p>
              )}
              {columns[column].map((task) => renderCard(task, column))}
            </div>
          </section>
        ))}
      </div>
      <p className="muted board-keys">{t('board.keys')}</p>
      {dialog && (
        <TaskDialog
          folder={state?.repo ?? folder}
          onClose={() => {
            setDialog(false);
            root.current?.focus();
          }}
          onCreated={(board) => {
            setState(board);
            setDialog(false);
            root.current?.focus();
          }}
        />
      )}
    </section>
  );
}
