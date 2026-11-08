import { useEffect, useState, type DragEvent, type KeyboardEvent, type MouseEvent } from 'react';
import { useSonarRuns } from '../lib/sonar';
import { isHorizontal } from '@shared/layout';
import { statusLabel, type SessionGroup, type SessionView } from '@shared/session';
import { hint } from '../lib/format';
import { GroupActions, GroupSonar, RenameInput, SessionItemContent } from './SidebarItems';
import { SidebarToolbar } from './SidebarToolbar';
import { useT } from '../lib/i18n';
import { store, useAppState } from '../lib/store';

interface Props {
  onNew(groupId?: string): void;
  onPreferences(): void;
  onClose(session: SessionView): void;
  onDuplicate(session: SessionView): void;
  /** Without a group, asks for a new one. */
  onEditGroup(group?: SessionGroup, initialSessionId?: string): void;
  /** Asks for a new experiment: the same request in several copies. */
  onNewExperiment(): void;
  /** Opens the comparison of the attempts of an experiment. */
  onCompare(experimentId: string): void;
  onFlow(group: SessionGroup): void;
  /** "Repository validations → Sonar" of a group. */
  onSonar(group: SessionGroup): void;
  /** The keyboard goes back to the terminal after an action in the list. */
  onDone(): void;
  /** Sessions picked with Ctrl+click, to send a prompt to all of them. */
  marked: string[];
  onMarkedChange(ids: string[]): void;
  onSendPrompt(ids: string[]): void;
  /** Opens or closes the overview of every session. */
  onOverview(): void;
  overviewOpen: boolean;
  /** Opens or closes the task board. */
  onBoard(): void;
  boardOpen: boolean;
  /** Opens or closes the pull requests of the watched repositories. */
  onPulls(): void;
  pullsOpen: boolean;
  /** Opens or closes the commands that run in the background. */
  onBackground(): void;
  backgroundOpen: boolean;
}

type Dragging = { kind: 'session'; id: string } | { kind: 'group'; id: string };
type SessionContextMenu = { session: SessionView; x: number; y: number };

export function Sidebar({
  onNew,
  onPreferences,
  onClose,
  onDuplicate,
  onEditGroup,
  onNewExperiment,
  onCompare,
  onFlow,
  onSonar,
  onDone,
  marked,
  onMarkedChange,
  onSendPrompt,
  onOverview,
  overviewOpen,
  onBoard,
  boardOpen,
  onPulls,
  pullsOpen,
  onBackground,
  backgroundOpen,
}: Props) {
  const sonarRuns = useSonarRuns();
  const sessions = useAppState((s) => s.sessions);
  const groups = useAppState((s) => s.groups);
  const selectedId = useAppState((s) => s.selectedId);
  const metrics = useAppState((s) => s.metrics);
  const t = useT();
  const shortcuts = useAppState((s) => s.prefs.shortcuts);
  // On top or at the bottom the list runs sideways, and so do the arrows.
  const horizontal = useAppState((s) => isHorizontal(s.prefs.layout.sessions));
  const [renaming, setRenaming] = useState<string | null>(null);
  const [dragging, setDragging] = useState<Dragging | null>(null);
  const [dropTarget, setDropTarget] = useState<string | null>(null);
  const [contextMenu, setContextMenu] = useState<SessionContextMenu | null>(null);

  useEffect(() => {
    const close = () => setContextMenu(null);
    window.addEventListener('click', close);
    window.addEventListener('blur', close);
    return () => {
      window.removeEventListener('click', close);
      window.removeEventListener('blur', close);
    };
  }, []);

  // The heaviest running session stands out, so it is clear who is weighing on the machine.
  const heaviest = sessions
    .filter((s) => s.running && metrics[s.id])
    .sort((a, b) => metrics[b.id]!.memory - metrics[a.id]!.memory)[0]?.id;
  const showHeaviest = sessions.filter((s) => s.running).length > 1;

  // A collapsed group hides every member; its header keeps the counts and attention marks.
  const collapsed = new Set(groups.filter((g) => g.collapsed).map((g) => g.id));
  const shown = (s: SessionView) => !s.groupId || !collapsed.has(s.groupId);
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
        onContextMenu={(event: MouseEvent) => {
          event.preventDefault();
          onMarkedChange([]);
          store.select(session.id);
          setContextMenu({ session, x: event.clientX, y: event.clientY });
        }}
        onKeyDown={(e) => onKeyDown(e, session)}
      >
        <SessionItemContent
          session={session}
          label={label}
          renaming={renaming === session.id}
          metrics={m}
          heaviest={showHeaviest && heaviest === session.id}
          onRenameEnd={() => {
            setRenaming(null);
            onDone();
          }}
          onDuplicate={() => onDuplicate(session)}
          onClose={() => onClose(session)}
        />
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
          <GroupSonar runs={members.map((m) => sonarRuns[m.id])} />
          <span className="spacer" />
          <GroupActions
            group={group}
            onSonar={() => onSonar(group)}
            onNew={() => onNew(group.id)}
            onFlow={() => onFlow(group)}
            onCompare={onCompare}
            onEdit={() => onEditGroup(group)}
          />
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
      <SidebarToolbar
        onOverview={onOverview}
        overviewOpen={overviewOpen}
        onBoard={onBoard}
        boardOpen={boardOpen}
        onPulls={onPulls}
        pullsOpen={pullsOpen}
        onBackground={onBackground}
        backgroundOpen={backgroundOpen}
        onNewGroup={() => onEditGroup()}
        onNewExperiment={onNewExperiment}
        onPreferences={onPreferences}
      />
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
      {contextMenu && (
        <ul
          className="context-menu"
          role="menu"
          style={{ left: contextMenu.x, top: contextMenu.y }}
          aria-label={t('sidebar.sessionMenu', { name: contextMenu.session.name })}
          onClick={(event) => event.stopPropagation()}
        >
          <li role="none">
            <button
              role="menuitem"
              onClick={() => {
                setRenaming(contextMenu.session.id);
                setContextMenu(null);
              }}
            >
              {t('sidebar.renameSession')}
            </button>
          </li>
          <li role="none">
            <button
              role="menuitem"
              onClick={() => {
                onEditGroup(undefined, contextMenu.session.id);
                setContextMenu(null);
              }}
            >
              {t('sidebar.newGroupWithSession', { name: contextMenu.session.name })}
            </button>
          </li>
        </ul>
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
