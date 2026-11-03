import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  CHANGE_LETTER,
  type DiffBase,
  type DiffHunk,
  type FileHunks,
  type MultiDiff,
} from '@shared/git';
import type { ReviewComment } from '@shared/review';
import { errorMessage } from '../lib/format';
import { useT } from '../lib/i18n';
import { ReviewCommentDialog, type CommentDraft } from './ReviewCommentDialog';

interface Props {
  sessionId: string;
  base: DiffBase;
  /** Bumped when the panel reloads the list: the blocks are read again. */
  revision: number;
  comments: ReviewComment[];
  /** The agent is working: undoing a block asks once more. */
  agentWorking: boolean;
  onOpenFile(path: string, line: number): void;
}

// What was marked as seen, by session, while the app runs. A block is known by its content, so
// one the agent changes again shows again.
const seenBySession = new Map<string, Set<string>>();
const seenOf = (sessionId: string) => {
  let set = seenBySession.get(sessionId);
  if (!set) seenBySession.set(sessionId, (set = new Set()));
  return set;
};

/** Where a block is, on the side of the file as it is now. */
function changedRange(hunk: DiffHunk): { start: number; end: number; removedOnly: boolean } {
  const added = hunk.lines.filter((l) => l.kind === 'add' && l.newNo !== undefined);
  if (added.length > 0) {
    return { start: added[0]!.newNo!, end: added[added.length - 1]!.newNo!, removedOnly: false };
  }
  // Only removed lines: the place is the line that now follows them.
  const first = hunk.lines.findIndex((l) => l.kind === 'del');
  const after = hunk.lines.slice(first).find((l) => l.newNo !== undefined)?.newNo;
  const before = hunk.lines
    .slice(0, first)
    .reverse()
    .find((l) => l.newNo !== undefined)?.newNo;
  const line = Math.max(1, after ?? (before !== undefined ? before + 1 : hunk.newStart));
  return { start: line, end: line, removedOnly: true };
}

