import { useEffect, useRef, useState, type DragEvent, type KeyboardEvent } from 'react';
import { isHorizontal } from '@shared/layout';
import { statusLabel, type SessionGroup, type SessionView } from '@shared/session';
import { formatCpu, formatMemory, hint, PROFILE_LABEL } from '../lib/format';
import { ChecksBadge } from './ChecksDialog';
import { OverlapBadge, PermissionAsk, QueueBadge, ReviewBadge } from './SessionMarks';
import { useT } from '../lib/i18n';
import { store, useAppState } from '../lib/store';

interface Props {
  onNew(groupId?: string): void;
  onPreferences(): void;
  onClose(session: SessionView): void;
  onDuplicate(session: SessionView): void;
  /** Without a group, asks for a new one. */
  onEditGroup(group?: SessionGroup): void;
  /** Asks for a new experiment: the same request in several copies. */
  onNewExperiment(): void;
  /** Opens the comparison of the attempts of an experiment. */
  onCompare(experimentId: string): void;
  /** The keyboard goes back to the terminal after an action in the list. */
  onDone(): void;
  /** Sessions picked with Ctrl+click, to send a prompt to all of them. */
  marked: string[];
  onMarkedChange(ids: string[]): void;
  onSendPrompt(ids: string[]): void;
  /** Opens or closes the overview of every session. */
  onOverview(): void;
  overviewOpen: boolean;
}

type Dragging = { kind: 'session'; id: string } | { kind: 'group'; id: string };

function RenameInput({
  value: initial,
  label,
  onCommit,
  onEnd,
}: {
  value: string;
  label: string;
  onCommit(value: string): void;
  onEnd(): void;
}) {
  const [value, setValue] = useState(initial);
  const ref = useRef<HTMLInputElement>(null);
  useEffect(() => ref.current?.select(), []);
  const commit = () => {
    if (value.trim()) onCommit(value);
    onEnd();
  };
  return (
    <input
      ref={ref}
      className="rename-input"
      aria-label={label}
      value={value}
      onChange={(e) => setValue(e.target.value)}
      onBlur={commit}
      onClick={(e) => e.stopPropagation()}
      onDoubleClick={(e) => e.stopPropagation()}
      onKeyDown={(e) => {
        e.stopPropagation();
        if (e.key === 'Enter') commit();
        if (e.key === 'Escape') onEnd();
      }}
    />
  );
}

