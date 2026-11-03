import { useState } from 'react';
import { REVIEW_COMMENT_TEXT_LIMIT } from '@shared/review';
import { errorMessage } from '../lib/format';
import { useT } from '../lib/i18n';
import { commentPlace } from '../lib/review';
import { Dialog } from './Dialog';

/** A comment being written, on new lines, or one that exists (with its id). */
export interface CommentDraft {
  id?: string;
  file: string;
  startLine: number;
  endLine: number;
  snippet: string;
  text: string;
}

interface Props {
  sessionId: string;
  draft: CommentDraft;
  onClose(): void;
}

/** Writes, edits or deletes a comment of the review. */
export function ReviewCommentDialog({ sessionId, draft, onClose }: Props) {
  const t = useT();
  const [text, setText] = useState(draft.text);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const place = commentPlace(t, draft);

  const run = async (action: () => Promise<unknown>) => {
    setBusy(true);
    setError(null);
    try {
      await action();
      onClose();
    } catch (err) {
      setError(errorMessage(err));
      setBusy(false);
    }
  };
  const save = () => {
    if (!text.trim() || busy) return;
    void run(() =>
      draft.id
        ? window.api.invoke('review:update', sessionId, draft.id, text)
        : window.api.invoke('review:add', sessionId, {
            file: draft.file,
            startLine: draft.startLine,
            endLine: draft.endLine,
            snippet: draft.snippet,
            text,
          }),
    );
  };

  return (
    <Dialog
      title={draft.id ? t('review.dialog.edit', { place }) : t('review.dialog.new', { place })}
      onClose={onClose}
      className="review-comment-dialog"
    >
      <form
        className="form"
        onSubmit={(e) => {
          e.preventDefault();
          save();
        }}
      >
        {draft.snippet.trim() && <pre className="review-snippet">{draft.snippet}</pre>}
        <textarea
          data-autofocus
          data-testid="review-comment-text"
          aria-label={t('review.dialog.placeholder')}
          placeholder={t('review.dialog.placeholder')}
          value={text}
          rows={5}
          maxLength={REVIEW_COMMENT_TEXT_LIMIT}
          autoFocus
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && e.ctrlKey) {
              e.preventDefault();
              save();
            }
          }}
        />
        <p className="muted">{t('review.dialog.hint')}</p>
        {error && (
          <p className="form-error" role="alert">
            {error}
          </p>
        )}
        <div className="dialog-actions">
          {draft.id && (
            <button
              type="button"
              className="danger"
              data-testid="review-comment-delete"
              disabled={busy}
              onClick={() =>
                void run(() => window.api.invoke('review:remove', sessionId, draft.id!))
              }
            >
              {t('review.dialog.delete')}
            </button>
          )}
          <span className="spacer" />
          <button type="button" onClick={onClose}>
            {t('common.cancel')}
          </button>
          <button
            type="submit"
            className="primary"
            data-testid="review-comment-save"
            disabled={busy || !text.trim()}
          >
            {t('review.dialog.save')}
          </button>
        </div>
      </form>
    </Dialog>
  );
}
