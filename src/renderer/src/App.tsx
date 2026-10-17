import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { statusDetail, statusLabel, type SessionGroup, type SessionView } from '@shared/session';
import {
  bindingFromEvent,
  bindingIndex,
  SESSION_BINDING,
  type ShortcutAction,
} from '@shared/shortcuts';
import { ChangeFolderDialog } from './components/ChangeFolderDialog';
import { ChangesPanel, type PanelMode } from './components/ChangesPanel';
import { ChecksBadge, ChecksDialog } from './components/ChecksDialog';
import { CloseSessionDialog } from './components/CloseSessionDialog';
import { CommandPalette, type Command } from './components/CommandPalette';
import { GroupDialog } from './components/GroupDialog';
import { codeThemeName, themesOfKind, useCustomThemes } from './lib/codeThemes';
import { NewSessionDialog } from './components/NewSessionDialog';
import { PreferencesDialog } from './components/PreferencesDialog';
import { PromptDialog, type PromptContext } from './components/PromptDialog';
import { QueueDialog, sendQueueFailure, skipQueueItem } from './components/QueueDialog';
import { Sidebar } from './components/Sidebar';
import { TerminalArea, type TerminalAreaHandle } from './components/TerminalArea';
import { hint, PROFILE_LABEL } from './lib/format';
import { rich, useT } from './lib/i18n';
import { shortcutRecording } from './lib/shortcuts';
import { store, useAppState } from './lib/store';

/** The session in sight asks a permission that may be answered from outside the terminal. */
const answerable = (state: ReturnType<typeof store.get>): boolean =>
  state.prefs.permissionButtons &&
  Boolean(state.sessions.find((s) => s.id === state.selectedId)?.permission);

type Overlay =
  'new' | 'prefs' | 'palette' | 'folder' | 'checks' | 'prompt' | 'group' | 'queue' | null;

interface PromptRequest {
  promptId?: string;
  targets: string[];
  context: PromptContext;
}

