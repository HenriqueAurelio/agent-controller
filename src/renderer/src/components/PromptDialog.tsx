import { useEffect, useMemo, useState } from 'react';
import {
  PROBLEMS_TEXT_LIMIT,
  PROMPT_TEXT_LIMIT,
  promptQuestions,
  QUEUE_CONDITIONS,
  SELECTION_LIMIT,
  type PromptValues,
  type QueueCondition,
} from '@shared/prompts';
import { isBusyForText } from '@shared/session';
import { errorMessage, PROFILE_LABEL } from '../lib/format';
import { useT } from '../lib/i18n';
import { useAppState } from '../lib/store';
import { Dialog } from './Dialog';

/** What the app knew when the prompt was asked for: the file and selection of the panel. */
export interface PromptContext {
  file?: string;
  selection?: string;
  /** The problems picked in the problems list, a line each. */
  problems?: string;
}

interface Props {
  /** The prompt the dialog opens with; the first saved one otherwise. */
  promptId?: string;
  /** The sessions it goes to, unless the user changes them. */
  targets: string[];
  context: PromptContext;
  /** The text the dialog opens with, in place of the one of the saved prompt. */
  text?: string;
  onClose(): void;
  onSent(): void;
}

/**
 * A saved prompt on its way to one or more agents: which one, the answers to its questions, the
 * sessions it goes to, and how it will read in the first of them.
 */
