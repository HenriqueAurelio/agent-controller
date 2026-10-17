import type { SessionStatus } from '@shared/session';

/**
 * What a change of state means for the work of the agent: a turn that ended, which is when the
 * folder is photographed and checked, or a turn that started, which makes any check stale.
 * Repeated signals of the same state (a hook and the title both saying "done") are one edge.
 */
export function turnEdge(
  status: Pick<SessionStatus, 'state'>,
  previous: Pick<SessionStatus, 'state'>,
): 'ended' | 'started' | null {
  if (status.state === 'terminou' && previous.state !== 'terminou') return 'ended';
  if (status.state === 'trabalhando' && previous.state !== 'trabalhando') return 'started';
  return null;
}
