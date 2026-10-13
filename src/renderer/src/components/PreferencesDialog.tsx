import { useState } from 'react';
import { SCROLLBACK_LIMITS, type Preferences } from '@shared/prefs';
import { useAppState } from '../lib/store';
import { errorMessage } from '../lib/format';
import { Dialog } from './Dialog';
import { FavoriteFolders } from './FavoriteFolders';
import { LayoutEditor } from './LayoutEditor';
import { ShortcutsEditor } from './ShortcutsEditor';

const set = (patch: Partial<Preferences>) => void window.api.invoke('prefs:set', patch);

const TABS = [
  { id: 'geral', label: 'Geral' },
  { id: 'atalhos', label: 'Atalhos' },
  { id: 'layout', label: 'Layout' },
] as const;
type TabId = (typeof TABS)[number]['id'];

export function PreferencesDialog({ onClose }: { onClose(): void }) {
  const prefs = useAppState((s) => s.prefs);
  const testMode = useAppState((s) => s.info.testMode);
  const [tab, setTab] = useState<TabId>('geral');
  const [transfer, setTransfer] = useState<{ text: string; error?: boolean } | null>(null);

  const moveSettings = async (channel: 'prefs:export' | 'prefs:import') => {
    try {
      const result = await window.api.invoke(channel);
      if (result === null) return;
      setTransfer({
        text:
          typeof result === 'string'
            ? `Configurações exportadas para ${result}`
            : 'Configurações importadas.',
      });
    } catch (err) {
      setTransfer({ text: errorMessage(err), error: true });
    }
  };

  const check = (
    key: 'notifyWaiting' | 'notifyDone' | 'notifySound' | 'showHiddenFiles',
    label: string,
  ) => (
    <label className="check">
      <input
        type="checkbox"
        checked={prefs[key]}
        onChange={(e) => set({ [key]: e.target.checked })}
      />
      {label}
    </label>
  );

  return (
    <Dialog title="Preferências" onClose={onClose} className="prefs">
      <div
        className="tabs"
        role="tablist"
        aria-label="Seções das preferências"
        onKeyDown={(e) => {
          if (e.key !== 'ArrowRight' && e.key !== 'ArrowLeft') return;
          e.preventDefault();
          const index = TABS.findIndex((t) => t.id === tab);
          const next =
            TABS[(index + (e.key === 'ArrowRight' ? 1 : -1) + TABS.length) % TABS.length]!;
          setTab(next.id);
          document.getElementById(`prefs-tab-${next.id}`)?.focus();
        }}
      >
        {TABS.map((t) => (
          <button
            key={t.id}
            id={`prefs-tab-${t.id}`}
            role="tab"
            aria-selected={t.id === tab}
            aria-controls="prefs-panel"
            data-autofocus={t.id === tab ? true : undefined}
            className={t.id === tab ? 'tab selected' : 'tab'}
            onClick={() => setTab(t.id)}
          >
            {t.label}
          </button>
        ))}
      </div>
      <div
        className="form tab-panel"
        id="prefs-panel"
        role="tabpanel"
        aria-labelledby={`prefs-tab-${tab}`}
      >
        {tab === 'layout' && (
          <LayoutEditor layout={prefs.layout} onChange={(layout) => set({ layout })} />
        )}
        {tab === 'atalhos' && (
          <ShortcutsEditor
            shortcuts={prefs.shortcuts}
            onChange={(shortcuts) => set({ shortcuts })}
          />
        )}
        {tab === 'geral' && (
          <>
            <fieldset className="field">
              <legend>Avisos</legend>
              {check('notifyWaiting', 'Avisar quando um agente estiver aguardando você')}
              {check('notifyDone', 'Avisar quando um agente terminar')}
              {check('notifySound', 'Tocar som no aviso')}
              <label className="field-inline">
                <span>Considerar “possivelmente aguardando” após</span>
                <input
                  type="number"
                  min={0}
                  max={600}
                  value={prefs.silenceSeconds}
                  onChange={(e) => set({ silenceSeconds: Number(e.target.value) })}
                />
                <span>s sem saída (0 desliga)</span>
              </label>
            </fieldset>

            <fieldset className="field">
              <legend>Terminal</legend>
              <label className="field-inline">
                <span>Tema</span>
                <select
                  value={prefs.theme}
                  onChange={(e) => set({ theme: e.target.value === 'light' ? 'light' : 'dark' })}
                >
                  <option value="dark">Escuro</option>
                  <option value="light">Claro</option>
                </select>
              </label>
              <label className="field-inline">
                <span>Fonte</span>
                <input
                  className="wide"
                  defaultValue={prefs.fontFamily}
                  onBlur={(e) => set({ fontFamily: e.target.value })}
                />
              </label>
              <label className="field-inline">
                <span>Tamanho</span>
                <input
                  type="number"
                  min={8}
                  max={32}
                  value={prefs.fontSize}
                  onChange={(e) => set({ fontSize: Number(e.target.value) })}
                />
              </label>
              <label className="field-inline">
                <span>Linhas de histórico por sessão</span>
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
              <legend>Sessões</legend>
              <label className="field-inline">
                <span>Pasta inicial das novas sessões</span>
                <input
                  // Remounted when the folder comes from the native dialog.
                  key={prefs.defaultFolder}
                  className="wide"
                  aria-label="Pasta inicial das novas sessões"
                  placeholder="A da última sessão"
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
                    Escolher…
                  </button>
                )}
              </label>
              <FavoriteFolders />
            </fieldset>

            <fieldset className="field">
              <legend>Arquivos</legend>
              {check(
                'showHiddenFiles',
                'Mostrar também os arquivos ocultos (os que começam com ponto e os ignorados pelo git)',
              )}
            </fieldset>

            <fieldset className="field">
              <legend>Configurações</legend>
              <span className="muted">
                Tudo o que está nas preferências, atalhos, layout e pastas favoritas incluídos, em
                um arquivo para guardar ou levar a outra máquina. As sessões não vão junto.
              </span>
              <div className="field-row settings-transfer">
                <button type="button" onClick={() => void moveSettings('prefs:export')}>
                  Exportar…
                </button>
                <button type="button" onClick={() => void moveSettings('prefs:import')}>
                  Importar…
                </button>
              </div>
              {transfer && (
                <p
                  className={transfer.error ? 'form-error' : 'form-note done'}
                  role={transfer.error ? 'alert' : 'status'}
                >
                  {transfer.text}
                </p>
              )}
            </fieldset>
          </>
        )}
      </div>
      <div className="dialog-actions">
        <button className="primary" onClick={onClose}>
          Fechar
        </button>
      </div>
    </Dialog>
  );
}
