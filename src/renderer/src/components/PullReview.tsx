import { Fragment, useCallback, useEffect, useMemo, useState } from 'react';
import type { HunkLine } from '@shared/git';
import type {
  MergeState,
  PullFile,
  PullReviewData,
  PullThread,
  ReviewDraftComment,
  ReviewVerdict,
} from '@shared/pullReview';
import type { Forge } from '@shared/pulls';
import { errorMessage } from '../lib/format';
import { useT } from '../lib/i18n';

interface Props {
  pullKey: string;
  forge: Forge;
  onBack(): void;
}

const FILE_LETTER = { added: 'A', modified: 'M', removed: 'D', renamed: 'R' } as const;

/** Where a comment goes: a line of the new side, or of the old one for a removed line. */
interface Spot {
  path: string;
  line: number;
  oldSide: boolean;
}

const spotOf = (path: string, line: HunkLine): Spot | null =>
  line.kind === 'del'
    ? line.oldNo !== undefined
      ? { path, line: line.oldNo, oldSide: true }
      : null
    : line.newNo !== undefined
      ? { path, line: line.newNo, oldSide: false }
      : null;

const sameSpot = (a: Spot, b: { path: string | null; line: number | null; oldSide?: boolean }) =>
  a.path === b.path && a.line === b.line && a.oldSide === (b.oldSide === true);

const openSite = (url: string) => void window.api.invoke('shell:openExternal', url);

