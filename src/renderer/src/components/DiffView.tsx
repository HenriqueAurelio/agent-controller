import { useEffect, useRef, useState } from 'react';
import type { DiffBase, FileDiff, SideContent } from '@shared/git';
import type { ThemeName } from '@shared/prefs';
import type { FrameMessage, ShowDiffMessage } from '../lib/diffProtocol';
import { errorMessage, formatBytes } from '../lib/format';

interface Props {
  sessionId: string;
  path: string;
  base: DiffBase;
  inline: boolean;
  /** Bumped when the watcher reports a change, to reload the open file. */
  revision: number;
  theme: ThemeName;
  fontSize: number;
}

function unavailable(side: SideContent): string | null {
  if (side.kind === 'binary') return `Arquivo binário (${formatBytes(side.size)})`;
  if (side.kind === 'too-large')
    return `Arquivo grande demais para comparar (${formatBytes(side.size)})`;
  return null;
}

const textOf = (side: SideContent) => (side.kind === 'text' ? side.text : '');

/**
 * The Monaco diff editor, inside an iframe. The iframe only exists while the panel is open:
 * Monaco is loaded on demand and, when the panel closes, its memory is really given back.
 */
export function DiffView({ sessionId, path, base, inline, revision, theme, fontSize }: Props) {
  const frameRef = useRef<HTMLIFrameElement>(null);
  const [diff, setDiff] = useState<FileDiff | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    let cancelled = false;
    window.api
      .invoke('git:diff', sessionId, path, base)
      .then((result) => {
        if (cancelled) return;
        setDiff(result);
        setError(null);
      })
      .catch((err) => !cancelled && setError(errorMessage(err)));
    return () => {
      cancelled = true;
    };
  }, [sessionId, path, base, revision]);

  useEffect(() => {
    const onMessage = (event: MessageEvent<FrameMessage>) => {
      if (event.source !== frameRef.current?.contentWindow) return;
      if (event.data?.type === 'ready') setReady(true);
      if (event.data?.type === 'key') {
        // Replayed here so Esc and the global shortcuts behave the same everywhere.
        const { key, ctrlKey, shiftKey, altKey } = event.data;
        frameRef.current?.dispatchEvent(
          new KeyboardEvent('keydown', { key, ctrlKey, shiftKey, altKey, bubbles: true }),
        );
      }
    };
    window.addEventListener('message', onMessage);
    return () => window.removeEventListener('message', onMessage);
  }, []);

  const blocked = diff ? (unavailable(diff.modified) ?? unavailable(diff.original)) : null;

  useEffect(() => {
    if (!ready || !diff || diff.path !== path || blocked) return;
    const message: ShowDiffMessage = {
      type: 'show',
      path,
      original: textOf(diff.original),
      modified: textOf(diff.modified),
      inline,
      theme,
      fontSize,
    };
    frameRef.current?.contentWindow?.postMessage(message, '*');
  }, [ready, diff, path, blocked, inline, theme, fontSize]);

  return (
    <div className="diff-view">
      {error && <div className="panel-message error">{error}</div>}
      {!error && blocked && <div className="panel-message">{blocked}</div>}
      {!error && !blocked && diff?.original.kind === 'missing' && (
        <div className="diff-note">Arquivo novo</div>
      )}
      {!error && !blocked && diff?.modified.kind === 'missing' && (
        <div className="diff-note">Arquivo removido</div>
      )}
      <iframe
        ref={frameRef}
        src="diff.html"
        title="Comparação do arquivo"
        className="diff-editor"
        data-testid="diff-frame"
        style={{ visibility: error || blocked ? 'hidden' : 'visible' }}
      />
    </div>
  );
}
