import { useEffect, useState } from 'react';
import {
  assignBinding,
  bindingFromEvent,
  bindingProblem,
  DEFAULT_SHORTCUTS,
  MAX_BINDINGS_PER_ACTION,
  SHORTCUT_ACTIONS,
  type ShortcutAction,
  type ShortcutMap,
} from '@shared/shortcuts';
import { useT } from '../lib/i18n';
import { shortcutRecording } from '../lib/shortcuts';

interface Props {
  shortcuts: ShortcutMap;
  onChange(shortcuts: ShortcutMap): void;
}

/** The shortcuts of the app, each one changed by pressing the keys it should have. */
export function ShortcutsEditor({ shortcuts, onChange }: Props) {
  const t = useT();
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
      setNote(t(problem.key, problem.params));
      return;
    }
    const { map, takenFrom } = assignBinding(shortcuts, action, binding);
    onChange(map);
    setRecording(null);
    setNote(
      takenFrom ? t('shortcuts.moved', { binding, action: t(`shortcut.${takenFrom}`) }) : null,
    );
  };

  return (
    <fieldset className="field shortcuts" aria-label={t('shortcuts.title')}>
      <ul className="shortcut-list">
        {SHORTCUT_ACTIONS.map((action) => {
          const label = t(`shortcut.${action}`);
          return (
            <li key={action} data-action={action}>
              <span className="shortcut-label">{label}</span>
              <span className="shortcut-keys">
                {shortcuts[action].map((binding) => (
                  <kbd key={binding}>
                    {binding}
                    <button
                      className="shortcut-remove"
                      aria-label={t('shortcuts.removeFrom', { binding, action: label })}
                      title={t('common.remove')}
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
                  <span className="muted">{t('shortcuts.none')}</span>
                )}
                {recording === action ? (
                  <button
                    className="active"
                    autoFocus
                    aria-label={t('shortcuts.pressFor', { action: label })}
                    onKeyDown={(e) => record(action, e)}
                    onBlur={() => setRecording(null)}
                  >
                    {t('shortcuts.press')}
                  </button>
                ) : (
                  <button
                    aria-label={t('shortcuts.addFor', { action: label })}
                    title={t('shortcuts.add')}
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
          );
        })}
        <li>
          <span className="shortcut-label">{t('shortcuts.goToN')}</span>
          <span className="shortcut-keys">
            <kbd>Ctrl+1</kbd>…<kbd>Ctrl+9</kbd>
            <span className="muted">{t('shortcuts.fixed')}</span>
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
            setNote(t('shortcuts.restored'));
          }}
        >
          {t('shortcuts.restore')}
        </button>
      </div>
    </fieldset>
  );
}
