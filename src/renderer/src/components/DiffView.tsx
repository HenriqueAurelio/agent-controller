import { useCallback, useEffect, useRef, useState } from 'react';
import { CODE_LANGUAGES, codeLanguage, PLAIN_TEXT } from '@shared/codeLanguages';
import type { DiffBase, FileDiff, SideContent } from '@shared/git';
import type { Translate } from '@shared/i18n';
import type { ThemeName } from '@shared/prefs';
import type { FrameMessage, ParentMessage } from '../lib/diffProtocol';
import { useCodeTheme } from '../lib/codeThemes';
import { errorMessage, formatBytes } from '../lib/format';
import { useT } from '../lib/i18n';
import { useAppState } from '../lib/store';

interface Props {
  sessionId: string;
  path: string;
  base: DiffBase;
  inline: boolean;
  /** Bumped when the watcher reports a change, to reload the open file. */
  revision: number;
  theme: ThemeName;
  fontSize: number;
  /** The folder has no git: there is no "before" to call the file new against. */
  plain?: boolean;
  /** Tells the panel whether the open file has edits that were not saved. */
  onDirtyChange(dirty: boolean): void;
}

function unavailable(t: Translate, side: SideContent): string | null {
  if (side.kind === 'binary') return t('diff.binary', { size: formatBytes(side.size) });
  if (side.kind === 'too-large') return t('diff.tooLarge', { size: formatBytes(side.size) });
  return null;
}

const textOf = (side: SideContent) => (side.kind === 'text' ? side.text : '');

const LANGUAGES_BY_NAME = [...CODE_LANGUAGES].sort((a, b) => a.name.localeCompare(b.name));

/** Which grammar colors the file: the one its name points to, or one the user picks. */
function LanguagePicker({
  detected,
  value,
  onChange,
}: {
  detected: string | null;
  value: string;
  onChange(language: string): void;
}) {
  const t = useT();
  const name = (id: string | null) =>
    !id || id === PLAIN_TEXT ? t('diff.plainText') : (codeLanguage(id)?.name ?? id);
  return (
    <select
      className="diff-language"
      aria-label={t('diff.language')}
      title={t('diff.language')}
      value={value}
      onChange={(e) => onChange(e.target.value)}
    >
      <option value="">{t('diff.languageAuto', { name: name(detected) })}</option>
      <option value={PLAIN_TEXT}>{t('diff.plainText')}</option>
      {LANGUAGES_BY_NAME.map((language) => (
        <option key={language.id} value={language.id}>
          {language.name}
        </option>
      ))}
    </select>
  );
}

/**
 * The Monaco diff editor, inside an iframe. The iframe only exists while the panel is open:
 * Monaco is loaded on demand and, when the panel closes, its memory is really given back.
 *
 * The right side is the file in the working tree and can be edited and saved.
 */
