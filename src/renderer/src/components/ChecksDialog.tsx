import { useCallback, useEffect, useState } from 'react';
import {
  CHECK_TIMEOUT,
  CHECKS_LIMIT,
  isFailure,
  summarizeRun,
  type CheckConfig,
  type CheckResult,
  type ChecksInfo,
  type ChecksRun,
  type ChecksSummary,
} from '@shared/checks';
import type { Translate } from '@shared/i18n';
import type { SessionView } from '@shared/session';
import { errorMessage } from '../lib/format';
import { useT } from '../lib/i18n';
import { Dialog } from './Dialog';
import { LinkedOutput } from './LinkedOutput';

const BADGE_TEXT: Record<ChecksSummary['state'], (s: ChecksSummary) => string> = {
  queued: () => '…',
  running: () => '…',
  passed: () => '✓',
  failed: (s) => `✗ ${s.failed}`,
  cancelled: () => '–',
};

export function checksLabel(t: Translate, summary: ChecksSummary): string {
  return summary.state === 'failed'
    ? t('checks.state.failed', { failed: summary.failed, total: summary.total })
    : t(`checks.state.${summary.state}`);
}

/** The latest run of the checks of a session, in a few characters. */
export function ChecksBadge({ summary }: { summary: ChecksSummary }) {
  const t = useT();
  const label = checksLabel(t, summary);
  return (
    <span
      className={`checks-badge checks-${summary.state}`}
      data-testid="checks-badge"
      data-checks={summary.state}
      title={label}
      aria-label={label}
    >
      {BADGE_TEXT[summary.state](summary)}
    </span>
  );
}

interface Draft extends CheckConfig {
  /** Stable across edits: the id is only settled when saved. */
  key: number;
}

let nextKey = 1;
const toDraft = (check: CheckConfig): Draft => ({ ...check, key: nextKey++ });
const blank = (): Draft =>
  toDraft({ id: '', label: '', command: '', timeoutSec: CHECK_TIMEOUT.default, onTurnEnd: true });

function outcomeText(t: Translate, result: CheckResult): string {
  if (result.outcome === 'failed') {
    return t('checks.outcome.failed', { code: result.exitCode ?? '?' });
  }
  return t(`checks.outcome.${result.outcome}`);
}

function RunView({
  run,
  sessionId,
  onOpen,
}: {
  run: ChecksRun;
  sessionId: string;
  onOpen(): void;
}) {
  const t = useT();
  const summary = summarizeRun(run);
  return (
    <div className="checks-run" data-testid="checks-run" data-state={summary.state}>
      <p className="checks-run-head">
        <strong>{checksLabel(t, summary)}</strong>
        <span className="muted"> · {t(`checks.trigger.${run.trigger}`)}</span>
      </p>
      <ul className="checks-results">
        {run.checks.map((check) => {
          const result = run.results.find((r) => r.id === check.id);
          const running = !result && run.current === check.id;
          const status = result
            ? outcomeText(t, result)
            : running
              ? t('checks.outcome.running')
              : run.state === 'cancelled'
                ? t('checks.outcome.cancelled')
                : t('checks.outcome.pending');
          const failed = result ? isFailure(result.outcome) : false;
          return (
            <li key={check.id} className="checks-result" data-outcome={result?.outcome ?? ''}>
              <details open={failed}>
                <summary>
                  <span className={`checks-mark ${result ? `checks-${result.outcome}` : ''}`}>
                    {result ? (failed ? '✗' : result.outcome === 'passed' ? '✓' : '–') : '·'}
                  </span>
                  <span className="checks-result-label">{check.label}</span>
                  <span className="command muted">{check.command}</span>
                  <span className="spacer" />
                  <span className={failed ? 'checks-failed-text' : 'muted'}>{status}</span>
                  {result && (
                    <span className="muted">
                      {t('checks.duration', { seconds: (result.durationMs / 1000).toFixed(1) })}
                    </span>
                  )}
                </summary>
                {result && (
                  <>
                    {result.truncated && <p className="muted">{t('checks.truncated')}</p>}
                    <pre className="checks-output">
                      {result.output.trim() ? (
                        <LinkedOutput
                          sessionId={sessionId}
                          text={result.output.trim()}
                          onOpen={onOpen}
                        />
                      ) : (
                        t('checks.noOutput')
                      )}
                    </pre>
                  </>
                )}
              </details>
            </li>
          );
        })}
      </ul>
    </div>
  );
}

interface Props {
  session: SessionView;
  onClose(): void;
  /** The failure was pasted into the agent's prompt: the terminal is where to look now. */
  onSent(): void;
}

