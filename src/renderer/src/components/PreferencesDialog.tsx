import { SCROLLBACK_LIMITS, type Preferences } from '@shared/prefs';
import { useAppState } from '../lib/store';
import { Dialog } from './Dialog';

const set = (patch: Partial<Preferences>) => void window.api.invoke('prefs:set', patch);

export function PreferencesDialog({ onClose }: { onClose(): void }) {
  const prefs = useAppState((s) => s.prefs);

  const check = (key: 'notifyWaiting' | 'notifyDone' | 'notifySound', label: string) => (
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
    <Dialog title="Preferências" onClose={onClose}>
      <div className="form">
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

        <div className="dialog-actions">
          <button className="primary" onClick={onClose}>
            Fechar
          </button>
        </div>
      </div>
    </Dialog>
  );
}
