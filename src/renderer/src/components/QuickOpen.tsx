import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { CHANGE_LETTER, type FileIndexResult } from '@shared/git';
import { errorMessage } from '../lib/format';
import { parseFileQuery, rankFiles, type RankedFile } from '../lib/fuzzy';
import { useT } from '../lib/i18n';
import { recentFiles } from '../lib/recentFiles';
import { Dialog } from './Dialog';

/** More rows than this are of no use to someone who can keep typing. */
const MAX_ROWS = 50;
const MAX_RECENT = 10;

interface Row extends RankedFile {
  /** Why it is listed without a query: opened lately, or changed (with the letter of the panel). */
  tag?: string;
}

/** The text with the letters at `positions` (indexes of the whole path, from `offset`) marked. */
function marked(text: string, offset: number, positions: ReadonlySet<number>): ReactNode {
  const parts: ReactNode[] = [];
  let run = '';
  let on = false;
  const flush = () => {
    if (run) parts.push(on ? <mark key={parts.length}>{run}</mark> : run);
    run = '';
  };
  for (let i = 0; i < text.length; i++) {
    const hit = positions.has(offset + i);
    if (hit !== on) flush();
    on = hit;
    run += text[i];
  }
  flush();
  return parts;
}

export function QuickOpen({
  sessionId,
  showHidden,
  onOpen,
  onClose,
}: {
  sessionId: string;
  showHidden: boolean;
  onOpen(path: string, line?: number, column?: number): void;
  onClose(): void;
}) {
  const t = useT();
  const [query, setQuery] = useState('');
  const [index, setIndex] = useState(0);
  const [listing, setListing] = useState<FileIndexResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const listRef = useRef<HTMLUListElement>(null);

  useEffect(() => {
    let cancelled = false;
    window.api.invoke('files:index', sessionId, showHidden).then(
      (result) => !cancelled && setListing(result),
      (err) => !cancelled && setError(errorMessage(err)),
    );
    return () => {
      cancelled = true;
    };
  }, [sessionId, showHidden]);

  const parsed = useMemo(() => parseFileQuery(query), [query]);
  const rows = useMemo<Row[]>(() => {
    if (!listing) return [];
    if (parsed.name) return rankFiles(listing.files, parsed.name, MAX_ROWS);
    // No query: what was opened last, then what changed.
    const known = new Set(listing.files);
    const result: Row[] = [];
    const seen = new Set<string>();
    for (const path of recentFiles.get(sessionId).slice(0, MAX_RECENT)) {
      if (!known.has(path) || seen.has(path)) continue;
      seen.add(path);
      result.push({ path, score: 0, positions: [], tag: t('quickOpen.recent') });
    }
    for (const change of listing.changed) {
      if (seen.has(change.path) || change.kind === 'removed') continue;
      seen.add(change.path);
      result.push({
        path: change.path,
        score: 0,
        positions: [],
        tag: CHANGE_LETTER[change.kind],
      });
    }
    return result.slice(0, MAX_ROWS);
  }, [listing, parsed.name, sessionId, t]);

  const active = Math.min(index, Math.max(0, rows.length - 1));
  useEffect(() => {
    listRef.current?.children[active]?.scrollIntoView({ block: 'nearest' });
  }, [active]);

  const open = (row: Row | undefined) => {
    if (!row) return;
    recentFiles.add(sessionId, row.path);
    onClose();
    onOpen(row.path, parsed.line, parsed.column);
  };

  const status = error
    ? t('quickOpen.error', { error })
    : !listing
      ? t('quickOpen.loading')
      : listing.files.length === 0
        ? t('quickOpen.noFiles')
        : rows.length === 0 && parsed.name
          ? t('quickOpen.empty')
          : null;

  return (
    <Dialog title={t('quickOpen.title')} onClose={onClose} className="palette quick-open">
      <input
        data-autofocus
        aria-label={t('quickOpen.input')}
        placeholder={t('quickOpen.placeholder')}
        value={query}
        onChange={(e) => {
          setQuery(e.target.value);
          setIndex(0);
        }}
        onKeyDown={(e) => {
          if (e.key === 'ArrowDown') {
            e.preventDefault();
            setIndex(Math.min(rows.length - 1, active + 1));
          } else if (e.key === 'ArrowUp') {
            e.preventDefault();
            setIndex(Math.max(0, active - 1));
          } else if (e.key === 'Enter') {
            e.preventDefault();
            open(rows[active]);
          }
        }}
      />
      {parsed.line && (
        <div className="quick-open-note muted">{t('quickOpen.line', { line: parsed.line })}</div>
      )}
      {listing?.truncated && (
        <div className="quick-open-note muted">
          {t('quickOpen.truncated', { count: listing.files.length })}
        </div>
      )}
      <ul ref={listRef} className="palette-list" role="listbox">
        {rows.map((row, i) => {
          const slash = row.path.lastIndexOf('/') + 1;
          const hits = new Set(row.positions);
          return (
            <li
              key={row.path}
              role="option"
              aria-selected={i === active}
              className={i === active ? 'active' : ''}
              title={row.path}
              onMouseEnter={() => setIndex(i)}
              onClick={() => open(row)}
            >
              <span className="quick-open-path">
                <span className="quick-open-name">
                  {marked(row.path.slice(slash), slash, hits)}
                </span>
                {slash > 0 && (
                  <span className="quick-open-dir muted">
                    {marked(row.path.slice(0, slash - 1), 0, hits)}
                  </span>
                )}
              </span>
              {row.tag && <kbd className="quick-open-tag">{row.tag}</kbd>}
            </li>
          );
        })}
        {status && <li className="muted">{status}</li>}
      </ul>
    </Dialog>
  );
}