/** The checks of the session's folder: which ones, and how the latest run went. */
export function ChecksDialog({ session, onClose, onSent }: Props) {
  const t = useT();
  const [info, setInfo] = useState<ChecksInfo | null>(null);
  const [drafts, setDrafts] = useState<Draft[]>([]);
  const [dirty, setDirty] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);

  const load = useCallback(
    async (keepDrafts: boolean) => {
      try {
        const next = await window.api.invoke('checks:get', session.id);
        setInfo(next);
        if (!keepDrafts) setDrafts(next.checks.map(toDraft));
      } catch (err) {
        setError(errorMessage(err));
      }
    },
    [session.id],
  );
  useEffect(() => void load(false), [load]);
  // A run moves on while the dialog is open; what is being typed stays.
  useEffect(
    () => window.api.on('checks:changed', (id) => id === session.id && void load(true)),
    [session.id, load],
  );

  const edit = (key: number, patch: Partial<CheckConfig>) => {
    setDrafts((list) => list.map((d) => (d.key === key ? { ...d, ...patch } : d)));
    setDirty(true);
    setNote(null);
  };
  const add = (check: Draft) => {
    setDrafts((list) => [...list, check]);
    setDirty(true);
    setNote(null);
  };
  const remove = (key: number) => {
    setDrafts((list) => list.filter((d) => d.key !== key));
    setDirty(true);
  };

  const save = async () => {
    setError(null);
    try {
      const checks = drafts
        .filter((d) => d.command.trim())
        .map(({ key: _key, ...check }) => ({ ...check, command: check.command.trim() }));
      const next = await window.api.invoke('checks:configure', session.id, checks);
      setInfo(next);
      setDrafts(next.checks.map(toDraft));
      setDirty(false);
      setNote(t('checks.saved'));
    } catch (err) {
      setError(errorMessage(err));
    }
  };
  const act = async (action: () => Promise<void>) => {
    setError(null);
    setNote(null);
    try {
      await action();
    } catch (err) {
      setError(errorMessage(err));
    }
  };

  // Esc and a click outside close the dialog too: what was typed is not lost without a word.
  const close = () => {
    if (!dirty || window.confirm(t('checks.discardConfirm'))) onClose();
  };

  const run = info?.run ?? null;
  const busy = run?.state === 'queued' || run?.state === 'running';
  const failed = run ? summarizeRun(run).state === 'failed' : false;
  const suggestions = (info?.suggestions ?? []).filter(
    (s) => !drafts.some((d) => d.command.trim() === s.command),
  );

  return (
    <Dialog title={t('checks.title')} onClose={close} className="checks-dialog">
      <p className="muted checks-intro">{t('checks.intro')}</p>
      <p className="muted checks-folder" title={session.cwd}>
        {t('checks.folder', { folder: session.cwd })}
      </p>

      <h3 className="checks-section">{t('checks.configured')}</h3>
      {drafts.length === 0 && <p className="muted">{t('checks.none')}</p>}
      <ul className="checks-list">
        {drafts.map((d, index) => (
          <li key={d.key} className="checks-row">
            <input
              aria-label={t('checks.labelOf', { index: index + 1 })}
              placeholder={t('checks.label')}
              className="checks-label-input"
              value={d.label}
              onChange={(e) => edit(d.key, { label: e.target.value })}
            />
            <input
              aria-label={t('checks.commandOf', { index: index + 1 })}
              placeholder={t('checks.command')}
              className="command checks-command-input"
              value={d.command}
              onChange={(e) => edit(d.key, { command: e.target.value })}
            />
            <input
              type="number"
              aria-label={t('checks.timeoutOf', { index: index + 1 })}
              title={t('checks.timeout')}
              min={CHECK_TIMEOUT.min}
              max={CHECK_TIMEOUT.max}
              value={d.timeoutSec}
              onChange={(e) => edit(d.key, { timeoutSec: Number(e.target.value) })}
            />
            <label className="check" title={t('checks.onTurnEndHint')}>
              <input
                type="checkbox"
                checked={d.onTurnEnd}
                onChange={(e) => edit(d.key, { onTurnEnd: e.target.checked })}
              />
              {t('checks.onTurnEnd')}
            </label>
            <button
              className="icon-button"
              aria-label={t('checks.removeOf', { index: index + 1 })}
              title={t('common.remove')}
              onClick={() => remove(d.key)}
            >
              ×
            </button>
          </li>
        ))}
      </ul>
      <div className="checks-toolbar">
        <button onClick={() => add(blank())} disabled={drafts.length >= CHECKS_LIMIT}>
          {t('checks.add')}
        </button>
        <span className="spacer" />
        <button className="primary" onClick={() => void save()} disabled={!dirty}>
          {t('checks.save')}
        </button>
      </div>
      {suggestions.length > 0 && (
        <div className="checks-suggestions">
          <span className="muted">{t('checks.suggestions')}</span>
          {suggestions.map((s) => (
            <button
              key={s.command}
              className="checks-suggestion"
              title={s.command}
              disabled={drafts.length >= CHECKS_LIMIT}
              onClick={() => add(toDraft(s))}
            >
              + <span className="command">{s.command}</span>
            </button>
          ))}
        </div>
      )}

      <h3 className="checks-section">{t('checks.lastRun')}</h3>
      {run ? (
        <RunView run={run} sessionId={session.id} onOpen={onClose} />
      ) : (
        <p className="muted">{t('checks.noRun')}</p>
      )}

      {note && (
        <p className="form-note done" role="status">
          {note}
        </p>
      )}
      {error && (
        <p className="form-error" role="alert">
          {error}
        </p>
      )}
      <div className="dialog-actions">
        {failed && !busy && (
          <button
            title={t('checks.sendFailureHint')}
            disabled={!session.running}
            onClick={() =>
              void act(async () => {
                await window.api.invoke('checks:sendFailure', session.id);
                onSent();
              })
            }
          >
            {t('checks.sendFailure')}
          </button>
        )}
        <span className="spacer" />
        {busy ? (
          <button onClick={() => void act(() => window.api.invoke('checks:cancel', session.id))}>
            {t('checks.cancel')}
          </button>
        ) : (
          <button
            disabled={dirty || !info?.checks.length}
            title={dirty ? t('checks.saveFirst') : undefined}
            onClick={() => void act(() => window.api.invoke('checks:run', session.id))}
          >
            {t('checks.runNow')}
          </button>
        )}
        <button data-autofocus onClick={close}>
          {t('common.close')}
        </button>
      </div>
    </Dialog>
  );
}
