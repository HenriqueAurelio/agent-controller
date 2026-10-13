import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { statusLabel, type SessionView } from '@shared/session';
import {
  bindingFromEvent,
  bindingIndex,
  SESSION_BINDING,
  type ShortcutAction,
} from '@shared/shortcuts';
import { ChangeFolderDialog } from './components/ChangeFolderDialog';
import { ChangesPanel, type PanelMode } from './components/ChangesPanel';
import { CommandPalette, type Command } from './components/CommandPalette';
import { Dialog } from './components/Dialog';
import { NewSessionDialog } from './components/NewSessionDialog';
import { PreferencesDialog } from './components/PreferencesDialog';
import { Sidebar } from './components/Sidebar';
import { TerminalArea, type TerminalAreaHandle } from './components/TerminalArea';
import { PROFILE_LABEL } from './lib/format';
import { shortcutRecording } from './lib/shortcuts';
import { store, useAppState } from './lib/store';

type Overlay = 'new' | 'prefs' | 'palette' | 'folder' | null;

/** A tooltip that names the shortcut, when there is one. */
const hint = (text: string, bindings: string[]) =>
  bindings.length > 0 ? `${text} (${bindings[0]})` : text;

export function App() {
  const sessions = useAppState((s) => s.sessions);
  const selectedId = useAppState((s) => s.selectedId);
  const theme = useAppState((s) => s.prefs.theme);
  const shortcuts = useAppState((s) => s.prefs.shortcuts);
  const layout = useAppState((s) => s.prefs.layout);
  const [overlay, setOverlay] = useState<Overlay>(null);
  /** The folder a new session was asked for, when it came from one dropped on the window. */
  const [newFolder, setNewFolder] = useState<string | undefined>(undefined);
  const [dropping, setDropping] = useState(false);
  const [closing, setClosing] = useState<SessionView | null>(null);
  const [changesOpen, setChangesOpen] = useState(false);
  const [panelMode, setPanelMode] = useState<PanelMode>('changes');
  const [changeCount, setChangeCount] = useState<number | null>(null);
  const terminals = useRef<TerminalAreaHandle>(null);

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
      window.confirm(`Há edições não salvas em ${unsavedRef.current}. Descartar?`),
    [],
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
  const sessionIds = useMemo(() => sessions.map((s) => s.id), [sessions]);

  useEffect(() => {
    document.documentElement.dataset.theme = theme;
  }, [theme]);

  // The taskbar says how many agents are waiting, even with the window out of sight.
  const waiting = sessions.filter((s) => s.status.state === 'aguardando' && s.running).length;
  useEffect(() => {
    document.title = waiting > 0 ? `(${waiting} aguardando) Agent Controller` : 'Agent Controller';
  }, [waiting]);

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
    // A running agent is only closed after confirmation.
    if (session.running) setClosing(session);
    else void window.api.invoke('sessions:remove', session.id);
  }, []);

  /** The agent starts at the size of its terminal, which is mounted on the next frame. */
  const startWhenMounted = useCallback((id: string) => {
    requestAnimationFrame(() => requestAnimationFrame(() => terminals.current?.start(id)));
  }, []);

  const openNew = useCallback((folder?: string) => {
    setNewFolder(folder);
    setOverlay('new');
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
    (action: ShortcutAction) => {
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
        preferences: () => setOverlay('prefs'),
      };
      run[action]();
    },
    [selectByOffset, selectNextWaiting, requestClose, focusTerminal, togglePanel, openNew],
  );

  const commands = useMemo<Command[]>(() => {
    const action = (id: ShortcutAction, title: string, run?: () => void): Command => ({
      id,
      title,
      shortcut: shortcuts[id][0],
      run: run ?? (() => runAction(id)),
    });
    const list: Command[] = [
      action('newSession', 'Nova sessão'),
      action('nextSession', 'Próxima sessão'),
      action('prevSession', 'Sessão anterior'),
      action('nextWaiting', 'Próxima sessão aguardando você'),
      action('focusSidebar', 'Ir para a lista de sessões'),
      action('preferences', 'Preferências'),
    ];
    if (selected) {
      list.unshift(
        action('toggleChanges', 'See changes: ver as mudanças da sessão', () =>
          showPanel('changes'),
        ),
        action('toggleFiles', 'Arquivos: ver todos os arquivos da pasta', () => showPanel('files')),
        action('toggleHidden', 'Arquivos: mostrar ou esconder os ocultos'),
      );
      list.push(
        selected.running
          ? {
              id: 'stop',
              title: `Parar o agente de “${selected.name}”`,
              run: () => void window.api.invoke('sessions:stop', selected.id),
            }
          : {
              id: 'start',
              title: `Iniciar o agente de “${selected.name}”`,
              run: () => terminals.current?.start(selected.id),
            },
        {
          id: 'folder',
          title: `Trocar a pasta de “${selected.name}”`,
          run: changeFolder,
        },
        {
          id: 'duplicate',
          title: `Duplicar a sessão “${selected.name}”: outra na mesma pasta`,
          run: () => duplicate(selected),
        },
        {
          id: 'close',
          title: `Fechar a sessão “${selected.name}”`,
          run: () => requestClose(selected),
        },
      );
    }
    sessions.forEach((s, i) =>
      list.push({
        id: `go-${s.id}`,
        title: `Ir para: ${s.name}`,
        shortcut: i < 9 ? `Ctrl+${i + 1}` : undefined,
        run: () => store.select(s.id),
      }),
    );
    return list;
  }, [sessions, selected, shortcuts, runAction, showPanel, requestClose, changeFolder, duplicate]);

  // Global shortcuts are taken in the capture phase, before the terminal sees the key.
  const bindings = useMemo(() => bindingIndex(shortcuts), [shortcuts]);
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      // The preferences are asking which keys a shortcut should have.
      if (shortcutRecording.active) return;
      const binding = bindingFromEvent(event);
      if (!binding) return;
      const position = SESSION_BINDING.exec(binding)?.[1];
      const action = bindings.get(binding);
      if (position) {
        const target = store.get().sessions[Number(position) - 1];
        if (target) store.select(target.id);
      } else if (action) runAction(action);
      else return;
      event.preventDefault();
      event.stopPropagation();
    };
    window.addEventListener('keydown', onKeyDown, true);
    return () => window.removeEventListener('keydown', onKeyDown, true);
  }, [bindings, runAction]);

  // Whenever nothing is on top of it, the terminal has the keyboard.
  useEffect(() => {
    if (!overlay && !closing && !changesOpen) focusTerminal();
  }, [overlay, closing, changesOpen, selectedId, focusTerminal]);

  const closeOverlay = () => setOverlay(null);

  return (
    <div className="app" data-sessions={layout.sessions}>
      <Sidebar
        onNew={() => openNew()}
        onPreferences={() => setOverlay('prefs')}
        onClose={requestClose}
        onDuplicate={duplicate}
        onDone={() => focusTerminal(true)}
      />
      <main className="main">
        {selected && (
          <header className="session-header">
            <span
              className={`state-dot state-${selected.status.state} ${selected.status.confirmed ? '' : 'inferred'}`}
            />
            <div className="session-header-text">
              <strong>{selected.name}</strong>
              <span className="muted">{PROFILE_LABEL[selected.profile]}</span>
              <span
                data-testid="session-status"
                className={`state-label state-label-${selected.status.state} ${selected.status.confirmed ? '' : 'inferred'}`}
              >
                {statusLabel(selected.status)}
                {selected.status.detail && selected.status.state !== 'terminou'
                  ? ` (${selected.status.detail})`
                  : ''}
              </span>
              <button
                className="muted path"
                title={`${selected.cwd}\nClique para trocar a pasta da sessão`}
                aria-label="Trocar a pasta da sessão"
                onClick={changeFolder}
              >
                {selected.cwd}
              </button>
            </div>
            <span className="spacer" />
            {selected.running ? (
              <button onClick={() => void window.api.invoke('sessions:stop', selected.id)}>
                Parar
              </button>
            ) : (
              <button className="primary" onClick={() => terminals.current?.start(selected.id)}>
                Iniciar
              </button>
            )}
            <button
              className={changesOpen && panelMode === 'changes' ? 'active' : ''}
              onClick={() => togglePanel('changes')}
              title={hint('See changes', shortcuts.toggleChanges)}
            >
              See changes
              {changeCount !== null && changeCount > 0 && (
                <span className="count">{changeCount}</span>
              )}
            </button>
            <button
              className={changesOpen && panelMode === 'files' ? 'active' : ''}
              onClick={() => togglePanel('files')}
              title={hint('Todos os arquivos da pasta', shortcuts.toggleFiles)}
            >
              Arquivos
            </button>
          </header>
        )}
        {selected?.running && selected.hooks === 'inactive' && (
          <div className="banner" role="status">
            O modo preciso do Codex está desligado: os hooks do app ainda não foram confiados. O
            aviso de “aguardando você” continua funcionando pelo título da janela. Para ligar a
            confirmação por hook, abra uma nova sessão do Codex e, na tela{' '}
            <strong>Hooks need review</strong>, escolha confiar nos hooks.
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
            />
          )}
        </div>
      </main>

      {overlay === 'new' && (
        <NewSessionDialog
          // A folder dropped while the dialog is open starts it over, in that folder.
          key={newFolder ?? ''}
          initialCwd={newFolder}
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
      {dropping && <div className="drop-hint">Solte a pasta para abrir uma sessão nela</div>}
      {overlay === 'prefs' && <PreferencesDialog onClose={closeOverlay} />}
      {overlay === 'palette' && <CommandPalette commands={commands} onClose={closeOverlay} />}
      {closing && (
        <Dialog title="Fechar sessão" onClose={() => setClosing(null)}>
          <p>
            O agente de <strong>{closing.name}</strong> está rodando. Fechar a sessão vai
            encerrá-lo, junto com o que ele tiver iniciado.
          </p>
          <div className="dialog-actions">
            <button data-autofocus onClick={() => setClosing(null)}>
              Cancelar
            </button>
            <button
              className="danger"
              onClick={() => {
                void window.api.invoke('sessions:remove', closing.id);
                setClosing(null);
              }}
            >
              Encerrar e fechar
            </button>
          </div>
        </Dialog>
      )}
    </div>
  );
}
