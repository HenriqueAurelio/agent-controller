import { useCallback, useEffect, useRef, useState } from 'react';
import { formatAssociations, parseAssociations } from '@shared/codeLanguages';
import { DEFAULT_CODE_THEME, type CodeThemeInfo } from '@shared/codeThemes';
import type { Message } from '@shared/i18n';
import type { Preferences, ThemeName } from '@shared/prefs';
import {
  codeThemeName,
  refreshCustomThemes,
  themesOfKind,
  useCodeTheme,
  useCustomThemes,
} from '../lib/codeThemes';
import type { FrameMessage, ParentMessage } from '../lib/diffProtocol';
import { errorMessage } from '../lib/format';
import { useT } from '../lib/i18n';
import { useAppState } from '../lib/store';

const set = (patch: Partial<Preferences>) => void window.api.invoke('prefs:set', patch);

// Code, not prose: the same in every language of the app.
const SAMPLE_BEFORE = `import { format } from './format';

/** Adds two numbers and formats the result. */
export function sum(first: number, second = 0): string {
  const total = first + second;
  return format(total, { digits: 2 });
}
`;
const SAMPLE_AFTER = `import { format } from './format';

/** Adds two numbers and formats the result. */
export function sum(first: number, second = 1): string {
  const total = first + second;
  if (total > 100) console.warn(\`large: \${total}\`);
  return format(total, { digits: 2 });
}
`;

/** A small diff in the chosen theme, drawn by the same frame as the changes panel. */
function CodeThemePreview({ kind, themeId }: { kind: ThemeName; themeId: string }) {
  const t = useT();
  const codeTheme = useCodeTheme(kind, themeId);
  const frameRef = useRef<HTMLIFrameElement>(null);
  const [ready, setReady] = useState(false);
  const [src] = useState(() => `diff.html?theme=${kind}`);

  const send = useCallback((message: ParentMessage) => {
    frameRef.current?.contentWindow?.postMessage(message, '*');
  }, []);

  useEffect(() => {
    const onMessage = (event: MessageEvent<FrameMessage>) => {
      if (event.source === frameRef.current?.contentWindow && event.data?.type === 'ready') {
        setReady(true);
      }
    };
    window.addEventListener('message', onMessage);
    return () => window.removeEventListener('message', onMessage);
  }, []);

  useEffect(() => {
    if (!ready || !codeTheme) return;
    send({
      type: 'show',
      path: 'sample.ts',
      original: SAMPLE_BEFORE,
      modified: SAMPLE_AFTER,
      editable: false,
      // One column and small letters: the dialog is narrow, and the colors are what matters.
      inline: true,
      theme: kind,
      codeTheme,
      language: 'typescript',
      associations: {},
      fontSize: 12,
    });
  }, [ready, codeTheme, kind, send]);

  return (
    <iframe
      ref={frameRef}
      src={src}
      title={t('prefs.codeThemePreview')}
      className="code-theme-preview"
      data-testid="code-theme-preview"
      tabIndex={-1}
      style={{ visibility: ready ? 'visible' : 'hidden' }}
    />
  );
}

