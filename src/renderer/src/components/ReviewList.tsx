import { useMemo } from 'react';
import { commentsOf, type ReviewComment } from '@shared/review';
import { useT } from '../lib/i18n';
import { commentPlace } from '../lib/review';

interface Props {
  sessionId: string;
  comments: ReviewComment[];
  /** The comment whose file is open in the editor. */
  current: string | null;
  onOpen(comment: ReviewComment): void;
  onSend(): void;
}

/** The comments of the review, by file: open one in the editor, or send them all to the agent. */
export function ReviewList({ sessionId, comments, current, onOpen, onSend }: Props) {
  const t = useT();
  const files = useMemo(() => {
    const order: string[] = [];
    for (const c of [...comments].sort((a, b) => a.createdAt - b.createdAt)) {
      if (!order.includes(c.file)) order.push(c.file);
    }
    return order.map((file) => ({ file, comments: commentsOf(comments, file) }));
  }, [comments]);

  const clear = () => {
    if (!window.confirm(t('review.clearConfirm', { count: comments.length }))) return;
    void window.api.invoke('review:clear', sessionId).catch(() => {});
  };

  return (
    <div
      className="changes-list problems-list review-list"
      data-testid="review-list"
      aria-label={t('review.tab')}
    >
      <div className="problems-toolbar">
        <button
          className="primary"
          data-testid="review-send"
          disabled={comments.length === 0}
          title={t('review.sendHint')}
          onClick={onSend}
        >
          {t('review.send', { count: comments.length })}
        </button>
        <span className="spacer" />
        {comments.length > 0 && (
          <button data-testid="review-clear" onClick={clear}>
            {t('review.clear')}
          </button>
        )}
      </div>

      <div className="problems-groups">
        {comments.length === 0 && (
          <div className="problems-note muted">
            <strong>{t('review.empty.title')}</strong>
            <p>{t('review.empty.body')}</p>
          </div>
        )}
        {files.map((group) => (
          <section key={group.file} className="problems-file" data-testid="review-file">
            <h3 title={group.file}>
              <span className="problems-file-name">{group.file}</span>
              <span className="count">{group.comments.length}</span>
            </h3>
            <ul>
              {group.comments.map((comment) => {
                const place = commentPlace(t, comment);
                return (
                  <li
                    key={comment.id}
                    className={`problem-row review-row ${current === comment.id ? 'current' : ''}`}
                    data-testid="review-row"
                  >
                    <button
                      className="problem-open"
                      data-testid="review-open"
                      title={place}
                      onClick={() => onOpen(comment)}
                    >
                      <span className="problem-icon review-icon" aria-hidden="true">
                        ●
                      </span>
                      <span className="problem-message">{comment.text}</span>
                      <span className="problem-where">
                        {comment.startLine === comment.endLine
                          ? comment.startLine
                          : `${comment.startLine}–${comment.endLine}`}
                      </span>
                    </button>
                    <span className="problem-actions">
                      <button
                        className="icon-button"
                        data-testid="review-remove"
                        title={t('review.remove', { place })}
                        aria-label={t('review.remove', { place })}
                        onClick={() =>
                          void window.api
                            .invoke('review:remove', sessionId, comment.id)
                            .catch(() => {})
                        }
                      >
                        ×
                      </button>
                    </span>
                  </li>
                );
              })}
            </ul>
          </section>
        ))}
      </div>
    </div>
  );
}
