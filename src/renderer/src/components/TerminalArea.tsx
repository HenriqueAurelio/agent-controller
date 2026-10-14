import { useEffect, useImperativeHandle, useRef, type Ref } from 'react';
import type { SessionView } from '@shared/session';
import { useT } from '../lib/i18n';
import { useAppState } from '../lib/store';
import { TerminalPool } from '../lib/terminalPool';

export interface TerminalAreaHandle {
  focus(): void;
  /** Starts the agent of a session at the size of its terminal. */
  start(sessionId: string): void;
}

interface Props {
  session: SessionView | null;
  sessionIds: string[];
  ref: Ref<TerminalAreaHandle>;
}

const DEFAULT_SIZE = { cols: 100, rows: 30 };

/** Hosts the xterm.js instances, which live outside the React render cycle. */
export function TerminalArea({ session, sessionIds, ref }: Props) {
  const t = useT();
  const containerRef = useRef<HTMLDivElement>(null);
  const poolRef = useRef<TerminalPool | null>(null);
  const prefs = useAppState((s) => s.prefs);
  const isWindows = useAppState((s) => s.info.platform === 'win32');
  const sessionId = session?.id ?? null;

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
  }));

  return (
    <div className="terminal-area">
      <div className="terminal-container" ref={containerRef} data-testid="terminals" />
      {!session && (
        <div className="empty-state">
          <h2>{t('terminal.empty.title')}</h2>
          <p>{t('terminal.empty.body')}</p>
        </div>
      )}
    </div>
  );
}
