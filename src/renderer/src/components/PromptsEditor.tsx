import { useEffect, useState } from 'react';
import type { Preferences } from '@shared/prefs';
import {
  factoryPrompts,
  isFactoryPrompts,
  newPromptId,
  PROMPT_NAME_LIMIT,
  PROMPT_TEXT_LIMIT,
  PROMPTS_LIMIT,
  type PromptTemplate,
} from '@shared/prompts';
import { bindingFromEvent, bindingIndex, bindingProblem } from '@shared/shortcuts';
import { useT } from '../lib/i18n';
import { shortcutRecording } from '../lib/shortcuts';

interface Props {
  prefs: Preferences;
  onChange(patch: Partial<Preferences>): void;
}

/** Preferences → Prompts: the saved prompts, each with its name, text and shortcut. */
export function PromptsEditor({ prefs, onChange }: Props) {
  const t = useT();
  const { prompts } = prefs;
  const [current, setCurrent] = useState<string | null>(prompts[0]?.id ?? null);
  const [recording, setRecording] = useState(false);
  const [note, setNote] = useState<string | null>(null);
  const prompt = prompts.find((p) => p.id === current) ?? null;

  useEffect(() => {
    shortcutRecording.active = recording;
    return () => {
      shortcutRecording.active = false;
    };
  }, [recording]);

  const save = (next: PromptTemplate[]) => onChange({ prompts: next });
  const update = (patch: Partial<PromptTemplate>) =>
    save(prompts.map((p) => (p.id === current ? { ...p, ...patch } : p)));

  const add = () => {
    const id = newPromptId(prompts);
    save([...prompts, { id, name: t('prompts.newName'), text: '' }]);
    setCurrent(id);
  };
  const remove = () => {
    const index = prompts.findIndex((p) => p.id === current);
    const rest = prompts.filter((p) => p.id !== current);
    save(rest);
    setCurrent(rest[Math.min(index, rest.length - 1)]?.id ?? null);
  };

  const record = (event: React.KeyboardEvent) => {
    event.preventDefault();
    event.stopPropagation();
    const binding = bindingFromEvent(event);
    if (!binding) return;
    if (binding === 'Escape') {
      setRecording(false);
      setNote(null);
      return;
    }
    const problem = bindingProblem(binding);
    const action = bindingIndex(prefs.shortcuts).get(binding);
    const other = prompts.find((p) => p.id !== current && p.shortcut === binding);
    if (problem) setNote(t(problem.key, problem.params));
    else if (action)
      setNote(t('prompts.shortcutTaken', { binding, action: t(`shortcut.${action}`) }));
    else if (other) setNote(t('prompts.shortcutTaken', { binding, action: other.name }));
    else {
      update({ shortcut: binding });
      setRecording(false);
      setNote(null);
    }
  };

  return (
    <>
      <fieldset className="field">
        <legend>{t('prompts.title')}</legend>
        <span className="muted">{t('prompts.intro')}</span>
        <div className="prompts-editor">
          <ul className="prompt-list" role="listbox" aria-label={t('prompts.title')}>
            {prompts.map((p) => (
              <li
                key={p.id}
                role="option"
                tabIndex={0}
                aria-selected={p.id === current}
                className={p.id === current ? 'selected' : ''}
                onClick={() => setCurrent(p.id)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' || e.key === ' ') setCurrent(p.id);
                }}
              >
                {p.name}
                {p.shortcut && <kbd>{p.shortcut}</kbd>}
              </li>
            ))}
            {prompts.length === 0 && <li className="muted">{t('prompts.none')}</li>}
          </ul>
          {prompt && (
            <div className="prompt-form" key={prompt.id}>
              <label className="field">
                <span>{t('prompts.name')}</span>
                <input
                  aria-label={t('prompts.name')}
                  maxLength={PROMPT_NAME_LIMIT}
                  defaultValue={prompt.name}
                  onBlur={(e) => e.target.value.trim() && update({ name: e.target.value })}
                />
              </label>
              <label className="field">
                <span>{t('prompts.text')}</span>
                <textarea
                  aria-label={t('prompts.text')}
                  className="prompt-text"
                  rows={8}
                  maxLength={PROMPT_TEXT_LIMIT}
                  spellCheck={false}
                  defaultValue={prompt.text}
                  onBlur={(e) => update({ text: e.target.value })}
                />
                <span className="muted">{t('prompts.variablesHint')}</span>
              </label>
              <div className="field-inline">
                <span>{t('prompts.shortcut')}</span>
                {prompt.shortcut && (
                  <kbd>
                    {prompt.shortcut}
                    <button
                      className="shortcut-remove"
                      aria-label={t('prompts.shortcutRemove')}
                      title={t('common.remove')}
                      onClick={() => update({ shortcut: undefined })}
                    >
                      ×
                    </button>
                  </kbd>
                )}
                {recording ? (
                  <button
                    className="active"
                    autoFocus
                    onKeyDown={record}
                    onBlur={() => setRecording(false)}
                  >
                    {t('shortcuts.press')}
                  </button>
                ) : (
                  <button
                    type="button"
                    aria-label={t('prompts.shortcutAdd')}
                    onClick={() => {
                      setNote(null);
                      setRecording(true);
                    }}
                  >
                    {prompt.shortcut ? t('prompts.shortcutChange') : t('prompts.shortcutAdd')}
                  </button>
                )}
              </div>
              {note && (
                <p className="form-note" role="status">
                  {note}
                </p>
              )}
            </div>
          )}
        </div>
        <div className="shortcut-footer">
          <button type="button" onClick={add} disabled={prompts.length >= PROMPTS_LIMIT}>
            {t('prompts.add')}
          </button>
          <button type="button" onClick={remove} disabled={!prompt}>
            {t('prompts.remove')}
          </button>
          <span className="spacer" />
          <button
            type="button"
            disabled={isFactoryPrompts(prompts, prefs.language)}
            onClick={() => {
              const restored = factoryPrompts(prefs.language);
              save(restored);
              setCurrent(restored[0]?.id ?? null);
            }}
          >
            {t('prompts.restore')}
          </button>
        </div>
      </fieldset>
      <fieldset className="field">
        <legend>{t('prompts.sending')}</legend>
        <label className="check">
          <input
            type="checkbox"
            checked={prefs.promptSubmit}
            onChange={(e) => onChange({ promptSubmit: e.target.checked })}
          />
          {t('prompts.submit')}
        </label>
        <span className="muted">{t('prompts.submitHint')}</span>
      </fieldset>
    </>
  );
}