export function PromptDialog({
  promptId,
  targets: initialTargets,
  context,
  text: initialText,
  onClose,
  onSent,
}: Props) {
  const t = useT();
  const prompts = useAppState((s) => s.prefs.prompts);
  const promptSubmit = useAppState((s) => s.prefs.promptSubmit);
  const sessions = useAppState((s) => s.sessions);
  const [chosen, setChosen] = useState(
    () => prompts.find((p) => p.id === promptId)?.id ?? prompts[0]?.id ?? '',
  );
  const [text, setText] = useState(
    () => initialText ?? prompts.find((p) => p.id === chosen)?.text ?? '',
  );
  const [answers, setAnswers] = useState<Record<string, string>>({});
  const [targets, setTargets] = useState<string[]>(() =>
    initialTargets.filter((id) => sessions.some((s) => s.id === id && s.running)),
  );
  const [submit, setSubmit] = useState(promptSubmit);
  const [now, setNow] = useState(false);
  const [condition, setCondition] = useState<QueueCondition>('turnEnd');
  const [preview, setPreview] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const selection = context.selection ?? '';
  const cut = selection.length > SELECTION_LIMIT;
  const values = useMemo<PromptValues>(
    () => ({
      file: context.file,
      selection: cut ? selection.slice(0, SELECTION_LIMIT) : selection,
      ...(context.problems !== undefined && {
        problems: context.problems.slice(0, PROBLEMS_TEXT_LIMIT),
      }),
      answers,
    }),
    [context.file, selection, cut, context.problems, answers],
  );
  const questions = useMemo(() => promptQuestions(text), [text]);
  const ordered = sessions.filter((s) => targets.includes(s.id));
  const first = ordered[0];
  const waiting = ordered.filter((s) => isBusyForText(s.status) || s.pendingSends).length;

  // How the text reads in the first session, refreshed while it is edited.
  useEffect(() => {
    if (!first) {
      setPreview('');
      return;
    }
    let cancelled = false;
    const timer = setTimeout(() => {
      window.api
        .invoke('prompts:preview', first.id, text, values)
        .then((result) => !cancelled && setPreview(result))
        .catch((err) => !cancelled && setPreview(errorMessage(err)));
    }, 150);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [first, text, values]);

  const pick = (id: string) => {
    setChosen(id);
    setText(prompts.find((p) => p.id === id)?.text ?? '');
    setAnswers({});
  };

  const send = async () => {
    if (!targets.length || !text.trim() || busy) return;
    setBusy(true);
    setError(null);
    try {
      await window.api.invoke('terminal:sendText', targets, { text, values }, { submit, now });
      onSent();
    } catch (err) {
      setError(errorMessage(err));
      setBusy(false);
    }
  };

  /** Into the queue of each session: it goes, with Enter, when the turn before it ends. */
  const enqueue = async () => {
    if (!targets.length || !text.trim() || busy) return;
    setBusy(true);
    setError(null);
    try {
      await window.api.invoke('queue:add', targets, { text, values, condition });
      onSent();
    } catch (err) {
      setError(errorMessage(err));
      setBusy(false);
    }
  };

  return (
    <Dialog title={t('prompts.send.title')} onClose={onClose} className="prompt-dialog">
      <form
        className="form"
        onSubmit={(e) => {
          e.preventDefault();
          void send();
        }}
        onKeyDown={(e) => {
          if (e.key === 'Enter' && e.ctrlKey) {
            e.preventDefault();
            void send();
          }
        }}
      >
        <label className="field-inline">
          <span>{t('prompts.send.prompt')}</span>
          <select
            aria-label={t('prompts.send.prompt')}
            value={chosen}
            onChange={(e) => pick(e.target.value)}
          >
            {prompts.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
          </select>
        </label>

        {questions.map((question, index) => (
          <label key={question} className="field">
            <span>{question}</span>
            <input
              aria-label={question}
              data-autofocus={index === 0 ? true : undefined}
              value={answers[question] ?? ''}
              onChange={(e) => setAnswers({ ...answers, [question]: e.target.value })}
            />
          </label>
        ))}

        <label className="field">
          <span>{t('prompts.send.text')}</span>
          <textarea
            aria-label={t('prompts.send.text')}
            className="prompt-text"
            rows={5}
            maxLength={PROMPT_TEXT_LIMIT}
            spellCheck={false}
            value={text}
            onChange={(e) => setText(e.target.value)}
          />
          <span className="muted">{t('prompts.variablesHint')}</span>
        </label>

        {cut && (
          <p className="form-note" role="status">
            {t('prompts.send.selectionCut', { limit: SELECTION_LIMIT })}
          </p>
        )}

        <fieldset className="field">
          <legend>{t('prompts.send.targets')}</legend>
          <ul className="prompt-targets">
            {sessions.map((s) => (
              <li key={s.id}>
                <label className={`check ${s.running ? '' : 'disabled'}`}>
                  <input
                    type="checkbox"
                    disabled={!s.running}
                    checked={targets.includes(s.id)}
                    onChange={(e) =>
                      setTargets(
                        e.target.checked
                          ? [...targets, s.id]
                          : targets.filter((other) => other !== s.id),
                      )
                    }
                  />
                  {s.name}
                  <span className="muted">
                    {' '}
                    · {PROFILE_LABEL[s.profile]}
                    {!s.running && ` · ${t('prompts.send.notRunning')}`}
                    {s.running && isBusyForText(s.status) && ` · ${t('prompts.send.busy')}`}
                  </span>
                </label>
              </li>
            ))}
          </ul>
        </fieldset>

        {first && (
          <div className="field">
            <span>{t('prompts.send.preview', { name: first.name })}</span>
            <pre className="prompt-preview" data-testid="prompt-preview">
              {preview}
            </pre>
          </div>
        )}

        <label className="check">
          <input type="checkbox" checked={submit} onChange={(e) => setSubmit(e.target.checked)} />
          {t('prompts.submit')}
        </label>
        {waiting > 0 && (
          <>
            <p className="form-note" role="status">
              {t('prompts.send.waiting', { count: waiting })}
            </p>
            <label className="check">
              <input type="checkbox" checked={now} onChange={(e) => setNow(e.target.checked)} />
              {t('prompts.send.now')}
            </label>
          </>
        )}

        <label className="field-inline">
          <span>{t('prompts.send.condition')}</span>
          <select
            aria-label={t('prompts.send.condition')}
            value={condition}
            onChange={(e) => setCondition(e.target.value as QueueCondition)}
          >
            {QUEUE_CONDITIONS.map((c) => (
              <option key={c} value={c}>
                {t(`queue.condition.${c}`)}
              </option>
            ))}
          </select>
        </label>
        {!promptSubmit && <p className="muted queue-note">{t('prompts.send.queueNote')}</p>}

        {error && (
          <p className="form-error" role="alert">
            {error}
          </p>
        )}

        <div className="dialog-actions">
          <button type="button" onClick={onClose}>
            {t('common.cancel')}
          </button>
          <button
            type="button"
            disabled={!targets.length || !text.trim() || busy}
            onClick={() => void enqueue()}
          >
            {targets.length > 1
              ? t('prompts.send.queueMany', { count: targets.length })
              : t('prompts.send.queue')}
          </button>
          <button
            type="submit"
            className="primary"
            disabled={!targets.length || !text.trim() || busy}
            title={t('prompts.send.hint')}
          >
            {targets.length > 1
              ? t('prompts.send.submitMany', { count: targets.length })
              : t('prompts.send.submit')}
          </button>
        </div>
      </form>
    </Dialog>
  );
}
