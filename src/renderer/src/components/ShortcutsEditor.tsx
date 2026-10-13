import { useEffect, useState } from 'react';
import {
  assignBinding,
  bindingFromEvent,
  bindingProblem,
  DEFAULT_SHORTCUTS,
  MAX_BINDINGS_PER_ACTION,
  SHORTCUT_ACTIONS,
  SHORTCUT_LABEL,
  type ShortcutAction,
  type ShortcutMap,
} from '@shared/shortcuts';
import { shortcutRecording } from '../lib/shortcuts';

interface Props {
  shortcuts: ShortcutMap;
  onChange(shortcuts: ShortcutMap): void;
}

/** The shortcuts of the app, each one changed by pressing the keys it should have. */
export function ShortcutsEditor({ shortcuts, onChange }: Props) {
  const [recording, setRecording] = useState<ShortcutAction | null>(null);
  const [note, setNote] = useState<string | null>(null);

  // While a shortcut is being recorded, the app must not run the ones that exist.
  useEffect(() => {
    shortcutRecording.active = recording !== null;
    return () => {
      shortcutRecording.active = false;
    };
  }, [recording]);

  const record = (action: ShortcutAction, event: React.KeyboardEvent) => {
    event.preventDefault();
    event.stopPropagation();
    const binding = bindingFromEvent(event);
    if (!binding) return; // Only modifiers so far.
    if (binding === 'Escape') {
      setRecording(null);
      setNote(null);
      return;
    }
    const problem = bindingProblem(binding);
    if (problem) {
      setNote(problem);
      return;
    }
    const { map, takenFrom } = assignBinding(shortcuts, action, binding);
    onChange(map);
    setRecording(null);
    setNote(
      takenFrom ? `${binding} estava em “${SHORTCUT_LABEL[takenFrom]}” e passou para cá.` : null,
    );
  };

  return (
    <fieldset className="field shortcuts" aria-label="Atalhos">
      <ul className="shortcut-list">
        {SHORTCUT_ACTIONS.map((action) => (
          <li key={action} data-action={action}>
            <span className="shortcut-label">{SHORTCUT_LABEL[action]}</span>
            <span className="shortcut-keys">
              {shortcuts[action].map((binding) => (
                <kbd key={binding}>
                  {binding}
                  <button
                    className="shortcut-remove"
                    aria-label={`Remover ${binding} de ${SHORTCUT_LABEL[action]}`}
                    title="Remover"
                    onClick={() =>
                      onChange({
                        ...shortcuts,
                        [action]: shortcuts[action].filter((b) => b !== binding),
                      })
                    }
                  >
                    ×
                  </button>
                </kbd>
              ))}
              {shortcuts[action].length === 0 && recording !== action && (
                <span className="muted">sem atalho</span>
              )}
              {recording === action ? (
                <button
                  className="active"
                  autoFocus
                  aria-label={`Pressione as teclas para ${SHORTCUT_LABEL[action]}`}
                  onKeyDown={(e) => record(action, e)}
                  onBlur={() => setRecording(null)}
                >
                  Pressione as teclas… (Esc cancela)
                </button>
              ) : (
                <button
                  aria-label={`Adicionar atalho para ${SHORTCUT_LABEL[action]}`}
                  title="Adicionar um atalho"
                  disabled={shortcuts[action].length >= MAX_BINDINGS_PER_ACTION}
                  onClick={() => {
                    setNote(null);
                    setRecording(action);
                  }}
                >
                  +
                </button>
              )}
            </span>
          </li>
        ))}
        <li>
          <span className="shortcut-label">Ir para a sessão N</span>
          <span className="shortcut-keys">
            <kbd>Ctrl+1</kbd>…<kbd>Ctrl+9</kbd>
            <span className="muted">fixo</span>
          </span>
        </li>
      </ul>
      <div className="shortcut-footer">
        <span className="shortcut-note" role="status">
          {note}
        </span>
        <button
          onClick={() => {
            onChange(DEFAULT_SHORTCUTS);
            setNote('Atalhos de volta ao padrão.');
          }}
        >
          Restaurar padrões
        </button>
      </div>
    </fieldset>
  );
}
