import { useCallback, useEffect, useRef, useState } from 'react';
import { previewAddress, type PreviewState } from '@shared/preview';
import { errorMessage } from '../lib/format';
import { useT } from '../lib/i18n';
import { Dialog } from './Dialog';

interface Props {
  /** The address it opens with. */
  url: string;
  /** The ports the session listens on, to switch between. */
  ports: number[];
  /** Something of the app is over this place: the page, drawn by the system, must step aside. */
  covered: boolean;
  onClose(): void;
  /** A marked-up screenshot is saved: it goes to the agent through the prompt dialog. */
  onShot(file: string, note: string): void;
  /** The session the screenshot is for. */
  sessionId: string;
}

/** A rectangle drawn on the screenshot, in the image's own pixels. */
interface Mark {
  x: number;
  y: number;
  w: number;
  h: number;
}

/** The screenshot of the page, with rectangles drawn over what is wrong and a note. */
function AnnotateDialog({
  image,
  onCancel,
  onSend,
}: {
  image: string;
  onCancel(): void;
  onSend(png: string, note: string): Promise<void>;
}) {
  const t = useT();
  const canvas = useRef<HTMLCanvasElement>(null);
  const picture = useRef<HTMLImageElement | null>(null);
  const [marks, setMarks] = useState<Mark[]>([]);
  const [drawing, setDrawing] = useState<Mark | null>(null);
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const draw = useCallback(() => {
    const c = canvas.current;
    const img = picture.current;
    if (!c || !img) return;
    const ctx = c.getContext('2d')!;
    ctx.drawImage(img, 0, 0);
    ctx.lineWidth = Math.max(3, img.width / 300);
    ctx.strokeStyle = '#e5534b';
    for (const m of [...marks, ...(drawing ? [drawing] : [])]) ctx.strokeRect(m.x, m.y, m.w, m.h);
  }, [marks, drawing]);

  useEffect(() => {
    const img = new Image();
    img.onload = () => {
      picture.current = img;
      if (canvas.current) {
        canvas.current.width = img.width;
        canvas.current.height = img.height;
      }
      draw();
    };
    img.src = image;
  }, [image, draw]);
  useEffect(draw, [draw]);

  const point = (event: React.MouseEvent<HTMLCanvasElement>) => {
    const box = event.currentTarget.getBoundingClientRect();
    return {
      x: ((event.clientX - box.left) * event.currentTarget.width) / box.width,
      y: ((event.clientY - box.top) * event.currentTarget.height) / box.height,
    };
  };

  return (
    <Dialog title={t('preview.annotate.title')} onClose={onCancel} className="annotate-dialog">
      <div className="form">
        <p className="muted">{t('preview.annotate.hint')}</p>
        <canvas
          ref={canvas}
          className="annotate-canvas"
          data-testid="annotate-canvas"
          onMouseDown={(e) => {
            const p = point(e);
            setDrawing({ x: p.x, y: p.y, w: 0, h: 0 });
          }}
          onMouseMove={(e) => {
            if (!drawing) return;
            const p = point(e);
            setDrawing({ ...drawing, w: p.x - drawing.x, h: p.y - drawing.y });
          }}
          onMouseUp={() => {
            if (drawing && Math.abs(drawing.w) > 3 && Math.abs(drawing.h) > 3) {
              setMarks((list) => [...list, drawing]);
            }
            setDrawing(null);
          }}
        />
        <textarea
          data-testid="annotate-note"
          aria-label={t('preview.annotate.note')}
          placeholder={t('preview.annotate.note')}
          rows={3}
          value={note}
          onChange={(e) => setNote(e.target.value)}
        />
        {error && (
          <p className="form-error" role="alert">
            {error}
          </p>
        )}
        <div className="dialog-actions">
          {marks.length > 0 && (
            <button type="button" onClick={() => setMarks((list) => list.slice(0, -1))}>
              {t('preview.annotate.undo')}
            </button>
          )}
          <span className="spacer" />
          <button type="button" onClick={onCancel}>
            {t('common.cancel')}
          </button>
          <button
            type="button"
            className="primary"
            data-testid="annotate-send"
            disabled={busy}
            onClick={() => {
              setBusy(true);
              setError(null);
              onSend(canvas.current!.toDataURL('image/png'), note.trim()).catch((err) => {
                setError(errorMessage(err));
                setBusy(false);
              });
            }}
          >
            {t('preview.annotate.send')}
          </button>
        </div>
      </div>
    </Dialog>
  );
}

