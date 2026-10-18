import { useEffect, useRef, useState } from 'react';
import { isFailure, type CheckResult, type ChecksRun, type Problem } from '@shared/checks';

export interface ProblemsState {
  /** The checks of the folder are not set up: there is nothing to wait for. */
  hasChecks: boolean;
  /** The problems of the last run that went to the end, in the order the checks ran. */
  problems: Problem[];
  /** How many more the checks found than they kept. */
  more: number;
  /** Failed checks whose output the app could not read into problems: shown whole. */
  unread: CheckResult[];
  /** A run is going on now; the list is still the one before it. */
  running: boolean;
  /** There has been a run to show (even one without problems). */
  ran: boolean;
}

interface Snapshot {
  problems: Problem[];
  more: number;
  unread: CheckResult[];
}

const EMPTY: ProblemsState = {
  hasChecks: false,
  problems: [],
  more: 0,
  unread: [],
  running: false,
  ran: false,
};

function snapshotOf(run: ChecksRun): Snapshot {
  return {
    problems: run.results.flatMap((r) => r.problems),
    more: run.results.reduce((sum, r) => sum + r.moreProblems, 0),
    unread: run.results.filter((r) => isFailure(r.outcome) && r.problems.length === 0),
  };
}

/**
 * The problems of the latest run of the checks of a session. A run that is cut short (the agent
 * went back to work) or is still going does not wipe the list: it stays until a run ends.
 */
export function useProblems(sessionId: string): ProblemsState {
  const [state, setState] = useState<ProblemsState>(EMPTY);
  const shown = useRef<Snapshot | null>(null);

  useEffect(() => {
    let cancelled = false;
    shown.current = null;
    setState(EMPTY);
    const load = () =>
      window.api
        .invoke('checks:get', sessionId)
        .then((info) => {
          if (cancelled) return;
          const run = info.run;
          const running = run?.state === 'queued' || run?.state === 'running';
          if (run && (run.state === 'done' || (run.state === 'cancelled' && !shown.current))) {
            shown.current = snapshotOf(run);
          }
          setState({
            hasChecks: info.checks.length > 0,
            ...(shown.current ?? { problems: [], more: 0, unread: [] }),
            running,
            ran: shown.current !== null,
          });
        })
        .catch(() => {});
    void load();
    const off = window.api.on('checks:changed', (id) => id === sessionId && void load());
    return () => {
      cancelled = true;
      off();
    };
  }, [sessionId]);

  return state;
}
