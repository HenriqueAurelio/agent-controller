import { useState } from 'react';
import {
  LANGUAGE_NAME,
  LANGUAGES,
  sanitizeLanguage,
  type Message,
  type MessageKey,
} from '@shared/i18n';
import { AGENT_COMMAND_LIMIT } from '@shared/agents';
import { SCROLLBACK_LIMITS, type Preferences } from '@shared/prefs';
import { AGENT_PROFILE_IDS } from '@shared/session';
import { useAppState } from '../lib/store';
import { errorMessage, PROFILE_LABEL } from '../lib/format';
import { useT } from '../lib/i18n';
import { CheckpointsSettings } from './CheckpointsSettings';
import { Dialog } from './Dialog';
import { EditorPreferences } from './EditorPreferences';
import { FavoriteFolders } from './FavoriteFolders';
import { LayoutEditor } from './LayoutEditor';
import { PromptsEditor } from './PromptsEditor';
import { ShortcutsEditor } from './ShortcutsEditor';
import { OverlapsSettings } from './OverlapsSettings';
import { WorktreesSettings } from './WorktreesSettings';

const set = (patch: Partial<Preferences>) => void window.api.invoke('prefs:set', patch);

const TABS = [
  'geral',
  'agentes',
  'prompts',
  'editor',
  'atalhos',
  'layout',
  'sessoes',
  'configuracoes',
] as const;
export type TabId = (typeof TABS)[number];

