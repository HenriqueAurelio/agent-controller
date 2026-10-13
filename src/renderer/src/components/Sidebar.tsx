import { useEffect, useRef, useState, type DragEvent, type KeyboardEvent } from 'react';
import { statusLabel, type SessionView } from '@shared/session';
import { formatCpu, formatMemory, PROFILE_LABEL } from '../lib/format';
import { store, useAppState } from '../lib/store';

interface Props {
  onNew(): void;
  onPreferences(): void;
  onClose(session: SessionView): void;
  /** The keyboard goes back to the terminal after an action in the list. */
  onDone(): void;
}

function RenameInput({ session, onEnd }: { session: SessionView; onEnd(): void }) {
  const [value, setValue] = useState(session.name);
  const ref = useRef<HTMLInputElement>(null);
  useEffect(() => ref.current?.select(), []);
  const commit = () => {
    if (value.trim()) void window.api.invoke('sessions:rename', session.id, value);
    onEnd();
  };
  return (
    <input
      ref={ref}
      className="rename-input"
      aria-label="Nome da sessão"
      value={value}
      onChange={(e) => setValue(e.target.value)}
      onBlur={commit}
      onClick={(e) => e.stopPropagation()}
      onKeyDown={(e) => {
        e.stopPropagation();
        if (e.key === 'Enter') commit();
        if (e.key === 'Escape') onEnd();
      }}
    />
  );
}

export function Sidebar({ onNew, onPreferences, onClose, onDone }: Props) {
  const sessions = useAppState((s) => s.sessions);
  const selectedId = useAppState((s) => s.selectedId);
  const metrics = useAppState((s) => s.metrics);
  const [renaming, setRenaming] = useState<string | null>(null);
  const [dragging, setDragging] = useState<string | null>(null);
  const [dropTarget, setDropTarget] = useState<string | null>(null);

  // The heaviest running session stands out, so it is clear who is weighing on the machine.
  const heaviest = sessions
    .filter((s) => s.running && metrics[s.id])
    .sort((a, b) => metrics[b.id]!.memory - metrics[a.id]!.memory)[0]?.id;
  const showHeaviest = sessions.filter((s) => s.running).length > 1;

  const move = (id: string, toIndex: number) => {
    const ids = sessions.map((s) => s.id).filter((other) => other !== id);
    ids.splice(Math.max(0, Math.min(ids.length, toIndex)), 0, id);
    store.reorder(ids);
  };

  const onDrop = (event: DragEvent, target: SessionView) => {
    event.preventDefault();
    if (dragging && dragging !== target.id) {
      move(
        dragging,
        sessions.findIndex((s) => s.id === target.id),
      );
    }
    setDragging(null);
    setDropTarget(null);
  };

  const onKeyDown = (event: KeyboardEvent, session: SessionView, index: number) => {
    if (renaming) return;
    const focusItem = (i: number) =>
      document.querySelector<HTMLElement>(`[data-session-index="${i}"]`)?.focus();
    const arrow = event.key === 'ArrowUp' || event.key === 'ArrowDown';
    // Alt+arrow, or Ctrl+Shift+arrow where the window manager keeps Alt for itself.
    if (arrow && (event.altKey || (event.ctrlKey && event.shiftKey))) {
      event.preventDefault();
      const to = index + (event.key === 'ArrowUp' ? -1 : 1);
      move(session.id, to);
      requestAnimationFrame(() => focusItem(Math.max(0, Math.min(sessions.length - 1, to))));
    } else if (event.key === 'ArrowDown') {
      event.preventDefault();
      focusItem(Math.min(sessions.length - 1, index + 1));
    } else if (event.key === 'ArrowUp') {
      event.preventDefault();
      focusItem(Math.max(0, index - 1));
    } else if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault();
      store.select(session.id);
      onDone();
    } else if (event.key === 'F2') {
      event.preventDefault();
      setRenaming(session.id);
    } else if (event.key === 'Delete') {
      event.preventDefault();
      onClose(session);
    }
  };

  return (
    <aside className="sidebar" aria-label="Sessões">
      <div className="sidebar-header">
        <span className="sidebar-title">Sessões</span>
        <button className="icon-button" title="Preferências (Ctrl+,)" onClick={onPreferences}>
          ⚙
        </button>
      </div>
      <ul className="session-list" role="listbox" aria-label="Lista de sessões">
        {sessions.map((session, index) => {
          const m = session.running ? metrics[session.id] : undefined;
          const label = statusLabel(session.status);
          return (
            <li
              key={session.id}
              role="option"
              aria-selected={session.id === selectedId}
              tabIndex={0}
              data-session-index={index}
              data-session-id={session.id}
              data-state={session.status.state}
              data-confirmed={session.status.confirmed}
              className={[
                'session-item',
                session.id === selectedId ? 'selected' : '',
                dropTarget === session.id ? 'drop-target' : '',
                dragging === session.id ? 'dragging' : '',
              ].join(' ')}
              draggable={renaming !== session.id}
              onDragStart={(e) => {
                setDragging(session.id);
                e.dataTransfer.effectAllowed = 'move';
              }}
              onDragOver={(e) => {
                e.preventDefault();
                setDropTarget(session.id);
              }}
              onDragEnd={() => {
                setDragging(null);
                setDropTarget(null);
              }}
              onDrop={(e) => onDrop(e, session)}
              onClick={() => {
                store.select(session.id);
                onDone();
              }}
              onDoubleClick={() => setRenaming(session.id)}
              onKeyDown={(e) => onKeyDown(e, session, index)}
            >
              <span
                className={`state-dot state-${session.status.state} ${session.status.confirmed ? '' : 'inferred'}`}
                title={label}
                aria-label={label}
              />
              <div className="session-text">
                {renaming === session.id ? (
                  <RenameInput
                    session={session}
                    onEnd={() => {
                      setRenaming(null);
                      onDone();
                    }}
                  />
                ) : (
                  <span className="session-name">{session.name}</span>
                )}
                <span className="session-meta">
                  <span className={`profile-tag profile-${session.profile}`}>
                    {PROFILE_LABEL[session.profile]}
                  </span>
                  <span className="session-state">{label}</span>
                </span>
                {m && (
                  <span
                    className={`session-metrics ${showHeaviest && heaviest === session.id ? 'heaviest' : ''}`}
                    title={`${m.processes} processo(s) na árvore da sessão`}
                  >
                    CPU {formatCpu(m.cpu)} · RAM {formatMemory(m.memory)}
                  </span>
                )}
              </div>
              {session.unread && <span className="badge" aria-label="Tem novidade" />}
              <button
                className="icon-button close-button"
                title="Fechar sessão"
                aria-label={`Fechar ${session.name}`}
                onClick={(e) => {
                  e.stopPropagation();
                  onClose(session);
                }}
              >
                ×
              </button>
            </li>
          );
        })}
      </ul>
      <button className="new-session-button" onClick={onNew} title="Nova sessão (Ctrl+Shift+N)">
        + Nova sessão
      </button>
    </aside>
  );
}
