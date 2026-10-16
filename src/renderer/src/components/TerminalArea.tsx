import {
  useEffect,
  useImperativeHandle,
  useRef,
  useState,
  type PointerEvent as ReactPointerEvent,
  type Ref,
} from 'react';
import { AUX_SCROLLBACK, auxTerminalId, type SessionView } from '@shared/session';
import { useT } from '../lib/i18n';
import { useAppState } from '../lib/store';
import { TerminalHost } from '../lib/terminalHost';
import { TerminalPool } from '../lib/terminalPool';

export interface TerminalAreaHandle {
  focus(): void;
  /** Starts the agent of a session at the size of its terminal. */
  start(sessionId: string): void;
  /**
   * Opens the shell beside the agent, or closes it. From the shortcut (`fromKey`), an open shell
   * that does not have the keyboard gets it instead: one key for the three, as in VS Code.
   */
  toggleAux(fromKey?: boolean): void;
  /** Gives the shell beside the agent more room (positive) or less (negative), in steps. */
  resizeAux(steps: number): void;
}

interface Props {
  session: SessionView | null;
  sessionIds: string[];
  ref: Ref<TerminalAreaHandle>;
}

const DEFAULT_SIZE = { cols: 100, rows: 30 };
/** Share of the area the agent's terminal keeps when the shell opens, in percent. */
const DEFAULT_SPLIT = 62;
const SPLIT_LIMITS = { min: 20, max: 85 };
/** How far one arrow key moves the edge between the two terminals, in percent. */
const SPLIT_STEP = 5;