export function Sidebar({
  onNew,
  onPreferences,
  onClose,
  onDuplicate,
  onEditGroup,
  onNewExperiment,
  onCompare,
  onDone,
  marked,
  onMarkedChange,
  onSendPrompt,
  onOverview,
  overviewOpen,
}: Props) {
  const sessions = useAppState((s) => s.sessions);
  const groups = useAppState((s) => s.groups);
  const selectedId = useAppState((s) => s.selectedId);
  const metrics = useAppState((s) => s.metrics);
  const t = useT();
  const shortcuts = useAppState((s) => s.prefs.shortcuts);
  const permissionStale = useAppState((s) => s.permissionStale);
  // On top or at the bottom the list runs sideways, and so do the arrows.
  const horizontal = useAppState((s) => isHorizontal(s.prefs.layout.sessions));
  const [renaming, setRenaming] = useState<string | null>(null);
  const [dragging, setDragging] = useState<Dragging | null>(null);
  const [dropTarget, setDropTarget] = useState<string | null>(null);

  // The heaviest running session stands out, so it is clear who is weighing on the machine.
  const heaviest = sessions
    .filter((s) => s.running && metrics[s.id])
    .sort((a, b) => metrics[b.id]!.memory - metrics[a.id]!.memory)[0]?.id;
  const showHeaviest = sessions.filter((s) => s.running).length > 1;

  // A collapsed group still shows the session in sight, so the selection is never hidden.
  const collapsed = new Set(groups.filter((g) => g.collapsed).map((g) => g.id));
  const shown = (s: SessionView) => !s.groupId || !collapsed.has(s.groupId) || s.id === selectedId;
  const visible = sessions.filter(shown);
  const ungrouped = visible.filter((s) => !s.groupId || !groups.some((g) => g.id === s.groupId));

  const endDrag = () => {
    setDragging(null);
    setDropTarget(null);
  };

  /** The list in the order `ids`, with the session in `groupId`: one call when the group stays. */
  const place = (session: SessionView, ids: string[], groupId: string | undefined) => {
    if ((session.groupId ?? null) === (groupId ?? null)) store.reorder(ids);
    else void store.moveToGroup(session.id, groupId ?? null, ids);
  };

  const onDropOnSession = (event: DragEvent, target: SessionView) => {
    event.preventDefault();
    const source = dragging?.kind === 'session' && sessions.find((s) => s.id === dragging.id);
    if (source && source.id !== target.id) {
      const ids = sessions.map((s) => s.id).filter((other) => other !== source.id);
      ids.splice(
        sessions.findIndex((s) => s.id === target.id),
        0,
        source.id,
      );
      place(source, ids, target.groupId);
    }
    endDrag();
  };

  const onDropOnGroup = (event: DragEvent, target: SessionGroup) => {
    event.preventDefault();
    if (dragging?.kind === 'session') {
      const source = sessions.find((s) => s.id === dragging.id);
      if (source && source.groupId !== target.id) void store.moveToGroup(source.id, target.id);
    } else if (dragging?.kind === 'group' && dragging.id !== target.id) {
      const ids = groups.map((g) => g.id).filter((id) => id !== dragging.id);
      ids.splice(
        groups.findIndex((g) => g.id === target.id),
        0,
        dragging.id,
      );
      store.reorderGroups(ids);
    }
    endDrag();
  };

  /**
   * The arrows walk the rows as they are drawn: the headers of the groups and the sessions in
   * sight, so a group can be reached, folded and left without the mouse.
   */
  const focusRow = (from: HTMLElement, delta: number) => {
    const rows = [...document.querySelectorAll<HTMLElement>('.session-list [data-nav-row]')];
    const at = rows.indexOf(from);
    rows[Math.max(0, Math.min(rows.length - 1, at + delta))]?.focus();
  };

  /** Ctrl+click and Ctrl+Space: picks the session, or leaves it out, for a prompt to several. */
  const toggleMarked = (session: SessionView) => {
    // The session in sight counts as picked: the others are added to it.
    const start = marked.length === 0 && selectedId ? [selectedId] : marked;
    onMarkedChange(
      start.includes(session.id) ? start.filter((id) => id !== session.id) : [...start, session.id],
    );
  };

  /**
   * Alt+arrow moves a session past its neighbour. Past the edge of its group, it goes to the next
   * section of the list (the sessions with no group, or an open group): to its end going up, to its
   * start going down.
   */
  const moveBy = (session: SessionView, delta: number) => {
    const sections = [undefined, ...groups.filter((g) => !g.collapsed).map((g) => g.id)];
    const own = sections.indexOf(session.groupId);
    const siblings = visible.filter((s) => s.groupId === session.groupId);
    const neighbour = siblings[siblings.indexOf(session) + delta];
    const ids = sessions.map((s) => s.id).filter((id) => id !== session.id);
    let groupId = session.groupId;
    if (neighbour) {
      const at = ids.indexOf(neighbour.id);
      ids.splice(delta > 0 ? at + 1 : at, 0, session.id);
    } else {
      if (own < 0 || own + delta < 0 || own + delta >= sections.length) return;
      groupId = sections[own + delta];
      const members = ids.filter((id) => sessions.find((s) => s.id === id)?.groupId === groupId);
      const edge = delta < 0 ? members.at(-1) : members[0];
      const at = edge === undefined ? ids.length : ids.indexOf(edge) + (delta < 0 ? 1 : 0);
      ids.splice(at, 0, session.id);
    }
    place(session, ids, groupId);
    requestAnimationFrame(() =>
      document.querySelector<HTMLElement>(`[data-session-id="${session.id}"]`)?.focus(),
    );
  };

  const onKeyDown = (event: KeyboardEvent, session: SessionView) => {
    if (renaming) return;
    const [back, forward] = horizontal ? ['ArrowLeft', 'ArrowRight'] : ['ArrowUp', 'ArrowDown'];
    const arrow = event.key === back || event.key === forward;
    // Alt+arrow, or Ctrl+Shift+arrow where the window manager keeps Alt for itself.
    if (arrow && (event.altKey || (event.ctrlKey && event.shiftKey))) {
      event.preventDefault();
      moveBy(session, event.key === back ? -1 : 1);
    } else if (event.key === forward || event.key === back) {
      event.preventDefault();
      focusRow(event.currentTarget as HTMLElement, event.key === forward ? 1 : -1);
    } else if (event.key === ' ' && event.ctrlKey) {
      event.preventDefault();
      toggleMarked(session);
    } else if (event.key === 'Escape') {
      event.preventDefault();
      onDone();
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

  const onGroupKeyDown = (event: KeyboardEvent, group: SessionGroup) => {
    if (renaming || event.target !== event.currentTarget) return;
    const [back, forward] = horizontal ? ['ArrowLeft', 'ArrowRight'] : ['ArrowUp', 'ArrowDown'];
    const arrow = event.key === back || event.key === forward;
    if (arrow && (event.altKey || (event.ctrlKey && event.shiftKey))) {
      event.preventDefault();
      const ids = groups.map((g) => g.id).filter((id) => id !== group.id);
      const from = groups.findIndex((g) => g.id === group.id);
      ids.splice(Math.max(0, from + (event.key === back ? -1 : 1)), 0, group.id);
      store.reorderGroups(ids);
    } else if (arrow) {
      event.preventDefault();
      focusRow(event.currentTarget as HTMLElement, event.key === forward ? 1 : -1);
    } else if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault();
      store.setCollapsed(group.id, !group.collapsed);
    } else if (event.key === 'F2') {
      event.preventDefault();
      setRenaming(group.id);
    } else if (event.key === 'Delete') {
      // The sessions stay, out of any group, as with the × of the header.
      event.preventDefault();
      focusRow(event.currentTarget as HTMLElement, 1);
      void window.api.invoke('groups:remove', group.id);
    } else if (event.key === 'Escape') {
      event.preventDefault();
      onDone();
    }
  };

  const renderSession = (session: SessionView) => {
    const index = visible.indexOf(session);
    const m = session.running ? metrics[session.id] : undefined;
    const label = statusLabel(t, session.status);
    return (
      <li
        key={session.id}
        role="option"
        aria-selected={session.id === selectedId}
        tabIndex={0}
        data-session-index={index}
        data-nav-row
        data-session-id={session.id}
        data-state={session.status.state}
        data-confirmed={session.status.confirmed}
        className={[
          'session-item',
          session.id === selectedId ? 'selected' : '',
          dropTarget === session.id ? 'drop-target' : '',
          dragging?.id === session.id ? 'dragging' : '',
          marked.includes(session.id) ? 'marked' : '',
        ].join(' ')}
        data-marked={marked.includes(session.id) || undefined}
        draggable={renaming !== session.id}
        onDragStart={(e) => {
          e.stopPropagation();
          setDragging({ kind: 'session', id: session.id });
          e.dataTransfer.effectAllowed = 'move';
        }}
        onDragOver={(e) => {
          // A folder dragged in from outside is not a session being reordered.
          if (dragging?.kind !== 'session') return;
          e.preventDefault();
          e.stopPropagation();
          setDropTarget(session.id);
        }}
        onDragEnd={endDrag}
        onDrop={(e) => {
          e.stopPropagation();
          onDropOnSession(e, session);
        }}
        onClick={(e) => {
          if (e.ctrlKey || e.metaKey) {
            toggleMarked(session);
            return;
          }
          onMarkedChange([]);
          store.select(session.id);
          onDone();
        }}
        onDoubleClick={() => setRenaming(session.id)}
        onKeyDown={(e) => onKeyDown(e, session)}
      >
        <span
          className={`state-dot state-${session.status.state} ${session.status.confirmed ? '' : 'inferred'}`}
          title={label}
          aria-label={label}
        />
        <div className="session-text">
          {renaming === session.id ? (
            <RenameInput
              value={session.name}
              label={t('sidebar.sessionName')}
              onCommit={(name) => void window.api.invoke('sessions:rename', session.id, name)}
              onEnd={() => {
                setRenaming(null);
                onDone();
              }}
            />
          ) : (
            <span className="session-name">{session.name}</span>
          )}
          <span className="session-meta">
            {/* First: the end of the line is cut when the list is narrow. */}
            <ReviewBadge session={session} />
            <OverlapBadge session={session} />
            <QueueBadge session={session} />
            <span className={`profile-tag profile-${session.profile}`}>
              {PROFILE_LABEL[session.profile]}
            </span>
            <span
              className={`session-state state-label state-label-${session.status.state} ${session.status.confirmed ? '' : 'inferred'}`}
            >
              {label}
            </span>
            {session.checks && <ChecksBadge summary={session.checks} />}
          </span>
          <PermissionAsk session={session} />
          {permissionStale === session.id && (
            <span className="permission-stale" role="status" data-testid="permission-stale">
              {t('permission.stale')}
            </span>
          )}
          {session.pendingSends ? (
            <span className="pending-send" data-testid="pending-send">
              {t('sidebar.pendingSend', { count: session.pendingSends })}
              <button
                className="link-button"
                aria-label={t('sidebar.cancelSend', { name: session.name })}
                onClick={(e) => {
                  e.stopPropagation();
                  void window.api.invoke('terminal:cancelSend', session.id);
                }}
              >
                {t('common.cancel')}
              </button>
            </span>
          ) : null}
          {m && (
            <span
              className={`session-metrics ${showHeaviest && heaviest === session.id ? 'heaviest' : ''}`}
              title={t('sidebar.processes', { count: m.processes })}
            >
              CPU {formatCpu(m.cpu)} · RAM {formatMemory(m.memory)}
            </span>
          )}
        </div>
        {session.unread && <span className="badge" aria-label={t('sidebar.unread')} />}
        <button
          className="icon-button item-button"
          title={t('sidebar.duplicateHint')}
          aria-label={t('sidebar.duplicate', { name: session.name })}
          onClick={(e) => {
            e.stopPropagation();
            onDuplicate(session);
          }}
        >
          ⧉
        </button>
        <button
          className="icon-button item-button close-button"
          title={t('app.closeSession.title')}
          aria-label={t('sidebar.close', { name: session.name })}
          onClick={(e) => {
            e.stopPropagation();
            onClose(session);
          }}
        >
          ×
        </button>
      </li>
    );
  };

  const renderGroup = (group: SessionGroup) => {
    const members = sessions.filter((s) => s.groupId === group.id);
    const inSight = members.filter(shown);
    const waiting = members.filter((s) => s.status.state === 'aguardando' && s.running).length;
    const unread = members.some((s) => s.unread);
    const headerId = `group-${group.id}`;
    return (
      <li
        key={group.id}
        role="group"
        aria-labelledby={headerId}
        className={`session-group ${group.collapsed ? 'collapsed' : ''}`}
        data-group-id={group.id}
      >
        <div
          id={headerId}
          className={[
            'group-header',
            dropTarget === group.id ? 'drop-target' : '',
            dragging?.id === group.id ? 'dragging' : '',
          ].join(' ')}
          tabIndex={0}
          data-nav-row
          aria-expanded={!group.collapsed}
          aria-label={group.name}
          title={group.collapsed ? t('group.expand', { name: group.name }) : undefined}
          draggable={renaming !== group.id}
          onDragStart={(e) => {
            setDragging({ kind: 'group', id: group.id });
            e.dataTransfer.effectAllowed = 'move';
          }}
          onDragOver={(e) => {
            if (!dragging) return;
            e.preventDefault();
            setDropTarget(group.id);
          }}
          onDragEnd={endDrag}
          onDrop={(e) => onDropOnGroup(e, group)}
          onClick={() => store.setCollapsed(group.id, !group.collapsed)}
          onDoubleClick={(e) => {
            e.stopPropagation();
            setRenaming(group.id);
          }}
          onKeyDown={(e) => onGroupKeyDown(e, group)}
        >
          <span className="group-chevron" aria-hidden="true">
            {group.collapsed ? '▸' : '▾'}
          </span>
          {renaming === group.id ? (
            <RenameInput
              value={group.name}
              label={t('group.name')}
              onCommit={(name) => void window.api.invoke('groups:update', group.id, { name })}
              onEnd={() => setRenaming(null)}
            />
          ) : (
            <span className="group-name">{group.name}</span>
          )}
          <span className="group-count" title={t('group.count', { count: members.length })}>
            {members.length}
          </span>
          {group.collapsed && waiting > 0 && (
            <span className="group-waiting" title={t('group.waiting', { count: waiting })}>
              {waiting}
            </span>
          )}
          {group.collapsed && unread && (
            <span className="badge group-badge" aria-label={t('group.unread')} />
          )}
          <span className="spacer" />
          <button
            className="icon-button item-button"
            title={t('group.newSession', { name: group.name })}
            aria-label={t('group.newSession', { name: group.name })}
            onClick={(e) => {
              e.stopPropagation();
              onNew(group.id);
            }}
          >
            +
          </button>
          {group.experimentId && (
            <button
              className="icon-button item-button compare-button"
              title={t('group.compare', { name: group.name })}
              aria-label={t('group.compare', { name: group.name })}
              data-testid="compare-button"
              onClick={(e) => {
                e.stopPropagation();
                onCompare(group.experimentId!);
              }}
            >
              ⇄
            </button>
          )}
          <button
            className="icon-button item-button"
            title={t('group.edit', { name: group.name })}
            aria-label={t('group.edit', { name: group.name })}
            onClick={(e) => {
              e.stopPropagation();
              onEditGroup(group);
            }}
          >
            ✎
          </button>
          <button
            className="icon-button item-button close-button"
            title={t('group.remove', { name: group.name })}
            aria-label={t('group.remove', { name: group.name })}
            onClick={(e) => {
              e.stopPropagation();
              void window.api.invoke('groups:remove', group.id);
            }}
          >
            ×
          </button>
        </div>
        <ul className="group-sessions" role="presentation">
          {inSight.map(renderSession)}
          {members.length === 0 && !group.collapsed && (
            <li role="presentation" className="group-empty">
              {t('group.empty')}
            </li>
          )}
        </ul>
      </li>
    );
  };

  // Only a session that is in a group can be taken out of one.
  const draggedSession = dragging?.kind === 'session' && sessions.find((s) => s.id === dragging.id);
  const canUngroup = draggedSession && draggedSession.groupId;

  return (
    <aside className="sidebar" aria-label={t('common.sessions')}>
      <div className="sidebar-header">
        <span className="sidebar-title">{t('common.sessions')}</span>
        <span className="spacer" />
        <button
          className={`icon-button ${overviewOpen ? 'active' : ''}`}
          title={hint(t('overview.open'), shortcuts.overview[0])}
          aria-label={t('overview.open')}
          aria-pressed={overviewOpen}
          data-testid="overview-button"
          onClick={onOverview}
        >
          ▦
        </button>
        <button
          className="icon-button"
          title={t('sidebar.newGroup')}
          aria-label={t('sidebar.newGroup')}
          onClick={() => onEditGroup()}
        >
          ⊞
        </button>
        <button
          className="icon-button"
          title={t('command.newExperiment')}
          aria-label={t('command.newExperiment')}
          data-testid="new-experiment-button"
          onClick={onNewExperiment}
        >
          ⑂
        </button>
        <button
          className="icon-button"
          title={hint(t('shortcut.preferences'), shortcuts.preferences[0])}
          onClick={onPreferences}
        >
          ⚙
        </button>
      </div>
      <ul className="session-list" role="listbox" aria-label={t('sidebar.list')}>
        {canUngroup && (
          <li
            role="presentation"
            className={`ungrouped-drop ${dropTarget === 'ungrouped' ? 'drop-target' : ''}`}
            onDragOver={(e) => {
              e.preventDefault();
              setDropTarget('ungrouped');
            }}
            onDrop={(e) => {
              e.preventDefault();
              void store.moveToGroup(draggedSession.id, null);
              endDrag();
            }}
          >
            {t('sidebar.ungroupedDrop')}
          </li>
        )}
        {ungrouped.map(renderSession)}
        {groups.map(renderGroup)}
      </ul>
      {marked.length > 0 && (
        <div className="marked-bar" role="status">
          <span>{t('sidebar.marked', { count: marked.length })}</span>
          <button className="primary" onClick={() => onSendPrompt(marked)}>
            {t('sidebar.sendPrompt')}
          </button>
          <button onClick={() => onMarkedChange([])}>{t('sidebar.unmark')}</button>
        </div>
      )}
      <button
        className="new-session-button"
        onClick={() => onNew()}
        title={hint(t('shortcut.newSession'), shortcuts.newSession[0])}
      >
        {t('sidebar.new')}
      </button>
    </aside>
  );
}
