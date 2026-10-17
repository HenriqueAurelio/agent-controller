import { useEffect, useState } from 'react';
import type { CheckpointInfo, CheckpointList } from '@shared/checkpoints';
import type { Translate } from '@shared/i18n';

/** How a checkpoint is named in the timeline, the panel and the note to the agent. */
export function checkpointLabel(t: Translate, checkpoint: CheckpointInfo): string {
  if (checkpoint.kind === 'start') return t('timeline.kind.start');
  if (checkpoint.kind === 'restore') {
    return t('timeline.kind.restore', { turn: checkpoint.restoredTo ?? checkpoint.turn });
  }
  return t('timeline.kind.turn', { turn: checkpoint.turn });
}

/** The timeline of a session, kept up to date while the component lives. Null while loading. */
export function useCheckpoints(sessionId: string | null, cwd?: string): CheckpointList | null {
  const [list, setList] = useState<CheckpointList | null>(null);
  useEffect(() => {
    setList(null);
    if (!sessionId) return;
    let cancelled = false;
    const load = () =>
      void window.api
        .invoke('checkpoints:list', sessionId)
        .then((next) => !cancelled && setList(next))
        .catch(() => !cancelled && setList({ available: false, items: [] }));
    load();
    const off = window.api.on('checkpoints:changed', (id) => id === sessionId && load());
    return () => {
      cancelled = true;
      off();
    };
    // Another folder is another repository, with other checkpoints.
  }, [sessionId, cwd]);
  return list;
}