/** Hosts the xterm.js instances, which live outside the React render cycle. */
export function TerminalArea({ session, sessionIds, ref }: Props) {
  const t = useT();
  const areaRef = useRef<HTMLDivElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const poolRef = useRef<TerminalPool | null>(null);
  const auxRef = useRef<TerminalHost | null>(null);
  const prefs = useAppState((s) => s.prefs);
  const isWindows = useAppState((s) => s.info.platform === 'win32');
  const sessionId = session?.id ?? null;
  const auxOpen = session?.auxOpen === true;
  const auxPlace = prefs.layout.aux;
  const [split, setSplit] = useState(DEFAULT_SPLIT);
  /** The shell was opened from here: it takes the keyboard once it is mounted. */
  const focusAuxRef = useRef(false);

  useEffect(() => {
    const pool = new TerminalPool(containerRef.current!, prefs, isWindows);
    poolRef.current = pool;
    return () => {
      pool.dispose();
      poolRef.current = null;
    };
    // The pool is created once; preferences are applied by the effect below.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isWindows]);

  useEffect(() => poolRef.current?.applyPreferences(prefs), [prefs]);

  useEffect(() => {
    const host = poolRef.current?.show(sessionId);
    // Switching session hands the keyboard to its terminal.
    host?.focus();
  }, [sessionId]);

  useEffect(() => poolRef.current?.retain(new Set(sessionIds)), [sessionIds]);

  useImperativeHandle(ref, () => ({
    focus: () => (sessionId ? poolRef.current?.get(sessionId)?.focus() : undefined),
    start: (id) => {
      const size = poolRef.current?.get(id)?.size ?? DEFAULT_SIZE;
      void window.api.invoke('sessions:start', id, size);
      poolRef.current?.get(id)?.focus();
    },
    resizeAux: (steps) =>
      setSplit((v) =>
        Math.min(SPLIT_LIMITS.max, Math.max(SPLIT_LIMITS.min, v - steps * SPLIT_STEP)),
      ),
    toggleAux: (fromKey = false) => {
      if (!session) return;
      // The button and the palette open and close; the key goes to the shell first.
      if (fromKey && session.auxOpen && !document.activeElement?.closest('.aux-pane')) {
        auxRef.current?.focus();
        return;
      }
      if (session.auxOpen) {
        void window.api.invoke('aux:close', session.id);
        poolRef.current?.get(session.id)?.focus();
        return;
      }
      // A first guess at its size; the terminal fits itself once mounted.
      const agent = poolRef.current?.get(session.id)?.size ?? DEFAULT_SIZE;
      const rows =
        auxPlace === 'bottom' ? Math.round((agent.rows * (100 - split)) / split) : agent.rows;
      const cols =
        auxPlace === 'right' ? Math.round((agent.cols * (100 - split)) / split) : agent.cols;
      focusAuxRef.current = true;
      void window.api.invoke('aux:open', session.id, {
        cols: Math.max(20, cols),
        rows: Math.max(5, rows),
      });
    },
  }));

  // The shell of the session in sight, while it is open. Only one is ever mounted: the history
  // in the main process brings it back when its session is shown again.
  const auxMountRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!sessionId || !auxOpen || !auxMountRef.current) return;
    const host = new TerminalHost(
      auxTerminalId(sessionId),
      { ...prefs, scrollback: Math.min(prefs.scrollback, AUX_SCROLLBACK) },
      isWindows,
    );
    auxRef.current = host;
    host.setVisible(true);
    void host
      .mount(auxMountRef.current)
      .then(() => {
        if (focusAuxRef.current && auxRef.current === host) host.focus();
      })
      // Closed before it was mounted: nothing left to show.
      .catch(() => {})
      .finally(() => (focusAuxRef.current = false));
    return () => {
      host.dispose();
      if (auxRef.current === host) auxRef.current = null;
    };
    // Preferences are applied by the effect below, without a new terminal.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sessionId, auxOpen, isWindows]);
  useEffect(
    () =>
      auxRef.current?.applyPreferences({
        ...prefs,
        scrollback: Math.min(prefs.scrollback, AUX_SCROLLBACK),
      }),
    [prefs],
  );

  const startDrag = (event: ReactPointerEvent<HTMLDivElement>) => {
    const area = areaRef.current;
    if (!area) return;
    event.preventDefault();
    const divider = event.currentTarget;
    divider.setPointerCapture(event.pointerId);
    const rect = area.getBoundingClientRect();
    const move = (e: PointerEvent) => {
      const ratio =
        auxPlace === 'bottom'
          ? ((e.clientY - rect.top) / rect.height) * 100
          : ((e.clientX - rect.left) / rect.width) * 100;
      setSplit(Math.min(SPLIT_LIMITS.max, Math.max(SPLIT_LIMITS.min, ratio)));
    };
    const up = () => {
      divider.removeEventListener('pointermove', move);
      divider.removeEventListener('pointerup', up);
      divider.removeEventListener('pointercancel', up);
    };
    divider.addEventListener('pointermove', move);
    divider.addEventListener('pointerup', up);
    divider.addEventListener('pointercancel', up);
  };

  const auxShown = auxOpen && session !== null;
  const agentStyle =
    auxPlace === 'bottom' ? { bottom: `${100 - split}%` } : { right: `${100 - split}%` };
  const auxStyle = auxPlace === 'bottom' ? { top: `${split}%` } : { left: `${split}%` };

  return (
    <div ref={areaRef} className="terminal-area" data-aux={auxShown ? auxPlace : undefined}>
      <div
        className="terminal-container"
        ref={containerRef}
        data-testid="terminals"
        style={auxShown ? agentStyle : undefined}
      />
      {session && auxShown && (
        <>
          <div
            className="aux-divider"
            role="separator"
            aria-orientation={auxPlace === 'bottom' ? 'horizontal' : 'vertical'}
            aria-label={t('aux.divider')}
            aria-valuenow={Math.round(split)}
            aria-valuemin={SPLIT_LIMITS.min}
            aria-valuemax={SPLIT_LIMITS.max}
            tabIndex={0}
            style={auxStyle}
            onPointerDown={startDrag}
            onKeyDown={(e) => {
              // The arrows move the edge between the two terminals, as dragging it does.
              const keys =
                auxPlace === 'bottom' ? ['ArrowUp', 'ArrowDown'] : ['ArrowLeft', 'ArrowRight'];
              const step = keys.indexOf(e.key);
              if (step < 0) return;
              e.preventDefault();
              e.stopPropagation();
              const delta = (step === 0 ? -1 : 1) * SPLIT_STEP;
              setSplit((v) => Math.min(SPLIT_LIMITS.max, Math.max(SPLIT_LIMITS.min, v + delta)));
            }}
          />
          <section className="aux-pane" style={auxStyle} aria-label={t('aux.title')}>
            <header className="aux-header">
              <strong>{t('aux.title')}</strong>
              <span className="muted path" title={session.cwd}>
                {session.cwd}
              </span>
              <span className="spacer" />
              <button
                onClick={() => {
                  void window.api.invoke('aux:close', session.id);
                  poolRef.current?.get(session.id)?.focus();
                }}
                title={t('aux.closeHint')}
                aria-label={t('aux.close')}
              >
                ×
              </button>
            </header>
            <div className="aux-terminal" ref={auxMountRef} data-testid="aux-terminal" />
          </section>
        </>
      )}
      {!session && (
        <div className="empty-state">
          <h2>{t('terminal.empty.title')}</h2>
          <p>{t('terminal.empty.body')}</p>
        </div>
      )}
    </div>
  );
}
