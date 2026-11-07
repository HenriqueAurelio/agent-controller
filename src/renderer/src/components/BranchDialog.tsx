import { useEffect, useRef, useState } from 'react';
import type { BranchInfo } from '@shared/branch';
import type { BaseUpdate } from '@shared/branchUpdate';
import type { OpenedPull } from '@shared/pullReview';
import { PULL_TITLE_LIMIT } from '@shared/pullReview';
import type { Problem } from '@shared/checks';
import type { SessionView } from '@shared/session';
import type { SonarStatus } from '@shared/sonar';
import { errorMessage } from '../lib/format';
import { useT } from '../lib/i18n';
import { useSonarRuns } from '../lib/sonar';
import { Dialog } from './Dialog';

interface Props {
  session: SessionView;
  onClose(): void;
  /** Sends the conflicts of the update to the agent of the session, through the prompt dialog. */
  onSendConflict(text: string): void;
  /** Sends the problems Sonar found to the agent, through the prompt "Fix problems". */
  onSendProblems(problems: Problem[]): void;
}

const ACTIVE: readonly SonarStatus[] = ['queued', 'running', 'processing'];

const openSite = (url: string) => void window.api.invoke('shell:openExternal', url);

/** The branch of a copy on its way to a pull request: push and open it, or bring the base in. */
export function BranchDialog({ session, onClose, onSendConflict, onSendProblems }: Props) {
  const t = useT();
  const [info, setInfo] = useState<BranchInfo | null>(null);
  const [title, setTitle] = useState('');
  const [body, setBody] = useState('');
  const [draft, setDraft] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [opened, setOpened] = useState<OpenedPull | null>(null);
  const [update, setUpdate] = useState<BaseUpdate | null>(null);
  const [reloads, setReloads] = useState(0);
  // Sonar before the pull request: when the opening was asked for, it waits for an analysis that
  // started after that moment and is about the commit that goes out.
  const sonarRuns = useSonarRuns();
  const [askedAt, setAskedAt] = useState<number | null>(null);
  const latest = sonarRuns[session.id];
  const sonar = latest && info && latest.commit === info.head ? latest : null;
  const gated = Boolean(info?.sonarBeforePull);
  const analysing = askedAt !== null;

  useEffect(() => {
    let cancelled = false;
    window.api
      .invoke('branch:info', session.id)
      .then((value) => {
        if (cancelled) return;
        setInfo(value);
        setTitle((current) => current || value.title);
        setBody((current) => current || value.body);
      })
      .catch((err) => !cancelled && setError(errorMessage(err)));
    return () => {
      cancelled = true;
    };
  }, [session.id, reloads]);

  const run = async (action: () => Promise<void>) => {
    setBusy(true);
    setError(null);
    try {
      await action();
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  };
  const openPull = () =>
    void run(async () => {
      setOpened(await window.api.invoke('branch:openPull', session.id, { title, body, draft }));
    });
  // The effect below opens with the fields as they are when the analysis ends.
  const openLater = useRef(openPull);
  openLater.current = openPull;
  const submit = () => {
    if (!gated || sonar?.status === 'passed') return openPull();
    setError(null);
    setAskedAt(Date.now());
    if (sonar && ACTIVE.includes(sonar.status)) return;
    window.api.invoke('sonar:run', session.id).catch((err) => {
      setAskedAt(null);
      setError(errorMessage(err));
    });
  };
  // The analysis asked for ended: a pass opens the pull request, anything else stops and says why.
  // A second of slack: the run is stamped by the main process, a moment after the click.
  const askedStatus =
    sonar && askedAt !== null && sonar.startedAt >= askedAt - 1000 ? sonar.status : null;
  useEffect(() => {
    if (!askedStatus || ACTIVE.includes(askedStatus)) return;
    setAskedAt(null);
    if (askedStatus === 'passed') openLater.current();
  }, [askedStatus]);

  return (
    <Dialog
      title={t('branch.title', { name: session.name })}
      onClose={onClose}
      className="branch-dialog"
    >
      <div className="form">
        {info && (
          <p className="muted" data-testid="branch-summary">
            {t('branch.summary', { branch: info.branch, base: info.base, count: info.ahead })}
            {info.repo ? ` · ${info.repo}` : ''}
          </p>
        )}
        {info && info.subjects.length > 0 && (
          <ul className="branch-commits">
            {info.subjects.map((subject, index) => (
              <li key={index}>{subject}</li>
            ))}
          </ul>
        )}
        {info && info.dirty > 0 && (
          <p className="branch-warning" role="status">
            {t('branch.dirty', { count: info.dirty })}
          </p>
        )}
        {info && !info.repo && <p className="form-error">{t('branch.noRepo')}</p>}

        {gated && (
          <div
            className="branch-sonar"
            role="status"
            data-testid="branch-sonar"
            data-status={analysing ? 'running' : (sonar?.status ?? 'pending')}
          >
            <p>
              {analysing
                ? t('branch.sonar.running')
                : sonar?.status === 'passed'
                  ? t('branch.sonar.passed')
                  : sonar?.status === 'failed'
                    ? t('branch.sonar.failed', { count: sonar.problems.length + sonar.more })
                    : sonar?.status === 'error'
                      ? t('branch.sonar.error', { error: sonar.error ?? '' })
                      : t('branch.sonar.pending')}
            </p>
            {info && info.dirty > 0 && <p className="muted">{t('branch.sonar.dirty')}</p>}
            {!analysing && (sonar?.status === 'failed' || sonar?.status === 'error') && (
              <div className="dialog-actions">
                {sonar.problems.length > 0 && (
                  <button
                    type="button"
                    data-testid="branch-sonar-send"
                    onClick={() => onSendProblems(sonar.problems)}
                  >
                    {t('branch.sonar.send')}
                  </button>
                )}
                <button
                  type="button"
                  data-testid="branch-sonar-anyway"
                  disabled={busy || !info?.repo || !info.ahead || !title.trim()}
                  onClick={openPull}
                >
                  {t('branch.sonar.openAnyway')}
                </button>
              </div>
            )}
          </div>
        )}
        {opened ? (
          <div className="branch-opened" role="status" data-testid="branch-opened">
            <span>{t('branch.opened', { number: opened.number })}</span>
            <button type="button" onClick={() => openSite(opened.url)}>
              {t('branch.openSite')}
            </button>
          </div>
        ) : (
          <form
            className="form"
            onSubmit={(e) => {
              e.preventDefault();
              submit();
            }}
          >
            <label className="field">
              <span>{t('branch.pullTitle')}</span>
              <input
                data-testid="branch-title"
                value={title}
                maxLength={PULL_TITLE_LIMIT}
                onChange={(e) => setTitle(e.target.value)}
              />
            </label>
            <label className="field">
              <span>{t('branch.pullBody')}</span>
              <textarea
                data-testid="branch-body"
                rows={6}
                value={body}
                onChange={(e) => setBody(e.target.value)}
              />
            </label>
            <label className="check">
              <input type="checkbox" checked={draft} onChange={(e) => setDraft(e.target.checked)} />
              {t('branch.draft')}
            </label>
            <div className="dialog-actions">
              <span className="spacer" />
              <button
                type="submit"
                className="primary"
                data-testid="branch-open-pull"
                disabled={busy || analysing || !info?.repo || !info.ahead || !title.trim()}
                title={info && info.ahead === 0 ? t('branch.nothingToPush') : undefined}
              >
                {busy
                  ? t('branch.pushing')
                  : analysing
                    ? t('branch.sonar.running')
                    : gated && sonar?.status !== 'passed'
                      ? t('branch.sonar.analyseAndOpen')
                      : t('branch.openPull')}
              </button>
            </div>
          </form>
        )}

        <section className="branch-update">
          <h3>{t('branch.updateTitle')}</h3>
          <p className="muted">{t('branch.updateHint')}</p>
          {info && info.stackedOn && (
            <p className="muted" data-testid="branch-stacked">
              {t('branch.stacked', { base: info.base, name: info.stackedOn })}
            </p>
          )}
          {info && info.behind > 0 && (
            <p className="branch-warning" data-testid="branch-behind">
              {t('branch.behind', { base: info.base, count: info.behind })}
            </p>
          )}
          <button
            type="button"
            data-testid="branch-update"
            disabled={busy}
            onClick={() =>
              void run(async () => {
                setUpdate(await window.api.invoke('branch:updateFromBase', session.id));
                setReloads((n) => n + 1);
              })
            }
          >
            {t('branch.update', { base: info?.base ?? '' })}
          </button>
          {update && (
            <div className="branch-update-result" role="status" data-testid="branch-update-result">
              {update.status === 'current'
                ? t('branch.update.current', { from: update.from })
                : update.status === 'merged'
                  ? t('branch.update.merged', { from: update.from })
                  : t('branch.update.conflict', {
                      from: update.from,
                      count: update.conflicts.length,
                    })}
              {update.status === 'conflict' && (
                <>
                  <ul className="branch-conflicts">
                    {update.conflicts.map((file) => (
                      <li key={file}>{file}</li>
                    ))}
                  </ul>
                  <button
                    type="button"
                    className="primary"
                    data-testid="branch-send-conflict"
                    onClick={() =>
                      onSendConflict(
                        t('branch.conflictPrompt', {
                          from: update.from,
                          files: update.conflicts.map((f) => `- ${f}`).join('\n'),
                        }),
                      )
                    }
                  >
                    {t('branch.sendConflict')}
                  </button>
                </>
              )}
            </div>
          )}
        </section>

        {error && (
          <p className="form-error" role="alert" data-testid="branch-error">
            {error}
          </p>
        )}
        <div className="dialog-actions">
          <span className="spacer" />
          <button type="button" onClick={onClose}>
            {t('common.close')}
          </button>
        </div>
      </div>
    </Dialog>
  );
}