export function App() {
  const sessions = useAppState((s) => s.sessions);
  const groups = useAppState((s) => s.groups);
  const selectedId = useAppState((s) => s.selectedId);
  const theme = useAppState((s) => s.prefs.theme);
  const shortcuts = useAppState((s) => s.prefs.shortcuts);
  const layout = useAppState((s) => s.prefs.layout);
  const language = useAppState((s) => s.prefs.language);
  const agentCommands = useAppState((s) => s.prefs.agentCommands);
  const prompts = useAppState((s) => s.prefs.prompts);
  const t = useT();
  const customThemes = useCustomThemes();
  const [overlay, setOverlay] = useState<Overlay>(null);
  /** The folder a new session was asked for, when it came from one dropped on the window. */
  const [newFolder, setNewFolder] = useState<string | undefined>(undefined);
  /** The group a new session was asked for from. */
  const [newGroup, setNewGroup] = useState<string | undefined>(undefined);
  /** The group being edited in the group dialog; none, a new one. */
  const [editedGroup, setEditedGroup] = useState<SessionGroup | undefined>(undefined);
  const [dropping, setDropping] = useState(false);
  const [closing, setClosing] = useState<SessionView | null>(null);
  const [changesOpen, setChangesOpen] = useState(false);
  const [panelMode, setPanelMode] = useState<PanelMode>('changes');
  const [changeCount, setChangeCount] = useState<number | null>(null);
  const terminals = useRef<TerminalAreaHandle>(null);
  /** Sessions picked in the list with Ctrl+click. */
  const [marked, setMarked] = useState<string[]>([]);
  const [promptRequest, setPromptRequest] = useState<PromptRequest | null>(null);
  /** The file open in the changes panel, which a prompt may name. */
  const panelFile = useRef<string | null>(null);

  // Unsaved edits in the changes panel: anything that would close the panel asks first.
  const unsavedRef = useRef<string | null>(null);
  const changesOpenRef = useRef(false);
  changesOpenRef.current = changesOpen;
  const panelModeRef = useRef(panelMode);
  panelModeRef.current = panelMode;
  const setUnsaved = useCallback((file: string | null) => {
    if (unsavedRef.current === file) return;
    unsavedRef.current = file;
    void window.api.invoke('app:setUnsaved', file);
  }, []);
  const mayDiscardEdits = useCallback(
    () =>
      !unsavedRef.current ||
      window.confirm(t('common.unsavedConfirm', { file: unsavedRef.current })),
    [t],
  );
  /** Opens the panel in `mode`; asked for the mode it is already in, closes it. */
  const togglePanel = useCallback(
    (mode: PanelMode) => {
      if (!store.get().selectedId) return;
      const open = changesOpenRef.current;
      if (open && !mayDiscardEdits()) return;
      setChangesOpen(!open || panelModeRef.current !== mode);
      setPanelMode(mode);
    },
    [mayDiscardEdits],
  );
  const showPanel = useCallback(
    (mode: PanelMode) => {
      if (!changesOpenRef.current || panelModeRef.current !== mode) togglePanel(mode);
    },
    [togglePanel],
  );
  useEffect(() => {
    store.setLeaveGuard(mayDiscardEdits);
    return () => store.setLeaveGuard(null);
  }, [mayDiscardEdits]);

  const selected = sessions.find((s) => s.id === selectedId) ?? null;
  // Another session in the same copy of the repository: the two touch the same files.
  const sharing =
    selected?.worktree && sessions.find((s) => s.id !== selected.id && s.cwd === selected.cwd);
  // What the session runs in place of the agent, when it is not the agent itself.
  const agentCommand = selected && (selected.command || agentCommands[selected.profile]);
  const sessionIds = useMemo(() => sessions.map((s) => s.id), [sessions]);
  // A session that was closed is no longer picked.
  const liveMarked = marked.filter((id) => sessionIds.includes(id));

  /** Opens the dialog that sends a prompt: to the picked sessions, or to the one in sight. */
  const openPrompt = useCallback(
    (promptId?: string, context: PromptContext = {}, targets?: string[]) => {
      const { selectedId: current, sessions: list } = store.get();
      const picked = marked.filter((id) => list.some((s) => s.id === id));
      const to = targets ?? (picked.length ? picked : current ? [current] : []);
      setPromptRequest({
        promptId,
        targets: to,
        context: { file: panelFile.current ?? undefined, ...context },
      });
      setOverlay('prompt');
    },
    [marked],
  );

  useEffect(() => {
    document.documentElement.dataset.theme = theme;
  }, [theme]);
  useEffect(() => {
    document.documentElement.lang = language;
  }, [language]);

  // The taskbar says how many agents are waiting, even with the window out of sight.
  const waiting = sessions.filter((s) => s.status.state === 'aguardando' && s.running).length;
  useEffect(() => {
    document.title = waiting > 0 ? t('app.titleWaiting', { count: waiting }) : 'Agent Controller';
  }, [waiting, t]);

  // What is on top of the terminal right now, readable from a callback that runs later.
  const coveredRef = useRef(false);
  // A panel beside the terminal leaves it in sight, and reachable.
  coveredRef.current = Boolean(overlay || closing || (changesOpen && layout.panel === 'cover'));

  /**
   * Hands the keyboard to the terminal on the next frame. By then the user may have opened or
   * focused something else; unless `force`d, that is left alone.
   */
  const focusTerminal = useCallback((force = false) => {
    requestAnimationFrame(() => {
      if (coveredRef.current) return;
      const active = document.activeElement;
      const elsewhere = active && active !== document.body && !active.closest('.terminal-area');
      if (elsewhere && !force) return;
      terminals.current?.focus();
    });
  }, []);

  const selectByOffset = useCallback((offset: number) => {
    const { sessions: list, selectedId: current } = store.get();
    if (list.length === 0) return;
    const index = list.findIndex((s) => s.id === current);
    store.select(list[(index + offset + list.length) % list.length]!.id);
  }, []);

  const requestClose = useCallback((session: SessionView) => {
    // A running agent is only closed after confirmation; a copy of the repository, after asking
    // what to do with it.
    if (session.running || session.worktree) setClosing(session);
    else void window.api.invoke('sessions:remove', session.id);
  }, []);

  /** The agent starts at the size of its terminal, which is mounted on the next frame. */
  const starting = useRef(new Set<string>());
  const startWhenMounted = useCallback((id: string) => {
    // Creating a session also selects it: one start for both, or a failure is told twice.
    if (starting.current.has(id)) return;
    starting.current.add(id);
    requestAnimationFrame(() =>
      requestAnimationFrame(() => {
        starting.current.delete(id);
        terminals.current?.start(id);
      }),
    );
  }, []);

  // Opening a session that is not running starts its agent. One that exits while in sight stays
  // stopped, with its last words on screen, until Enter starts it again (see `SessionManager`).
  useEffect(() => {
    const session = store.get().sessions.find((s) => s.id === selectedId);
    if (session && !session.running) startWhenMounted(session.id);
  }, [selectedId, startWhenMounted]);

  const openNew = useCallback((folder?: string, groupId?: string) => {
    setNewFolder(folder);
    setNewGroup(groupId);
    setOverlay('new');
  }, []);
  const editGroup = useCallback((group?: SessionGroup) => {
    setEditedGroup(group);
    setOverlay('group');
  }, []);

  // Both leave the open file of the changes panel behind.
  const duplicate = useCallback(
    (session: SessionView) => {
      if (!mayDiscardEdits()) return;
      void window.api
        .invoke('sessions:duplicate', session.id)
        .then((copy) => startWhenMounted(copy.id));
    },
    [mayDiscardEdits, startWhenMounted],
  );
  const changeFolder = useCallback(() => {
    if (store.get().selectedId && mayDiscardEdits()) setOverlay('folder');
  }, [mayDiscardEdits]);

  // A folder dropped anywhere on the window asks for a session in it.
  useEffect(() => {
    const carriesFiles = (event: DragEvent) => event.dataTransfer?.types.includes('Files') ?? false;
    let depth = 0;
    const onEnter = (event: DragEvent) => {
      if (!carriesFiles(event)) return;
      depth++;
      setDropping(true);
    };
    const onLeave = (event: DragEvent) => {
      if (!carriesFiles(event)) return;
      depth = Math.max(0, depth - 1);
      if (depth === 0) setDropping(false);
    };
    const onOver = (event: DragEvent) => {
      if (!carriesFiles(event)) return;
      event.preventDefault();
      event.dataTransfer!.dropEffect = 'copy';
    };
    const onDrop = (event: DragEvent) => {
      if (!carriesFiles(event)) return;
      event.preventDefault();
      depth = 0;
      setDropping(false);
      const file = event.dataTransfer!.files[0];
      const dropped = file ? window.api.pathForFile(file) : '';
      if (!dropped) return;
      void window.api
        .invoke('folders:resolve', dropped)
        .then((folder) => folder && openNew(folder));
    };
    window.addEventListener('dragenter', onEnter);
    window.addEventListener('dragleave', onLeave);
    window.addEventListener('dragover', onOver);
    window.addEventListener('drop', onDrop);
    return () => {
      window.removeEventListener('dragenter', onEnter);
      window.removeEventListener('dragleave', onLeave);
      window.removeEventListener('dragover', onOver);
      window.removeEventListener('drop', onDrop);
    };
  }, [openNew]);

  // The counter on the "see changes" button.
  const selectedState = selected?.status.state;
  useEffect(() => {
    if (!selectedId) return;
    let cancelled = false;
    void window.api
      .invoke('git:count', selectedId)
      .then((count) => !cancelled && setChangeCount(count));
    return () => {
      cancelled = true;
    };
  }, [selectedId, selectedState, changesOpen]);

  useEffect(
    () =>
      window.api.on('app:focusSession', (id) => {
        store.select(id);
        focusTerminal(true);
      }),
    [focusTerminal],
  );

  const selectNextWaiting = useCallback(() => {
    const { sessions: list, selectedId: current } = store.get();
    const from = list.findIndex((s) => s.id === current);
    for (let step = 1; step <= list.length; step++) {
      const candidate = list[(from + step + list.length) % list.length]!;
      if (candidate.status.state === 'aguardando' && candidate.running) {
        store.select(candidate.id);
        return;
      }
    }
  }, []);

  const runAction = useCallback(
    /** `fromKey`: pressed as a shortcut, not picked from a button or the palette. */
    (action: ShortcutAction, fromKey = false) => {
      const { sessions: list, selectedId: current, prefs } = store.get();
      const session = list.find((s) => s.id === current);
      const run: Record<ShortcutAction, () => void> = {
        newSession: () => openNew(),
        nextSession: () => selectByOffset(1),
        prevSession: () => selectByOffset(-1),
        nextWaiting: selectNextWaiting,
        closeSession: () => session && requestClose(session),
        focusSidebar: () => {
          setOverlay(null);
          document.querySelector<HTMLElement>('.session-item.selected, .session-item')?.focus();
        },
        focusTerminal: () => {
          setOverlay(null);
          requestAnimationFrame(() => focusTerminal(true));
        },
        palette: () => setOverlay((o) => (o === 'palette' ? null : 'palette')),
        toggleChanges: () => togglePanel('changes'),
        toggleFiles: () => togglePanel('files'),
        toggleHidden: () =>
          void window.api.invoke('prefs:set', { showHiddenFiles: !prefs.showHiddenFiles }),
        toggleAux: () => {
          if (!session) return;
          // The shell lives under the panel when the panel covers the terminal.
          if (changesOpenRef.current && prefs.layout.panel === 'cover') {
            if (!mayDiscardEdits()) return;
            setChangesOpen(false);
          }
          setOverlay(null);
          terminals.current?.toggleAux(fromKey);
        },
        sendPrompt: () => openPrompt(),
        allowPermission: () => session && void store.answerPermission(session.id, 'allow'),
        denyPermission: () => session && void store.answerPermission(session.id, 'deny'),
        newGroup: () => editGroup(),
        preferences: () => setOverlay('prefs'),
      };
      run[action]();
    },
    [
      selectByOffset,
      selectNextWaiting,
      requestClose,
      focusTerminal,
      togglePanel,
      openNew,
      mayDiscardEdits,
      openPrompt,
      editGroup,
    ],
  );

  const commands = useMemo<Command[]>(() => {
    const action = (id: ShortcutAction, title?: string, run?: () => void): Command => ({
      id,
      title: title ?? t(`shortcut.${id}`),
      shortcut: shortcuts[id][0],
      run: run ?? (() => runAction(id)),
    });
    const list: Command[] = [
      action('newSession'),
      action('nextSession'),
      action('prevSession'),
      action('nextWaiting'),
      action('focusSidebar'),
      action('preferences'),
      action('newGroup', t('command.newGroup')),
    ];
    for (const group of groups) {
      list.push({
        id: `edit-group-${group.id}`,
        title: t('command.editGroup', { name: group.name }),
        run: () => editGroup(group),
      });
    }
    if (selected) {
      list.unshift(
        action('toggleChanges', t('command.seeChanges'), () => showPanel('changes')),
        action('toggleFiles', t('command.files'), () => showPanel('files')),
        action('toggleHidden', t('command.toggleHidden')),
        action(
          'toggleAux',
          t(selected.auxOpen ? 'command.closeAux' : 'command.openAux', { name: selected.name }),
        ),
      );
      if (selected.permission && selected.running) {
        list.unshift(action('allowPermission'), action('denyPermission'));
      }
      if (selected.auxOpen) {
        list.push(
          {
            id: 'aux-grow',
            title: t('command.auxGrow'),
            run: () => terminals.current?.resizeAux(1),
          },
          {
            id: 'aux-shrink',
            title: t('command.auxShrink'),
            run: () => terminals.current?.resizeAux(-1),
          },
        );
      }
      list.push(
        selected.running
          ? {
              id: 'stop',
              title: t('command.stop', { name: selected.name }),
              run: () => void window.api.invoke('sessions:stop', selected.id),
            }
          : {
              id: 'start',
              title: t('command.start', { name: selected.name }),
              run: () => terminals.current?.start(selected.id),
            },
        {
          id: 'folder',
          title: t('command.changeFolder', { name: selected.name }),
          run: changeFolder,
        },
        {
          id: 'checks',
          title: t('command.checks', { name: selected.name }),
          run: () => setOverlay('checks'),
        },
        {
          id: 'run-checks',
          title: t('command.runChecks', { name: selected.name }),
          run: () => void window.api.invoke('checks:run', selected.id),
        },
        {
          id: 'queue',
          title: t('command.queue', { name: selected.name }),
          run: () => setOverlay('queue'),
        },
        {
          id: 'duplicate',
          title: t('command.duplicate', { name: selected.name }),
          run: () => duplicate(selected),
        },
        {
          id: 'close',
          title: t('command.close', { name: selected.name }),
          run: () => requestClose(selected),
        },
      );
      for (const group of groups) {
        if (group.id === selected.groupId) {
          list.push({
            id: `leave-group-${group.id}`,
            title: t('command.leaveGroup', { name: selected.name, group: group.name }),
            run: () => void store.moveToGroup(selected.id, null),
          });
        } else {
          list.push({
            id: `move-to-group-${group.id}`,
            title: t('command.moveToGroup', { name: selected.name, group: group.name }),
            run: () => void store.moveToGroup(selected.id, group.id),
          });
        }
      }
    }
    if (prompts.length > 0) list.push(action('sendPrompt'));
    for (const prompt of prompts) {
      list.push({
        id: `prompt-${prompt.id}`,
        title: t('command.prompt', { name: prompt.name }),
        shortcut: prompt.shortcut,
        run: () => openPrompt(prompt.id),
      });
    }
    // The code themes of the current kind, to switch from the keyboard.
    for (const codeTheme of themesOfKind(theme, customThemes)) {
      list.push({
        id: `code-theme-${codeTheme.id}`,
        title: t('command.codeTheme', { name: codeThemeName(t, codeTheme) }),
        run: () =>
          void window.api.invoke('prefs:set', {
            [theme === 'light' ? 'codeThemeLight' : 'codeThemeDark']: codeTheme.id,
          }),
      });
    }
    sessions.forEach((s, i) =>
      list.push({
        id: `go-${s.id}`,
        title: t('command.goTo', { name: s.name }),
        shortcut: i < 9 ? `Ctrl+${i + 1}` : undefined,
        run: () => store.select(s.id),
      }),
    );
    return list;
  }, [
    sessions,
    groups,
    selected,
    shortcuts,
    runAction,
    showPanel,
    requestClose,
    changeFolder,
    duplicate,
    prompts,
    openPrompt,
    editGroup,
    theme,
    customThemes,
    t,
  ]);

  // Global shortcuts are taken in the capture phase, before the terminal sees the key.
  const bindings = useMemo(() => bindingIndex(shortcuts), [shortcuts]);
  const promptBindings = useMemo(
    () => new Map(prompts.flatMap((p) => (p.shortcut ? [[p.shortcut, p.id] as const] : []))),
    [prompts],
  );
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      // The preferences are asking which keys a shortcut should have.
      if (shortcutRecording.active) return;
      const binding = bindingFromEvent(event);
      if (!binding) return;
      const position = SESSION_BINDING.exec(binding)?.[1];
      const action = bindings.get(binding);
      if (
        (action === 'allowPermission' || action === 'denyPermission') &&
        !answerable(store.get())
      ) {
        // Nothing is being asked: the key is the terminal's.
        return;
      }
      if (position) {
        const target = store.get().sessions[Number(position) - 1];
        if (target) store.select(target.id);
      } else if (action) runAction(action, true);
      else if (promptBindings.has(binding)) openPrompt(promptBindings.get(binding));
      else return;
      event.preventDefault();
      event.stopPropagation();
    };
    window.addEventListener('keydown', onKeyDown, true);
    return () => window.removeEventListener('keydown', onKeyDown, true);
  }, [bindings, promptBindings, runAction, openPrompt]);

  // Whenever nothing is on top of it, the terminal has the keyboard.
  useEffect(() => {
    if (!overlay && !closing && !changesOpen) focusTerminal();
  }, [overlay, closing, changesOpen, selectedId, focusTerminal]);

  const closeOverlay = () => setOverlay(null);
  const detail = selected && statusDetail(t, selected.status.detail);

  return (
    <div className="app" data-sessions={layout.sessions}>
      <Sidebar
        onNew={(groupId) => openNew(undefined, groupId)}
        onEditGroup={editGroup}
        onPreferences={() => setOverlay('prefs')}
        onClose={requestClose}
        onDuplicate={duplicate}
        onDone={() => focusTerminal(true)}
        marked={liveMarked}
        onMarkedChange={setMarked}
        onSendPrompt={(ids) => openPrompt(undefined, {}, ids)}
      />
      <main className="main">
        {selected && (
          <header className="session-header">
            <span
              className={`state-dot state-${selected.status.state} ${selected.status.confirmed ? '' : 'inferred'}`}
            />
            <div className="session-header-text">
              <strong>{selected.name}</strong>
              <span className="muted">
                {PROFILE_LABEL[selected.profile]}
                {agentCommand && <span className="command"> · {agentCommand}</span>}
              </span>
              {selected.worktree && (
                <span
                  className="worktree-tag"
                  data-testid="session-worktree"
                  title={t('app.worktreeHint', {
                    repo: selected.worktree.repoRoot,
                    branch: selected.worktree.branch,
                    base: selected.worktree.base,
                  })}
                >
                  <span aria-hidden="true">⑂</span> {selected.worktree.branch}
                </span>
              )}
              <span
                data-testid="session-status"
                className={`state-label state-label-${selected.status.state} ${selected.status.confirmed ? '' : 'inferred'}`}
              >
                {statusLabel(t, selected.status)}
                {detail && selected.status.state !== 'terminou' ? ` (${detail})` : ''}
              </span>
              <button
                className="muted path"
                title={`${selected.cwd}\n${t('app.changeFolderHint')}`}
                aria-label={t('app.changeFolder')}
                onClick={changeFolder}
              >
                {selected.cwd}
              </button>
            </div>
            <span className="spacer" />
            <button
              className={changesOpen && panelMode === 'changes' ? 'active' : ''}
              onClick={() => togglePanel('changes')}
              title={hint(t('app.seeChanges'), shortcuts.toggleChanges[0])}
            >
              {t('app.seeChanges')}
              {changeCount !== null && changeCount > 0 && (
                <span className="count">{changeCount}</span>
              )}
            </button>
            <button
              className={changesOpen && panelMode === 'files' ? 'active' : ''}
              onClick={() => togglePanel('files')}
              title={hint(t('app.allFilesHint'), shortcuts.toggleFiles[0])}
            >
              {t('common.files')}
            </button>
            <button
              className={selected.auxOpen ? 'active' : ''}
              aria-pressed={selected.auxOpen === true}
              onClick={() => runAction('toggleAux')}
              title={hint(t('app.auxHint'), shortcuts.toggleAux[0])}
            >
              {t('app.aux')}
            </button>
            <button
              className="queue-button"
              onClick={() => setOverlay('queue')}
              title={t('app.queueHint')}
            >
              {t('app.queue')}
              {selected.queue && (
                <span className={`count ${selected.queue.paused ? 'paused' : ''}`}>
                  {selected.queue.items}
                </span>
              )}
            </button>
            <button
              className="checks-button"
              onClick={() => setOverlay('checks')}
              title={t('app.checksHint')}
            >
              {t('app.checks')}
              {selected.checks && <ChecksBadge summary={selected.checks} />}
            </button>
          </header>
        )}
        {sharing && (
          <div className="banner" role="status">
            {t('app.worktreeShared', { name: sharing.name })}
          </div>
        )}
        {selected?.queue &&
          (selected.queue.blockedBy === 'checksFailed' ||
            selected.queue.blockedBy === 'noChecks' ||
            selected.queue.blockedBy === 'sendFailed') && (
            <div className="banner queue-banner" role="alert" data-testid="queue-banner">
              <span>{t(`queue.banner.${selected.queue.blockedBy}`)}</span>
              {selected.queue.blockedBy === 'checksFailed' && (
                <button
                  title={t('queue.sendFailureHint')}
                  onClick={() => void sendQueueFailure(selected.id).catch(() => {})}
                >
                  {t('queue.sendFailure')}
                </button>
              )}
              <button onClick={() => void skipQueueItem(selected.id).catch(() => {})}>
                {t('queue.skip')}
              </button>
              <button
                onClick={() => void window.api.invoke('queue:resume', selected.id).catch(() => {})}
              >
                {t('queue.resume')}
              </button>
              <button className="link-button" onClick={() => setOverlay('queue')}>
                {t('queue.banner.open')}
              </button>
            </div>
          )}
        {selected?.running && selected.hooks === 'inactive' && (
          <div className="banner" role="status">
            {rich(t('app.codexHooksBanner'), { screen: <strong>Hooks need review</strong> })}
          </div>
        )}
        <div className="content" data-panel={changesOpen && selected ? layout.panel : undefined}>
          <TerminalArea ref={terminals} session={selected} sessionIds={sessionIds} />
          {changesOpen && selected && (
            <ChangesPanel
              // Another folder is another panel: nothing of the previous one applies.
              key={`${selected.id}:${selected.cwd}`}
              session={selected}
              mode={panelMode}
              onModeChange={setPanelMode}
              onClose={() => setChangesOpen(false)}
              onCount={setChangeCount}
              onUnsavedChange={setUnsaved}
              onOpenFile={(file) => (panelFile.current = file)}
              onSendSelection={(file, selection) => openPrompt(undefined, { file, selection })}
            />
          )}
        </div>
      </main>

      {overlay === 'new' && (
        <NewSessionDialog
          // A folder dropped while the dialog is open starts it over, in that folder.
          key={newFolder ?? ''}
          initialCwd={newFolder}
          initialGroupId={newGroup}
          onClose={closeOverlay}
          onCreated={(session) => {
            closeOverlay();
            startWhenMounted(session.id);
          }}
        />
      )}
      {overlay === 'folder' && selected && (
        <ChangeFolderDialog
          session={selected}
          onClose={closeOverlay}
          onChanged={(restart) => {
            closeOverlay();
            if (restart) terminals.current?.start(selected.id);
          }}
        />
      )}
      {dropping && <div className="drop-hint">{t('app.dropHint')}</div>}
      {overlay === 'prefs' && <PreferencesDialog onClose={closeOverlay} />}
      {overlay === 'group' && <GroupDialog group={editedGroup} onClose={closeOverlay} />}
      {overlay === 'checks' && selected && (
        <ChecksDialog
          key={selected.id}
          session={selected}
          onClose={closeOverlay}
          onSent={() => {
            closeOverlay();
            focusTerminal(true);
          }}
        />
      )}
      {overlay === 'queue' && selected && (
        <QueueDialog key={selected.id} session={selected} onClose={closeOverlay} />
      )}
      {overlay === 'palette' && <CommandPalette commands={commands} onClose={closeOverlay} />}
      {overlay === 'prompt' && promptRequest && (
        <PromptDialog
          promptId={promptRequest.promptId}
          targets={promptRequest.targets}
          context={promptRequest.context}
          onClose={closeOverlay}
          onSent={() => {
            closeOverlay();
            setMarked([]);
            focusTerminal(true);
          }}
        />
      )}
      {closing && <CloseSessionDialog session={closing} onClose={() => setClosing(null)} />}
    </div>
  );
}