/**
 * A page the session serves, inside the app (ADR 0031). The page itself is drawn by the main
 * process over this place; this component only says where, and steps it aside for dialogs.
 */
export function PreviewPanel({ url, ports, covered, onClose, onShot, sessionId }: Props) {
  const t = useT();
  const area = useRef<HTMLDivElement>(null);
  const [address, setAddress] = useState(url);
  const [current, setCurrent] = useState(url);
  const [state, setState] = useState<PreviewState | null>(null);
  const [shot, setShot] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  // While the person types an address, a page that finishes loading must not write over it.
  const typing = useRef(false);
  const hidden = covered || shot !== null;

  const where = () => {
    const box = area.current!.getBoundingClientRect();
    return { x: box.left, y: box.top, width: box.width, height: box.height };
  };

  // Shown where the area is, out of sight while something covers it.
  useEffect(() => {
    if (hidden) {
      void window.api.invoke('preview:hide');
      return;
    }
    window.api.invoke('preview:open', current, where()).catch((err) => setError(errorMessage(err)));
    const observer = new ResizeObserver(() => void window.api.invoke('preview:bounds', where()));
    observer.observe(area.current!);
    const onResize = () => void window.api.invoke('preview:bounds', where());
    window.addEventListener('resize', onResize);
    return () => {
      observer.disconnect();
      window.removeEventListener('resize', onResize);
    };
  }, [current, hidden]);

  useEffect(() => {
    const off = window.api.on('preview:changed', (next) => {
      setState(next);
      if (next?.url && !typing.current) setAddress(next.url);
    });
    return () => {
      off();
      void window.api.invoke('preview:close');
    };
  }, []);

  const go = (input: string) => {
    typing.current = false;
    const next = previewAddress(input);
    if (!next) {
      setError(t('error.preview.notLocal'));
      return;
    }
    setError(null);
    setCurrent(next);
  };

  return (
    <section
      className="preview-panel"
      data-testid="preview-panel"
      aria-label={t('preview.title')}
      onKeyDown={(e) => {
        if (e.key === 'Escape' && !shot) {
          e.stopPropagation();
          onClose();
        }
      }}
    >
      <header className="preview-toolbar">
        <button
          title={t('preview.back')}
          aria-label={t('preview.back')}
          disabled={!state?.canGoBack}
          onClick={() => void window.api.invoke('preview:back')}
        >
          ←
        </button>
        <button
          title={t('preview.reload')}
          aria-label={t('preview.reload')}
          onClick={() => void window.api.invoke('preview:reload')}
        >
          ↻
        </button>
        <form
          className="preview-address"
          onSubmit={(e) => {
            e.preventDefault();
            go(address);
          }}
        >
          <input
            data-testid="preview-address"
            aria-label={t('preview.address')}
            value={address}
            spellCheck={false}
            onChange={(e) => {
              typing.current = true;
              setAddress(e.target.value);
            }}
          />
        </form>
        {ports.map((port) => (
          <button key={port} className="port-chip" onClick={() => go(String(port))}>
            :{port}
          </button>
        ))}
        <button
          className="primary"
          data-testid="preview-shot"
          title={t('preview.shotHint')}
          onClick={() =>
            void window.api
              .invoke('preview:capture')
              .then(setShot)
              .catch((err) => setError(errorMessage(err)))
          }
        >
          {t('preview.shot')}
        </button>
        <button
          title={t('preview.externalHint')}
          onClick={() => void window.api.invoke('shell:openExternal', state?.url || current)}
        >
          {t('preview.external')}
        </button>
        <button aria-label={t('common.close')} title={t('common.close')} onClick={onClose}>
          ×
        </button>
      </header>
      {(error || state?.error) && (
        <div className="preview-error" role="alert" data-testid="preview-error">
          {error ?? t('preview.loadFailed', { error: state!.error! })}
        </div>
      )}
      <div ref={area} className="preview-area" data-testid="preview-area">
        {state?.loading && <span className="muted">{t('preview.loading')}</span>}
      </div>
      {shot && (
        <AnnotateDialog
          image={shot}
          onCancel={() => setShot(null)}
          onSend={async (png, note) => {
            const file = await window.api.invoke('preview:saveShot', sessionId, png);
            setShot(null);
            onShot(file, note);
          }}
        />
      )}
    </section>
  );
}