/** Every changed block of every file, in one scroll: seen, undone or commented one by one. */
export function MultiDiffView({
  sessionId,
  base,
  revision,
  comments,
  agentWorking,
  onOpenFile,
}: Props) {
  const t = useT();
  const [data, setData] = useState<MultiDiff | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [seen, setSeen] = useState<ReadonlySet<string>>(() => new Set(seenOf(sessionId)));
  const [showSeen, setShowSeen] = useState(false);
  const [draft, setDraft] = useState<CommentDraft | null>(null);
  const [reloads, setReloads] = useState(0);

  useEffect(() => {
    let cancelled = false;
    window.api
      .invoke('git:hunks', sessionId, base)
      .then((result) => {
        if (cancelled) return;
        setData(result);
        setError(null);
      })
      .catch((err) => !cancelled && setError(errorMessage(err)));
    return () => {
      cancelled = true;
    };
  }, [sessionId, base, revision, reloads]);

  const mark = useCallback(
    (ids: string[], value: boolean) => {
      const store = seenOf(sessionId);
      for (const id of ids) {
        if (value) store.add(id);
        else store.delete(id);
      }
      setSeen(new Set(store));
    },
    [sessionId],
  );

  const all = useMemo(() => data?.files.flatMap((f) => f.hunks) ?? [], [data]);
  const seenCount = all.filter((h) => seen.has(h.id)).length;

  const revert = async (file: FileHunks, hunk: DiffHunk) => {
    const question = [
      t('all.revertConfirm', { file: file.path }),
      ...(agentWorking ? [t('changes.agentWorking')] : []),
    ].join('\n\n');
    if (!window.confirm(question)) return;
    setActionError(null);
    try {
      await window.api.invoke('git:revertHunk', sessionId, base, {
        file: file.path,
        newStart: hunk.newStart,
        before: hunk.lines.filter((l) => l.kind !== 'add').map((l) => l.text),
        after: hunk.lines.filter((l) => l.kind !== 'del').map((l) => l.text),
      });
    } catch (err) {
      setActionError(errorMessage(err));
      setReloads((n) => n + 1);
    }
  };

  const comment = (file: FileHunks, hunk: DiffHunk) => {
    const range = changedRange(hunk);
    const snippet = hunk.lines
      .filter(
        (l) =>
          l.kind !== 'del' &&
          l.newNo !== undefined &&
          l.newNo >= range.start &&
          l.newNo <= range.end,
      )
      .map((l) => l.text)
      .join('\n');
    setDraft({ file: file.path, startLine: range.start, endLine: range.end, snippet, text: '' });
  };

  if (error) return <div className="panel-message error">{error}</div>;
  if (!data) return <div className="panel-message">{t('all.loading')}</div>;
  if (all.length === 0 && !data.files.some((f) => f.skipped)) {
    return <div className="panel-message">{t('all.none')}</div>;
  }

  return (
    <div className="multidiff" data-testid="multidiff">
      <div className="multidiff-toolbar">
        <span data-testid="multidiff-seen">
          {t('all.seen', { seen: seenCount, total: all.length })}
        </span>
        {all.length > 0 && seenCount === all.length && (
          <span className="multidiff-done">{t('all.allSeen')}</span>
        )}
        <span className="spacer" />
        <label className="check">
          <input
            type="checkbox"
            checked={showSeen}
            onChange={(e) => setShowSeen(e.target.checked)}
          />
          {t('all.showSeen')}
        </label>
      </div>
      {actionError && (
        <div className="diff-conflict" role="alert">
          {actionError}
        </div>
      )}
      <div className="multidiff-scroll">
        {data.files.map((file) => {
          const pending = file.hunks.filter((h) => !seen.has(h.id));
          const visible = showSeen ? file.hunks : pending;
          return (
            <section
              key={file.path}
              className="multidiff-file"
              data-testid="multidiff-file"
              data-path={file.path}
            >
              <header className="multidiff-file-header">
                <span className={`change-kind kind-${file.kind}`}>{CHANGE_LETTER[file.kind]}</span>
                <span className="multidiff-path" title={file.path}>
                  {file.origPath ? `${file.origPath} → ${file.path}` : file.path}
                </span>
                <span className="muted">
                  {file.hunks.length === 1
                    ? t('all.hunkOne')
                    : t('all.hunkCount', { count: file.hunks.length })}
                </span>
                <span className="spacer" />
                {pending.length > 0 && (
                  <button
                    data-testid="multidiff-file-seen"
                    title={t('all.markFileSeenHint')}
                    onClick={() =>
                      mark(
                        file.hunks.map((h) => h.id),
                        true,
                      )
                    }
                  >
                    ✓ {t('all.markFileSeen')}
                  </button>
                )}
                {file.kind !== 'removed' && (
                  <button
                    title={t('all.openFileHint')}
                    onClick={() => onOpenFile(file.path, file.hunks[0]?.newStart ?? 1)}
                  >
                    {t('all.openFile')}
                  </button>
                )}
              </header>
              {file.skipped && (
                <p className="multidiff-note muted">
                  {file.skipped === 'binary' ? t('all.skipped.binary') : t('all.skipped.tooLarge')}
                </p>
              )}
              {visible.map((hunk) => {
                const range = changedRange(hunk);
                const isSeen = seen.has(hunk.id);
                const notes = comments.filter(
                  (c) =>
                    c.file === file.path && c.startLine <= range.end && c.endLine >= range.start,
                );
                return (
                  <div
                    key={hunk.id}
                    className={`multidiff-hunk ${isSeen ? 'seen' : ''}`}
                    data-testid="multidiff-hunk"
                    data-seen={isSeen}
                  >
                    <div className="multidiff-hunk-header">
                      <span className="muted">
                        {range.removedOnly
                          ? t('all.hunk.removed', { line: range.start })
                          : range.start === range.end
                            ? t('all.hunk.line', { line: range.start })
                            : t('all.hunk.lines', { start: range.start, end: range.end })}
                      </span>
                      <span className="spacer" />
                      <button
                        data-testid="multidiff-comment"
                        title={t('all.commentHint')}
                        onClick={() => comment(file, hunk)}
                      >
                        {t('all.comment')}
                      </button>
                      <button
                        data-testid="multidiff-revert"
                        disabled={!file.revertible}
                        title={file.revertible ? t('all.revertHint') : t('all.revertDisabled')}
                        onClick={() => void revert(file, hunk)}
                      >
                        ↺ {t('all.revert')}
                      </button>
                      <button
                        data-testid="multidiff-accept"
                        className={isSeen ? '' : 'primary'}
                        title={isSeen ? t('all.unacceptHint') : t('all.acceptHint')}
                        onClick={() => mark([hunk.id], !isSeen)}
                      >
                        {isSeen ? t('all.unaccept') : `✓ ${t('all.accept')}`}
                      </button>
                    </div>
                    <div className="multidiff-lines" role="presentation">
                      {hunk.lines.map((line, index) => (
                        <div
                          key={index}
                          className={`multidiff-line line-${line.kind}`}
                          data-kind={line.kind}
                        >
                          <span className="multidiff-no">{line.oldNo ?? ''}</span>
                          <span className="multidiff-no">{line.newNo ?? ''}</span>
                          <span className="multidiff-sign">
                            {line.kind === 'add' ? '+' : line.kind === 'del' ? '-' : ' '}
                          </span>
                          <span className="multidiff-text">{line.text}</span>
                        </div>
                      ))}
                    </div>
                    {notes.map((note) => (
                      <button
                        key={note.id}
                        className="multidiff-comment"
                        data-testid="multidiff-note"
                        onClick={() => setDraft({ ...note })}
                      >
                        {note.text}
                      </button>
                    ))}
                  </div>
                );
              })}
            </section>
          );
        })}
        {data.truncated && (
          <p className="multidiff-note muted">{t('all.truncated', { count: data.files.length })}</p>
        )}
      </div>
      {draft && (
        <ReviewCommentDialog sessionId={sessionId} draft={draft} onClose={() => setDraft(null)} />
      )}
    </div>
  );
}