export function PreferencesDialog({
  onClose,
  initialTab = 'geral',
}: {
  onClose(): void;
  initialTab?: TabId;
}) {
  const t = useT();
  const prefs = useAppState((s) => s.prefs);
  const testMode = useAppState((s) => s.info.testMode);
  const agents = useAppState((s) => s.agents);
  const [tab, setTab] = useState<TabId>(initialTab);
  // Kept as a message, not as its words: an import may bring another language with it.
  const [transfer, setTransfer] = useState<Message | { error: string } | null>(null);

  const moveSettings = async (channel: 'prefs:export' | 'prefs:import') => {
    try {
      const result = await window.api.invoke(channel);
      if (result === null) return;
      setTransfer(
        typeof result === 'string'
          ? { key: 'prefs.exported', params: { file: result } }
          : { key: 'prefs.imported' },
      );
    } catch (err) {
      setTransfer({ error: errorMessage(err) });
    }
  };

  const check = (
    key:
      | 'notifyWaiting'
      | 'notifyDone'
      | 'notifySound'
      | 'permissionButtons'
      | 'showHiddenFiles'
      | 'quickOpenInTerminal',
    label: MessageKey,
  ) => (
    <label className="check">
      <input
        type="checkbox"
        checked={prefs[key]}
        onChange={(e) => set({ [key]: e.target.checked })}
      />
      {t(label)}
    </label>
  );

  return (
    <Dialog title={t('shortcut.preferences')} onClose={onClose} className="prefs">
      <div
        className="tabs"
        role="tablist"
        aria-label={t('prefs.sections')}
        onKeyDown={(e) => {
          if (e.key !== 'ArrowRight' && e.key !== 'ArrowLeft') return;
          e.preventDefault();
          const index = TABS.indexOf(tab);
          const next =
            TABS[(index + (e.key === 'ArrowRight' ? 1 : -1) + TABS.length) % TABS.length]!;
          setTab(next);
          document.getElementById(`prefs-tab-${next}`)?.focus();
        }}
      >
        {TABS.map((id) => (
          <button
            key={id}
            id={`prefs-tab-${id}`}
            role="tab"
            aria-selected={id === tab}
            aria-controls="prefs-panel"
            data-autofocus={id === tab ? true : undefined}
            className={id === tab ? 'tab selected' : 'tab'}
            onClick={() => setTab(id)}
          >
            {t(`prefs.tab.${id}`)}
          </button>
        ))}
      </div>
      <div
        className="form tab-panel"
        id="prefs-panel"
        role="tabpanel"
        aria-labelledby={`prefs-tab-${tab}`}
      >
        {tab === 'editor' && <EditorPreferences />}
        {tab === 'layout' && (
          <LayoutEditor layout={prefs.layout} onChange={(layout) => set({ layout })} />
        )}
        {tab === 'prompts' && <PromptsEditor prefs={prefs} onChange={set} />}
        {tab === 'atalhos' && (
          <ShortcutsEditor
            shortcuts={prefs.shortcuts}
            onChange={(shortcuts) => set({ shortcuts })}
          />
        )}
        {tab === 'geral' && (
          <>
            <fieldset className="field">
              <legend>{t('prefs.language')}</legend>
              <label className="field-inline">
                <span>{t('prefs.languageLabel')}</span>
                <select
                  aria-label={t('prefs.languageLabel')}
                  value={prefs.language}
                  onChange={(e) => set({ language: sanitizeLanguage(e.target.value) })}
                >
                  {LANGUAGES.map((language) => (
                    <option key={language} value={language} lang={language}>
                      {LANGUAGE_NAME[language]}
                    </option>
                  ))}
                </select>
              </label>
            </fieldset>

            <fieldset className="field">
              <legend>{t('prefs.notices')}</legend>
              {check('notifyWaiting', 'prefs.notifyWaiting')}
              {check('notifyDone', 'prefs.notifyDone')}
              {check('notifySound', 'prefs.notifySound')}
              {check('permissionButtons', 'prefs.permissionButtons')}
              <label className="field-inline">
                <span>{t('prefs.silenceBefore')}</span>
                <input
                  type="number"
                  min={0}
                  max={600}
                  value={prefs.silenceSeconds}
                  onChange={(e) => set({ silenceSeconds: Number(e.target.value) })}
                />
                <span>{t('prefs.silenceAfter')}</span>
              </label>
            </fieldset>

            <fieldset className="field">
              <legend>{t('prefs.terminal')}</legend>
              <label className="field-inline">
                <span>{t('prefs.theme')}</span>
                <select
                  value={prefs.theme}
                  onChange={(e) => set({ theme: e.target.value === 'light' ? 'light' : 'dark' })}
                >
                  <option value="dark">{t('prefs.theme.dark')}</option>
                  <option value="light">{t('prefs.theme.light')}</option>
                </select>
              </label>
              <label className="field-inline">
                <span>{t('prefs.font')}</span>
                <input
                  className="wide"
                  defaultValue={prefs.fontFamily}
                  onBlur={(e) => set({ fontFamily: e.target.value })}
                />
              </label>
              <label className="field-inline">
                <span>{t('prefs.fontSize')}</span>
                <input
                  type="number"
                  min={8}
                  max={32}
                  value={prefs.fontSize}
                  onChange={(e) => set({ fontSize: Number(e.target.value) })}
                />
              </label>
              <label className="field-inline">
                <span>{t('prefs.scrollback')}</span>
                <input
                  type="number"
                  min={SCROLLBACK_LIMITS.min}
                  max={SCROLLBACK_LIMITS.max}
                  step={500}
                  defaultValue={prefs.scrollback}
                  onBlur={(e) => set({ scrollback: Number(e.target.value) })}
                />
              </label>
            </fieldset>

            <fieldset className="field">
              <legend>{t('common.files')}</legend>
              {check('showHiddenFiles', 'prefs.showHidden')}
              {check('quickOpenInTerminal', 'prefs.quickOpenInTerminal')}
            </fieldset>
          </>
        )}
        {tab === 'agentes' && (
          <>
            <fieldset className="field">
              <legend>{t('common.sessions')}</legend>
              <label className="field-inline">
                <span>{t('prefs.defaultFolder')}</span>
                <input
                  // Remounted when the folder comes from the native dialog.
                  key={prefs.defaultFolder}
                  className="wide"
                  aria-label={t('prefs.defaultFolder')}
                  placeholder={t('favorites.placeholder')}
                  defaultValue={prefs.defaultFolder}
                  onBlur={(e) => set({ defaultFolder: e.target.value })}
                />
                {!testMode && (
                  <button
                    type="button"
                    onClick={async () => {
                      const folder = await window.api.invoke(
                        'dialog:pickFolder',
                        prefs.defaultFolder || undefined,
                      );
                      if (folder) set({ defaultFolder: folder });
                    }}
                  >
                    {t('common.choose')}
                  </button>
                )}
              </label>
              <FavoriteFolders />
            </fieldset>

            <fieldset className="field">
              <legend>{t('prefs.agents')}</legend>
              <span className="muted">{t('prefs.agentCommandsHint')}</span>
              {AGENT_PROFILE_IDS.map((profile) => {
                const label = t('prefs.agentCommand', { name: PROFILE_LABEL[profile] });
                return (
                  <label key={profile} className="field-inline">
                    <span>{label}</span>
                    <input
                      // Remounted when the command comes from an imported file.
                      key={prefs.agentCommands[profile]}
                      className="wide command"
                      aria-label={label}
                      placeholder={agents.find((a) => a.profile === profile)?.executable}
                      maxLength={AGENT_COMMAND_LIMIT}
                      spellCheck={false}
                      defaultValue={prefs.agentCommands[profile]}
                      onBlur={(e) =>
                        set({
                          agentCommands: { ...prefs.agentCommands, [profile]: e.target.value },
                        })
                      }
                    />
                  </label>
                );
              })}
            </fieldset>
          </>
        )}
        {tab === 'sessoes' && (
          <>
            <WorktreesSettings />
            <OverlapsSettings />
            <CheckpointsSettings />
          </>
        )}
        {tab === 'configuracoes' && (
          <>
            <fieldset className="field">
              <legend>{t('prefs.settings')}</legend>
              <span className="muted">{t('prefs.settingsHint')}</span>
              <div className="field-row settings-transfer">
                <button type="button" onClick={() => void moveSettings('prefs:export')}>
                  {t('prefs.export')}
                </button>
                <button type="button" onClick={() => void moveSettings('prefs:import')}>
                  {t('prefs.import')}
                </button>
              </div>
              {transfer && (
                <p
                  className={'error' in transfer ? 'form-error' : 'form-note done'}
                  role={'error' in transfer ? 'alert' : 'status'}
                >
                  {'error' in transfer ? transfer.error : t(transfer.key, transfer.params)}
                </p>
              )}
            </fieldset>
          </>
        )}
      </div>
      <div className="dialog-actions">
        <button className="primary" onClick={onClose}>
          {t('common.close')}
        </button>
      </div>
    </Dialog>
  );
}