/** A pull request reviewed inside the app: its changes, the comments on it, and the answer. */
export function PullReview({ pullKey, forge, onBack }: Props) {
  const t = useT();
  const [data, setData] = useState<PullReviewData | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [reloads, setReloads] = useState(0);
  const [drafts, setDrafts] = useState<ReviewDraftComment[]>([]);
  const [composing, setComposing] = useState<Spot | null>(null);
  const [composed, setComposed] = useState('');
  const [summary, setSummary] = useState('');
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<{ ok: boolean; text: string } | null>(null);
  const [deleteBranch, setDeleteBranch] = useState(true);

  useEffect(() => {
    let cancelled = false;
    window.api
      .invoke('pulls:review', pullKey)
      .then((result) => {
        if (cancelled) return;
        setData(result);
        setError(null);
      })
      .catch((err) => !cancelled && setError(errorMessage(err)));
    return () => {
      cancelled = true;
    };
  }, [pullKey, reloads]);

  const placed = useMemo(() => {
    const files = new Set(data?.files.map((f) => f.path));
    return new Set(
      data?.threads
        .filter((th) => th.path && th.line !== null && files.has(th.path))
        .map((th) => th.id),
    );
  }, [data]);
  const loose = data?.threads.filter((th) => !placed.has(th.id)) ?? [];

  const addDraft = () => {
    if (!composing || !composed.trim()) return;
    setDrafts((list) => [
      ...list,
      {
        path: composing.path,
        line: composing.line,
        ...(composing.oldSide ? { oldSide: true } : {}),
        body: composed.trim(),
      },
    ]);
    setComposing(null);
    setComposed('');
  };

  const run = useCallback(async (action: () => Promise<unknown>, done: string) => {
    setBusy(true);
    setNotice(null);
    try {
      await action();
      setNotice({ ok: true, text: done });
      return true;
    } catch (err) {
      setNotice({ ok: false, text: errorMessage(err) });
      return false;
    } finally {
      setBusy(false);
    }
  }, []);

  const submit = async (verdict: ReviewVerdict) => {
    if (!data) return;
    const ok = await run(
      () =>
        window.api.invoke('pulls:submitReview', pullKey, {
          verdict,
          body: summary,
          comments: drafts,
          headSha: data.headSha,
        }),
      t(`pullReview.sent.${verdict}`),
    );
    if (!ok) return;
    setDrafts([]);
    setSummary('');
    setReloads((n) => n + 1);
  };

  const merge = async () => {
    if (!data || !window.confirm(t('pullReview.merge.confirm', { title: data.title }))) return;
    const ok = await run(
      () => window.api.invoke('pulls:merge', pullKey, { squash: true, deleteBranch }),
      t('pullReview.merge.done'),
    );
    if (ok) setReloads((n) => n + 1);
  };

  const threadsAt = (spot: Spot) =>
    data?.threads.filter((th) => placed.has(th.id) && sameSpot(spot, th)) ?? [];

  const renderThread = (thread: PullThread) => (
    <div
      key={thread.id}
      className={`pull-thread ${thread.resolved ? 'resolved' : ''}`}
      data-testid="pull-thread"
    >
      {thread.resolved && <span className="pull-tag">{t('pullReview.resolved')}</span>}
      {thread.comments.map((comment, index) => (
        <div key={index} className="pull-thread-comment">
          <strong>{comment.author}</strong> <span className="pull-thread-body">{comment.body}</span>
        </div>
      ))}
    </div>
  );

  const renderFile = (file: PullFile) => (
    <section
      key={file.path}
      className="multidiff-file"
      data-testid="pull-review-file"
      data-path={file.path}
    >
      <header className="multidiff-file-header">
        <span className={`change-kind kind-${file.status}`}>{FILE_LETTER[file.status]}</span>
        <span className="multidiff-path" title={file.path}>
          {file.oldPath ? `${file.oldPath} → ${file.path}` : file.path}
        </span>
      </header>
      {file.noPatch && <p className="multidiff-note muted">{t('pullReview.noPatch')}</p>}
      {file.hunks.map((hunk) => (
        <div key={hunk.id} className="multidiff-hunk">
          <div className="multidiff-lines" role="presentation">
            {hunk.lines.map((line, index) => {
              const spot = spotOf(file.path, line);
              const here = spot ? threadsAt(spot) : [];
              const mine = spot ? drafts.filter((d) => sameSpot(spot, d)) : [];
              const open = spot && composing && sameSpot(spot, composing);
              return (
                <Fragment key={index}>
                  <div
                    className={`multidiff-line line-${line.kind} commentable`}
                    data-kind={line.kind}
                    data-new={line.newNo}
                    data-old={line.oldNo}
                  >
                    {spot && (
                      <button
                        className="line-plus"
                        data-testid="pull-review-plus"
                        aria-label={t('pullReview.commentLine', { line: spot.line })}
                        title={t('pullReview.commentLine', { line: spot.line })}
                        onClick={() => {
                          setComposing(spot);
                          setComposed('');
                        }}
                      >
                        +
                      </button>
                    )}
                    <span className="multidiff-no">{line.oldNo ?? ''}</span>
                    <span className="multidiff-no">{line.newNo ?? ''}</span>
                    <span className="multidiff-sign">
                      {line.kind === 'add' ? '+' : line.kind === 'del' ? '-' : ' '}
                    </span>
                    <span className="multidiff-text">{line.text}</span>
                  </div>
                  {here.map(renderThread)}
                  {mine.map((draft) => (
                    <div
                      key={drafts.indexOf(draft)}
                      className="pull-draft"
                      data-testid="pull-draft"
                    >
                      <span className="pull-tag">{t('pullReview.draft')}</span>
                      <span className="pull-thread-body">{draft.body}</span>
                      <button
                        className="icon-button"
                        aria-label={t('pullReview.removeDraft')}
                        title={t('pullReview.removeDraft')}
                        onClick={() => setDrafts((list) => list.filter((d) => d !== draft))}
                      >
                        ×
                      </button>
                    </div>
                  ))}
                  {open && (
                    <div className="pull-compose">
                      <textarea
                        autoFocus
                        data-testid="pull-review-compose"
                        aria-label={t('pullReview.composeLabel')}
                        placeholder={t('pullReview.composeLabel')}
                        rows={3}
                        value={composed}
                        onChange={(e) => setComposed(e.target.value)}
                        onKeyDown={(e) => {
                          if (e.key === 'Enter' && e.ctrlKey) {
                            e.preventDefault();
                            addDraft();
                          } else if (e.key === 'Escape') {
                            e.stopPropagation();
                            setComposing(null);
                          }
                        }}
                      />
                      <div className="pull-compose-actions">
                        <button onClick={() => setComposing(null)}>{t('common.cancel')}</button>
                        <button
                          className="primary"
                          data-testid="pull-review-add"
                          disabled={!composed.trim()}
                          onClick={addDraft}
                        >
                          {t('pullReview.addDraft')}
                        </button>
                      </div>
                    </div>
                  )}
                </Fragment>
              );
            })}
          </div>
        </div>
      ))}
    </section>
  );

  const mergeText = (state: MergeState) => t(`pullReview.merge.state.${state}`);

  return (
    <div
      className="pull-review"
      data-testid="pull-review"
      onKeyDown={(e) => {
        if (e.key === 'Escape' && !composing) {
          e.stopPropagation();
          onBack();
        }
      }}
    >
      <header className="pull-review-header">
        <button onClick={onBack} data-testid="pull-review-back">
          ← {t('pullReview.back')}
        </button>
        {data && (
          <>
            <span className="pull-review-title" title={data.title}>
              {data.title}
            </span>
            <span className="muted">
              {t('pulls.by', { author: data.author, branch: data.branch, base: data.base })}
            </span>
            <span className="spacer" />
            <button onClick={() => setReloads((n) => n + 1)} disabled={busy}>
              {t('pullReview.reload')}
            </button>
            <button onClick={() => openSite(data.url)}>
              {t('pulls.openSite', { service: t(`pulls.forge.${forge}`) })}
            </button>
          </>
        )}
      </header>
      {error && <div className="panel-message error">{error}</div>}
      {!error && !data && <div className="panel-message">{t('pullReview.loading')}</div>}
      {data && (
        <>
          <div className="multidiff-scroll">
            {data.files.map(renderFile)}
            {data.truncated && <p className="multidiff-note muted">{t('pullReview.truncated')}</p>}
            {loose.length > 0 && (
              <section className="pull-loose" data-testid="pull-review-loose">
                <h3>{t('pullReview.otherComments')}</h3>
                {loose.map((thread) => (
                  <div key={thread.id}>
                    {thread.path && (
                      <div className="muted pull-loose-place">
                        {thread.line ? `${thread.path}:${thread.line}` : thread.path}
                      </div>
                    )}
                    {renderThread(thread)}
                  </div>
                ))}
              </section>
            )}
          </div>
          <footer className="pull-review-footer">
            {notice && (
              <div
                className={notice.ok ? 'pull-review-notice' : 'pull-review-notice error'}
                role={notice.ok ? 'status' : 'alert'}
                data-testid="pull-review-notice"
              >
                {notice.text}
              </div>
            )}
            <textarea
              data-testid="pull-review-summary"
              aria-label={t('pullReview.summary')}
              placeholder={t('pullReview.summary')}
              rows={2}
              value={summary}
              onChange={(e) => setSummary(e.target.value)}
            />
            <div className="pull-review-actions">
              <span className="muted" data-testid="pull-review-count">
                {drafts.length === 1
                  ? t('pullReview.draftOne')
                  : t('pullReview.drafts', { count: drafts.length })}
              </span>
              <span className="spacer" />
              <button
                data-testid="pull-review-comment"
                disabled={busy || (drafts.length === 0 && !summary.trim())}
                onClick={() => void submit('COMMENT')}
              >
                {t('pullReview.verdict.COMMENT')}
              </button>
              <button
                data-testid="pull-review-changes"
                disabled={busy || data.mine || (drafts.length === 0 && !summary.trim())}
                title={
                  data.mine
                    ? t('pullReview.ownPull')
                    : forge === 'gitlab'
                      ? t('pullReview.changesGitLab')
                      : undefined
                }
                onClick={() => void submit('REQUEST_CHANGES')}
              >
                {t('pullReview.verdict.REQUEST_CHANGES')}
              </button>
              <button
                className="primary"
                data-testid="pull-review-approve"
                disabled={busy || data.mine}
                title={data.mine ? t('pullReview.ownPull') : undefined}
                onClick={() => void submit('APPROVE')}
              >
                {t('pullReview.verdict.APPROVE')}
              </button>
            </div>
            <div className="pull-review-actions">
              <span
                className={`pull-tag merge-${data.merge}`}
                data-testid="pull-review-merge-state"
                data-state={data.merge}
              >
                {mergeText(data.merge)}
              </span>
              <span className="spacer" />
              <label className="check">
                <input
                  type="checkbox"
                  checked={deleteBranch}
                  onChange={(e) => setDeleteBranch(e.target.checked)}
                />
                {t('pullReview.merge.deleteBranch')}
              </label>
              <button
                className="danger"
                data-testid="pull-review-merge"
                disabled={busy || data.merge !== 'ready'}
                onClick={() => void merge()}
              >
                {t('pullReview.merge.button')}
              </button>
            </div>
          </footer>
        </>
      )}
    </div>
  );
}