/** Preferences → Editor: the colors of the code, imported themes, language by file. */
export function EditorPreferences() {
  const t = useT();
  const prefs = useAppState((s) => s.prefs);
  const imported = useCustomThemes();
  const [previewKind, setPreviewKind] = useState<ThemeName>(prefs.theme);
  const [note, setNote] = useState<Message | { error: string } | null>(null);
  const [selectedThemes, setSelectedThemes] = useState<Record<ThemeName, string>>(() => ({
    dark: prefs.codeThemeDark,
    light: prefs.codeThemeLight,
  }));
  const [associations, setAssociations] = useState(() =>
    formatAssociations(prefs.fileAssociations),
  );
  const [applied, setApplied] = useState(() => ({
    themes: { dark: prefs.codeThemeDark, light: prefs.codeThemeLight },
    associations: formatAssociations(prefs.fileAssociations),
  }));
  const [invalid, setInvalid] = useState<string[]>([]);
  const hasChanges =
    selectedThemes.dark !== applied.themes.dark ||
    selectedThemes.light !== applied.themes.light ||
    associations !== applied.associations;

  const themeSelect = (kind: ThemeName) => {
    const label = t(kind === 'dark' ? 'prefs.codeThemeDark' : 'prefs.codeThemeLight');
    return (
      <label className="field-inline">
        <span>{label}</span>
        <select
          aria-label={label}
          value={selectedThemes[kind]}
          onFocus={() => setPreviewKind(kind)}
          onChange={(e) => {
            setPreviewKind(kind);
            setSelectedThemes((current) => ({ ...current, [kind]: e.target.value }));
          }}
        >
          {themesOfKind(kind, imported).map((theme) => (
            <option key={theme.id} value={theme.id}>
              {codeThemeName(t, theme)}
            </option>
          ))}
        </select>
      </label>
    );
  };

  const importTheme = async () => {
    try {
      const theme = await window.api.invoke('themes:import');
      if (!theme) return;
      await refreshCustomThemes();
      setSelectedThemes((current) => ({ ...current, [theme.kind]: theme.id }));
      setPreviewKind(theme.kind);
      setNote({ key: 'prefs.themeImported', params: { name: theme.name } });
    } catch (err) {
      setNote({ error: errorMessage(err) });
    }
  };

  const removeTheme = async (theme: CodeThemeInfo) => {
    try {
      await window.api.invoke('themes:remove', theme.id);
      if (selectedThemes[theme.kind] === theme.id) {
        setSelectedThemes((current) => ({
          ...current,
          [theme.kind]: DEFAULT_CODE_THEME[theme.kind],
        }));
      }
      await refreshCustomThemes();
      setNote(null);
    } catch (err) {
      setNote({ error: errorMessage(err) });
    }
  };

  return (
    <>
      <fieldset className="field">
        <legend>{t('prefs.codeTheme')}</legend>
        <span className="muted">{t('prefs.codeThemeHint')}</span>
        {themeSelect('dark')}
        {themeSelect('light')}
        <CodeThemePreview
          key={`${previewKind}:${selectedThemes[previewKind]}`}
          kind={previewKind}
          themeId={selectedThemes[previewKind]}
        />
      </fieldset>

      <fieldset className="field">
        <legend>{t('prefs.customThemes')}</legend>
        <span className="muted">{t('prefs.customThemesHint')}</span>
        {imported.length === 0 ? (
          <span className="muted">{t('prefs.noCustomThemes')}</span>
        ) : (
          <ul className="custom-themes">
            {imported.map((theme) => (
              <li key={theme.id}>
                <span className="custom-theme-name">{theme.name}</span>
                <span className="muted">
                  {t(theme.kind === 'dark' ? 'prefs.theme.dark' : 'prefs.theme.light')}
                </span>
                <button
                  type="button"
                  aria-label={t('prefs.removeTheme', { name: theme.name })}
                  onClick={() => void removeTheme(theme)}
                >
                  {t('common.remove')}
                </button>
              </li>
            ))}
          </ul>
        )}
        <div className="field-row settings-transfer">
          <button type="button" onClick={() => void importTheme()}>
            {t('prefs.importTheme')}
          </button>
        </div>
        {note && (
          <p
            className={'error' in note ? 'form-error' : 'form-note done'}
            role={'error' in note ? 'alert' : 'status'}
          >
            {'error' in note ? note.error : t(note.key, note.params)}
          </p>
        )}
      </fieldset>

      <fieldset className="field">
        <legend>{t('prefs.associations')}</legend>
        <span className="muted">{t('prefs.associationsHint')}</span>
        <textarea
          className="associations"
          aria-label={t('prefs.associations')}
          spellCheck={false}
          rows={3}
          placeholder="*.mdc = markdown"
          value={associations}
          onChange={(e) => setAssociations(e.target.value)}
          onBlur={() => {
            const parsed = parseAssociations(associations);
            setInvalid(parsed.invalid);
          }}
        />
        {invalid.length > 0 && (
          <p className="form-error" role="alert">
            {t('prefs.associationsInvalid', { lines: invalid.join(' · ') })}
          </p>
        )}
      </fieldset>
      <div className="dialog-actions editor-actions">
        <button
          type="button"
          className="primary"
          disabled={!hasChanges}
          onClick={() => {
            const parsed = parseAssociations(associations);
            setInvalid(parsed.invalid);
            setApplied({ themes: { ...selectedThemes }, associations });
            set({
              codeThemeDark: selectedThemes.dark,
              codeThemeLight: selectedThemes.light,
              fileAssociations: parsed.associations,
            });
          }}
        >
          {t('common.apply')}
        </button>
      </div>
    </>
  );
}
