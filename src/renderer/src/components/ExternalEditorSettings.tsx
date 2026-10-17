import { useEffect, useState } from 'react';
import {
  EDITOR_COMMAND_LIMIT,
  EDITOR_PLACEHOLDERS,
  KNOWN_EDITORS,
  type EditorId,
  type EditorInfo,
} from '@shared/editor';
import { useT } from '../lib/i18n';
import { useAppState } from '../lib/store';

const NAMES = { vscode: 'VS Code', cursor: 'Cursor', zed: 'Zed', windsurf: 'Windsurf' } as const;

/**
 * Preferences → Editor → external editor: the one "Open in editor" starts, with the known
 * editors found on this machine, or a command of the user's own.
 */
export function ExternalEditorSettings() {
  const t = useT();
  const chosen = useAppState((s) => s.prefs.externalEditor);
  const [detected, setDetected] = useState<EditorInfo[] | null>(null);

  useEffect(() => {
    let cancelled = false;
    window.api
      .invoke('editor:detect')
      .then((found) => !cancelled && setDetected(found))
      .catch(() => !cancelled && setDetected([]));
    return () => {
      cancelled = true;
    };
  }, []);

  const set = (patch: Partial<typeof chosen>) =>
    void window.api.invoke('prefs:set', { externalEditor: { ...chosen, ...patch } });
  const found = (id: (typeof KNOWN_EDITORS)[number]) => detected?.find((e) => e.id === id)?.found;

  return (
    <fieldset className="field external-editor" data-testid="external-editor-settings">
      <legend>{t('prefs.externalEditor')}</legend>
      <span className="muted">{t('prefs.externalEditorHint')}</span>
      <label className="field-inline">
        <span>{t('prefs.externalEditorPick')}</span>
        <select
          aria-label={t('prefs.externalEditorPick')}
          value={chosen.editor}
          onChange={(e) => set({ editor: e.target.value as EditorId | '' })}
        >
          <option value="">{t('prefs.externalEditorNone')}</option>
          {KNOWN_EDITORS.map((id) => (
            <option key={id} value={id}>
              {NAMES[id]}
              {found(id) === false ? ` (${t('prefs.externalEditorMissing')})` : ''}
            </option>
          ))}
          <option value="other">{t('prefs.externalEditorOther')}</option>
        </select>
      </label>
      <ul className="external-editor-found" aria-label={t('prefs.externalEditorFound')}>
        {KNOWN_EDITORS.map((id) => (
          <li key={id} data-found={found(id) === true}>
            {NAMES[id]}: {found(id) ? t('prefs.externalEditorInstalled') : '-'}
          </li>
        ))}
      </ul>
      {chosen.editor === 'other' && (
        <label className="field">
          <span>{t('prefs.externalEditorCommand')}</span>
          <input
            // Remounted when the command changes from outside.
            key={chosen.command}
            className="wide command"
            aria-label={t('prefs.externalEditorCommand')}
            placeholder="notepad++ {arquivo} -n{linha}"
            maxLength={EDITOR_COMMAND_LIMIT}
            spellCheck={false}
            defaultValue={chosen.command}
            onBlur={(e) => set({ command: e.target.value })}
          />
          <span className="muted">
            {t('prefs.externalEditorCommandHint', { names: EDITOR_PLACEHOLDERS.join(' ') })}
          </span>
        </label>
      )}
    </fieldset>
  );
}
