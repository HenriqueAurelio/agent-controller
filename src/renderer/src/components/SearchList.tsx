import { useMemo, useRef, useState } from 'react';
import {
  SEARCH_RESULTS_LIMIT,
  type SearchMatch,
  type SearchQuery,
  type SearchResult,
} from '@shared/search';
import { errorMessage } from '../lib/format';
import { useT } from '../lib/i18n';

interface Props {
  sessionId: string;
  /** The match whose file is open in the editor. */
  current: SearchMatch | null;
  onOpen(match: SearchMatch): void;
  onSend(text: string, matches: SearchMatch[]): void;
}

const split = (value: string) =>
  value
    .split(',')
    .map((p) => p.trim())
    .filter(Boolean);

/** Search in the folder of the session: the results by file, opened on their line. */
export function SearchList({ sessionId, current, onOpen, onSend }: Props) {
  const t = useT();
  const [text, setText] = useState('');
  const [caseSensitive, setCaseSensitive] = useState(false);
  const [wholeWord, setWholeWord] = useState(false);
  const [regex, setRegex] = useState(false);
  const [include, setInclude] = useState('');
  const [exclude, setExclude] = useState('');
  const [changedOnly, setChangedOnly] = useState(false);
  const [result, setResult] = useState<SearchResult | null>(null);
  const [searched, setSearched] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const run = useRef(0);

  const search = async () => {
    if (!text.trim()) return;
    const mine = ++run.current;
    setBusy(true);
    setError(null);
    const query: SearchQuery = {
      text,
      caseSensitive,
      wholeWord,
      regex,
      include: split(include),
      exclude: split(exclude),
      changedOnly,
    };
    try {
      const found = await window.api.invoke('search:run', sessionId, query);
      if (mine !== run.current) return;
      setResult(found);
      setSearched(text);
    } catch (err) {
      if (mine === run.current) setError(errorMessage(err));
    } finally {
      if (mine === run.current) setBusy(false);
    }
  };

  const groups = useMemo(() => {
    const byFile = new Map<string, SearchMatch[]>();
    for (const match of result?.matches ?? []) {
      const list = byFile.get(match.file) ?? [];
      list.push(match);
      byFile.set(match.file, list);
    }
    return [...byFile.entries()];
  }, [result]);

  const toggle = (label: string, mark: string, on: boolean, set: (v: boolean) => void) => (
    <button
      type="button"
      className={`search-toggle ${on ? 'active' : ''}`}
      aria-pressed={on}
      title={label}
      aria-label={label}
      onClick={() => set(!on)}
    >
      {mark}
    </button>
  );

  return (
    <div className="changes-list problems-list search-list" data-testid="search-list">
      <form
        className="search-form"
        onSubmit={(e) => {
          e.preventDefault();
          void search();
        }}
      >
        <div className="search-row">
          <input
            data-testid="search-text"
            autoFocus
            aria-label={t('search.placeholder')}
            placeholder={t('search.placeholder')}
            value={text}
            spellCheck={false}
            onChange={(e) => setText(e.target.value)}
          />
          {toggle(t('search.case'), 'Aa', caseSensitive, setCaseSensitive)}
          {toggle(t('search.word'), 'ab', wholeWord, setWholeWord)}
          {toggle(t('search.regex'), '.*', regex, setRegex)}
        </div>
        <input
          aria-label={t('search.include')}
          placeholder={t('search.include')}
          value={include}
          spellCheck={false}
          onChange={(e) => setInclude(e.target.value)}
        />
        <input
          aria-label={t('search.exclude')}
          placeholder={t('search.exclude')}
          value={exclude}
          spellCheck={false}
          onChange={(e) => setExclude(e.target.value)}
        />
        <label className="check">
          <input
            type="checkbox"
            checked={changedOnly}
            onChange={(e) => setChangedOnly(e.target.checked)}
          />
          {t('search.changedOnly')}
        </label>
        {/* Enter in any field searches. */}
        <button type="submit" hidden />
      </form>

      <div className="problems-toolbar">
        <span className="muted" data-testid="search-count">
          {busy
            ? t('search.searching')
            : result
              ? result.matches.length === 0
                ? t('search.none')
                : t('search.count', { count: result.matches.length, files: groups.length })
              : ''}
        </span>
        <span className="spacer" />
        {result && result.matches.length > 0 && (
          <button
            data-testid="search-send"
            title={t('search.sendHint')}
            onClick={() => onSend(searched, result.matches)}
          >
            {t('search.send')}
          </button>
        )}
      </div>
      {error && (
        <p className="problems-note form-error" role="alert">
          {error}
        </p>
      )}
      {result?.truncated && (
        <p className="problems-note muted">
          {t('search.truncated', { count: SEARCH_RESULTS_LIMIT })}
        </p>
      )}

      <div className="problems-groups">
        {groups.map(([file, matches]) => (
          <section key={file} className="problems-file" data-testid="search-file">
            <h3 title={file}>
              <span className="problems-file-name">{file}</span>
              <span className="count">{matches.length}</span>
            </h3>
            <ul>
              {matches.map((match) => (
                <li
                  key={`${match.line}:${match.column}`}
                  className={`problem-row ${current === match ? 'current' : ''}`}
                  data-testid="search-row"
                >
                  <button className="problem-open" onClick={() => onOpen(match)}>
                    <span className="problem-message search-line">{match.text.trim()}</span>
                    <span className="problem-where">{match.line}</span>
                  </button>
                </li>
              ))}
            </ul>
          </section>
        ))}
      </div>
    </div>
  );
}
