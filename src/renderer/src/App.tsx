import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { statusLabel, type SessionView } from '@shared/session';
import { ChangesPanel } from './components/ChangesPanel';
import { CommandPalette, type Command } from './components/CommandPalette';
import { Dialog } from './components/Dialog';
import { NewSessionDialog } from './components/NewSessionDialog';
import { PreferencesDialog } from './components/PreferencesDialog';
import { Sidebar } from './components/Sidebar';
import { TerminalArea, type TerminalAreaHandle } from './components/TerminalArea';
import { PROFILE_LABEL } from './lib/format';
import { store, useAppState } from './lib/store';

type Overlay = 'new' | 'prefs' | 'palette' | null;

export function App() {
  const sessions = useAppState((s) => s.sessions);
  const selectedId = useAppState((s) => s.selectedId);
  const theme = useAppState((s) => s.prefs.theme);
  const [overlay, setOverlay] = useState<Overlay>(null);
  const [closing, setClosing] = useState<SessionView | null>(null);
  const [changesOpen, setChangesOpen] = useState(false);
  const [changeCount, setChangeCount] = useState<number | null>(null);
  const terminals = useRef<TerminalAreaHandle>(null);

  // Unsaved edits in the changes panel: anything that would close the panel asks first.
  const unsavedRef = useRef<string | null>(null);
  const changesOpenRef = useRef(false);
  changesOpenRef.current = changesOpen;
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
  const toggleChanges = useCallback(() => {
    if (!store.get().selectedId) return;
    if (changesOpenRef.current && !mayDiscardEdits()) return;
    setChangesOpen(!changesOpenRef.current);
  }, [mayDiscardEdits]);
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
  coveredRef.current = Boolean(overlay || closing || changesOpen);

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

  const commands = useMemo<Command[]>(() => {
    const list: Command[] = [
      { id: 'new', title: 'Nova sessão', shortcut: 'Ctrl+Shift+N', run: () => setOverlay('new') },
      { id: 'next', title: 'Próxima sessão', shortcut: 'Ctrl+Tab', run: () => selectByOffset(1) },
      {
        id: 'prev',
        title: 'Sessão anterior',
        shortcut: 'Ctrl+Shift+Tab',
        run: () => selectByOffset(-1),
      },
      { id: 'prefs', title: 'Preferências', shortcut: 'Ctrl+,', run: () => setOverlay('prefs') },
    ];
    if (selected) {
      list.unshift({
        id: 'changes',
        title: 'See changes: ver as mudanças da sessão',
        shortcut: 'Ctrl+Shift+G',
        run: () => setChangesOpen(true),
      });
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
  }, [sessions, selected, selectByOffset, requestClose]);

  // Global shortcuts are taken in the capture phase, before the terminal sees the key.
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (!event.ctrlKey || event.altKey || event.metaKey) return;
      const key = event.key.toLowerCase();
      let handled = true;
      if (key === 'tab') selectByOffset(event.shiftKey ? -1 : 1);
      else if (key === 'pagedown' && !event.shiftKey) selectByOffset(1);
      else if (key === 'pageup' && !event.shiftKey) selectByOffset(-1);
      else if (event.shiftKey && key === 'n') setOverlay('new');
      else if (event.shiftKey && key === 'p')
        setOverlay((o) => (o === 'palette' ? null : 'palette'));
      else if (event.shiftKey && key === 'g') toggleChanges();
      else if (!event.shiftKey && key === ',') setOverlay('prefs');
      else if (!event.shiftKey && /^[1-9]$/.test(event.key)) {
        const target = store.get().sessions[Number(event.key) - 1];
        if (target) store.select(target.id);
      } else handled = false;
      if (handled) {
        event.preventDefault();
        event.stopPropagation();
      }
    };
    window.addEventListener('keydown', onKeyDown, true);
    return () => window.removeEventListener('keydown', onKeyDown, true);
  }, [selectByOffset, toggleChanges]);

  // Whenever nothing is on top of it, the terminal has the keyboard.
  useEffect(() => {
    if (!overlay && !closing && !changesOpen) focusTerminal();
  }, [overlay, closing, changesOpen, selectedId, focusTerminal]);

  const closeOverlay = () => setOverlay(null);

  return (
    <div className="app">
      <Sidebar
        onNew={() => setOverlay('new')}
        onPreferences={() => setOverlay('prefs')}
        onClose={requestClose}
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
              <span className="muted path" title={selected.cwd}>
                {selected.cwd}
              </span>
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
              className={changesOpen ? 'active' : ''}
              onClick={toggleChanges}
              title="See changes (Ctrl+Shift+G)"
            >
              See changes
              {changeCount !== null && changeCount > 0 && (
                <span className="count">{changeCount}</span>
              )}
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
        <div className="content">
          <TerminalArea ref={terminals} session={selected} sessionIds={sessionIds} />
          {changesOpen && selected && (
            <ChangesPanel
              key={selected.id}
              session={selected}
              onClose={() => setChangesOpen(false)}
              onCount={setChangeCount}
              onUnsavedChange={setUnsaved}
            />
          )}
        </div>
      </main>

      {overlay === 'new' && (
        <NewSessionDialog
          onClose={closeOverlay}
          onCreated={(session) => {
            closeOverlay();
            // The terminal is mounted on the next frame; the agent starts at its size.
            requestAnimationFrame(() =>
              requestAnimationFrame(() => terminals.current?.start(session.id)),
            );
          }}
        />
      )}
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
