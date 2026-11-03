import { useEffect, useState } from 'react';
import type { ReviewComment } from '@shared/review';
import type { Translate } from '@shared/i18n';

/** The comments of the review of a session, kept up to date while the panel shows it. */
export function useReview(sessionId: string): ReviewComment[] {
  const [comments, setComments] = useState<ReviewComment[]>([]);
  useEffect(() => {
    let cancelled = false;
    setComments([]);
    window.api
      .invoke('review:list', sessionId)
      .then((list) => !cancelled && setComments(list))
      .catch(() => {});
    const off = window.api.on('review:changed', (id, list) => {
      if (id === sessionId) setComments(list);
    });
    return () => {
      cancelled = true;
      off();
    };
  }, [sessionId]);
  return comments;
}

/** "file, line 12" or "file, lines 12 to 15". */
export function commentPlace(
  t: Translate,
  comment: { file: string; startLine: number; endLine: number },
): string {
  return comment.startLine === comment.endLine
    ? t('review.place.line', { file: comment.file, line: comment.startLine })
    : t('review.place.lines', {
        file: comment.file,
        start: comment.startLine,
        end: comment.endLine,
      });
}