export function DiffView({
  sessionId,
  path,
  base,
  inline,
  revision,
  theme,
  fontSize,
  plain,
  onDirtyChange,
}: Props) {
  const t = useT();
  const shortcuts = useAppState((s) => s.prefs.shortcuts);
  const associations = useAppState((s) => s.prefs.fileAssociations);
  const codeTheme = useCodeTheme(theme);
  // The language the user picked per file, while the panel is open; the file name decides the rest.
  const [languages, setLanguages] = useState<Record<string, string>>({});
  const [highlight, setHighlight] = useState<Extract<FrameMessage, { type: 'language' }> | null>(
    null,
  );
  const frameRef = useRef<HTMLIFrameElement>(null);
  const [diff, setDiff] = useState<FileDiff | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [ready, setReady] = useState(false);
  const [dirty, setDirty] = useState(false);
  const [conflict, setConflict] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [reloads, setReloads] = useState(0);
  const discardNext = useRef(false);
  // The theme the frame opens in; a change of theme later reaches it with the file.
  const [frameSrc] = useState(() => `diff.html?theme=${theme}`);

  const send = useCallback((message: ParentMessage) => {
    frameRef.current?.contentWindow?.postMessage(message, '*');
  }, []);

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
  }, [sessionId, path, base, revision, reloads]);

  // Another file: whatever was pending about the previous one is gone.
  useEffect(() => {
    send({ type: 'loading' });
    setDirty(false);
    setConflict(false);
    setSaveError(null);
  }, [sessionId, path, base, send]);

  useEffect(() => onDirtyChange(dirty), [dirty, onDirtyChange]);

  const save = useCallback(
    async (file: string, content: string, expected: string | null) => {
      try {
        const { saved } = await window.api.invoke('git:save', sessionId, file, content, expected);
        setSaveError(null);
        setConflict(!saved);
        if (saved) send({ type: 'saved', path: file, content });
      } catch (err) {
        setSaveError(errorMessage(err));
      }
    },
    [sessionId, send],
  );

  useEffect(() => {
    const onMessage = (event: MessageEvent<FrameMessage>) => {
      if (event.source !== frameRef.current?.contentWindow) return;
      const message = event.data;
      if (message?.type === 'ready') setReady(true);
      else if (message?.type === 'dirty') setDirty(message.dirty);
      else if (message?.type === 'save') void save(message.path, message.content, message.expected);
      else if (message?.type === 'language') setHighlight(message);
      else if (message?.type === 'key') {
        // Replayed here so Esc and the global shortcuts behave the same everywhere.
        const { key, ctrlKey, shiftKey, altKey, metaKey } = message;
        frameRef.current?.dispatchEvent(
          new KeyboardEvent('keydown', { key, ctrlKey, shiftKey, altKey, metaKey, bubbles: true }),
        );
      }
    };
    window.addEventListener('message', onMessage);
    return () => window.removeEventListener('message', onMessage);
  }, [save]);

  useEffect(() => {
    if (ready) send({ type: 'shortcuts', bindings: Object.values(shortcuts).flat() });
  }, [ready, shortcuts, send]);

  const blocked = diff ? (unavailable(t, diff.modified) ?? unavailable(t, diff.original)) : null;
  const removed = diff?.modified.kind === 'missing';

  useEffect(() => {
    if (!ready || !diff || diff.path !== path || blocked || !codeTheme) return;
    send({
      type: 'show',
      path,
      original: textOf(diff.original),
      modified: textOf(diff.modified),
      editable: diff.modified.kind === 'text',
      inline,
      theme,
      codeTheme,
      language: languages[path] ?? null,
      associations,
      fontSize,
      discardEdits: discardNext.current,
    });
    discardNext.current = false;
  }, [
    ready,
    diff,
    path,
    blocked,
    inline,
    theme,
    codeTheme,
    languages,
    associations,
    fontSize,
    send,
  ]);

  const discard = () => {
    discardNext.current = true;
    setConflict(false);
    setSaveError(null);
    setReloads((n) => n + 1);
  };

  return (
    <div className="diff-view">
      {!error && !blocked && diff && (
        <div className="diff-toolbar">
          <span className="diff-path" title={path}>
            {path}
          </span>
          {diff.original.kind === 'missing' && !plain && (
            <span className="diff-note">{t('diff.new')}</span>
          )}
          {removed && <span className="diff-note">{t('diff.removed')}</span>}
          {dirty && <span className="diff-note unsaved">{t('diff.unsaved')}</span>}
          <span className="spacer" />
          <LanguagePicker
            detected={highlight?.path === path ? highlight.detected : null}
            value={languages[path] ?? ''}
            onChange={(language) =>
              setLanguages((current) => {
                const next = { ...current };
                if (language) next[path] = language;
                else delete next[path];
                return next;
              })
            }
          />
          {dirty && (
            <button onClick={discard} title={t('diff.discardHint')}>
              {t('diff.discard')}
            </button>
          )}
          {!removed && (
            <button
              className="primary"
              disabled={!dirty}
              onClick={() => send({ type: 'request-save', overwrite: false })}
              title={t('diff.saveHint')}
            >
              {t('diff.save')}
            </button>
          )}
        </div>
      )}
      {conflict && (
        <div className="diff-conflict" role="alert">
          <span>{t('diff.conflict')}</span>
          <button onClick={discard}>{t('diff.reload')}</button>
          <button
            className="danger"
            onClick={() => send({ type: 'request-save', overwrite: true })}
          >
            {t('diff.overwrite')}
          </button>
        </div>
      )}
      {saveError && (
        <div className="diff-conflict" role="alert">
          {t('diff.saveError', { error: saveError })}
        </div>
      )}
      {error && <div className="panel-message error">{error}</div>}
      {!error && blocked && <div className="panel-message">{blocked}</div>}
      <iframe
        ref={frameRef}
        src={frameSrc}
        title={t('diff.frameTitle')}
        className="diff-editor"
        data-testid="diff-frame"
        style={{ visibility: error || blocked || !ready ? 'hidden' : 'visible' }}
      />
    </div>
  );
}
