import { useEffect, useState } from 'react';
import type { OverlapFile, OverlapSummary } from '@shared/overlaps';
import type { SessionView } from '@shared/session';
import type { useT } from './i18n';

type T = ReturnType<typeof useT>;

/** “refatorar-ipc”, “testes”: the sessions named as the list names them, gone ones left out. */
export function sessionNames(t: T, ids: readonly string[], sessions: readonly SessionView[]) {
  return ids
    .map((id) => sessions.find((s) => s.id === id)?.name)
    .filter((name): name is string => name !== undefined)
    .map((name) => t('overlap.name', { name }))
    .join(', ');
}

export function overlapBadgeText(
  t: T,
  summary: OverlapSummary,
  sessions: readonly SessionView[],
): string {
  const names = sessionNames(t, summary.sessionIds, sessions);
  return summary.likely > 0
    ? t('overlap.badgeLikely', { count: summary.files, names, likely: summary.likely })
    : t('overlap.badge', { count: summary.files, names });
}

/** The files of a session that others also changed, kept in step with the main process. */
export function useOverlaps(sessionId: string, summary: OverlapSummary | undefined) {
  const [files, setFiles] = useState<OverlapFile[]>([]);
  const any = summary !== undefined;
  useEffect(() => {
    if (!any) {
      setFiles([]);
      return;
    }
    let cancelled = false;
    const load = () =>
      window.api
        .invoke('git:overlaps', sessionId)
        .then((found) => !cancelled && setFiles(found))
        .catch(() => {});
    void load();
    const off = window.api.on('git:overlapsChanged', (id) => {
      if (id === sessionId) void load();
    });
    return () => {
      cancelled = true;
      off();
    };
  }, [sessionId, any]);
  return files;
}
