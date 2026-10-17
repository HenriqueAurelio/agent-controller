import { useState } from 'react';
import { DEFAULT_OVERLAP_IGNORED, type OverlapSettings } from '@shared/overlaps';
import { useT } from '../lib/i18n';
import { useAppState } from '../lib/store';

/**
 * Preferences → Sessions: the warning of sessions in other copies of the same repository that
 * change the same files, whether stopped sessions count, and the files it leaves out.
 */
export function OverlapsSettings() {
  const t = useT();
  const settings = useAppState((s) => s.prefs.overlaps);
  const saved = settings.ignored.join('\n');
  // The list is edited as text and saved when the field is left: blank lines while typing stay.
  const [draft, setDraft] = useState<string | null>(null);

  const set = (patch: Partial<OverlapSettings>) =>
    void window.api.invoke('prefs:set', { overlaps: { ...settings, ...patch } });
  const saveDraft = () => {
    if (draft === null) return;
    set({ ignored: draft.split(/\r?\n/) });
    setDraft(null);
  };

  return (
    <fieldset className="field overlaps-settings">
      <legend>{t('overlaps.title')}</legend>
      <p className="muted">{t('overlaps.intro')}</p>
      <label className="check">
        <input
          type="checkbox"
          checked={settings.enabled}
          onChange={(e) => set({ enabled: e.target.checked })}
        />
        {t('overlaps.enabled')}
      </label>
      <label className="check">
        <input
          type="checkbox"
          checked={settings.includeStopped}
          disabled={!settings.enabled}
          onChange={(e) => set({ includeStopped: e.target.checked })}
        />
        {t('overlaps.includeStopped')}
      </label>
      <label className="field">
        <span>{t('overlaps.ignored')}</span>
        <textarea
          aria-label={t('overlaps.ignored')}
          value={draft ?? saved}
          disabled={!settings.enabled}
          spellCheck={false}
          onChange={(e) => setDraft(e.target.value)}
          onBlur={saveDraft}
        />
        <span className="muted">{t('overlaps.ignoredHint')}</span>
      </label>
      <div>
        <button
          type="button"
          disabled={!settings.enabled || saved === DEFAULT_OVERLAP_IGNORED.join('\n')}
          onClick={() => {
            setDraft(null);
            set({ ignored: [...DEFAULT_OVERLAP_IGNORED] });
          }}
        >
          {t('overlaps.restore')}
        </button>
      </div>
    </fieldset>
  );
}
