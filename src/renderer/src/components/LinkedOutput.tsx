import { Fragment, useEffect, useMemo, useState, type ReactNode } from 'react';
import { findLocations, findUrls, type LocatedPath } from '@shared/locations';
import { useT } from '../lib/i18n';
import { PathChecker, requestOpenLocation } from '../lib/terminalLinks';

/** Beyond this many lines the output is shown as plain text: the links are for what fits a screen. */
const MAX_LINES = 1500;
const MAX_CANDIDATES = 300;
const BATCH = 60;

interface Props {
  sessionId: string;
  text: string;
  /** A link was used: the caller may want to get out of the way (close its dialog). */
  onOpen?(): void;
}

/**
 * Program output as text, in which paths that exist in the session folder and web addresses
 * are links with Ctrl+click, like in the terminal.
 */
export function LinkedOutput({ sessionId, text, onOpen }: Props) {
  const t = useT();
  const lines = useMemo(() => text.split('\n'), [text]);
  const scanned = lines.length <= MAX_LINES;
  const found = useMemo(
    () =>
      scanned ? lines.map((line) => ({ urls: findUrls(line), places: findLocations(line) })) : [],
    [lines, scanned],
  );
  const [located, setLocated] = useState<ReadonlyMap<string, LocatedPath | null>>(new Map());
  const [ctrl, setCtrl] = useState(false);

  useEffect(() => {
    const track = (event: KeyboardEvent) => setCtrl(event.ctrlKey);
    const off = () => setCtrl(false);
    window.addEventListener('keydown', track);
    window.addEventListener('keyup', track);
    window.addEventListener('blur', off);
    return () => {
      window.removeEventListener('keydown', track);
      window.removeEventListener('keyup', track);
      window.removeEventListener('blur', off);
    };
  }, []);

  useEffect(() => {
    const candidates = [
      ...new Set(found.flatMap((f) => f.places.map((p) => p.path)).filter((p) => p.length <= 1000)),
    ].slice(0, MAX_CANDIDATES);
    if (candidates.length === 0) return;
    let cancelled = false;
    const checker = new PathChecker(sessionId);
    void (async () => {
      const answers = new Map<string, LocatedPath | null>();
      for (let i = 0; i < candidates.length; i += BATCH) {
        const batch = candidates.slice(i, i + BATCH);
        const result = await checker.check(batch).catch(() => batch.map(() => null));
        batch.forEach((path, k) => answers.set(path, result[k] ?? null));
      }
      if (!cancelled) setLocated(answers);
    })();
    return () => {
      cancelled = true;
    };
  }, [found, sessionId]);

  if (!scanned) return <>{text}</>;

  const openPlace = (
    event: { ctrlKey: boolean; preventDefault(): void },
    open: () => void,
  ): void => {
    event.preventDefault();
    if (!event.ctrlKey) return;
    open();
    onOpen?.();
  };

  const renderLine = (line: string, index: number): ReactNode => {
    const { urls, places } = found[index]!;
    const pieces = [
      ...urls.map((u) => ({ start: u.start, end: u.end, url: u.url, place: undefined })),
      ...places
        .filter((p) => located.get(p.path)?.isFile)
        .map((p) => ({ start: p.start, end: p.end, url: undefined, place: p })),
    ].sort((a, b) => a.start - b.start);
    const out: ReactNode[] = [];
    let at = 0;
    for (const piece of pieces) {
      if (piece.start < at) continue;
      out.push(line.slice(at, piece.start));
      const label = line.slice(piece.start, piece.end);
      if (piece.url !== undefined) {
        const url = piece.url;
        out.push(
          <span
            key={piece.start}
            className="output-link"
            role="link"
            title={t('links.ctrlClick')}
            onClick={(event) =>
              openPlace(event, () => void window.api.invoke('shell:openExternal', url))
            }
          >
            {label}
          </span>,
        );
      } else {
        const place = piece.place!;
        const file = located.get(place.path)!;
        out.push(
          <span
            key={piece.start}
            className="output-link"
            role="link"
            data-path={file.path}
            title={t('links.ctrlClick')}
            onClick={(event) =>
              openPlace(event, () =>
                requestOpenLocation({
                  sessionId,
                  path: file.path,
                  line: place.line,
                  column: place.column,
                }),
              )
            }
          >
            {label}
          </span>,
        );
      }
      at = piece.end;
    }
    out.push(line.slice(at));
    return out;
  };

  return (
    <span className={ctrl ? 'output-links ctrl' : 'output-links'}>
      {lines.map((line, index) => (
        <Fragment key={index}>
          {index > 0 && '\n'}
          {renderLine(line, index)}
        </Fragment>
      ))}
    </span>
  );
}
