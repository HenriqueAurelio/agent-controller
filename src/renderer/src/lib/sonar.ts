import { useEffect, useState } from 'react';
import type { SonarRun } from '@shared/sonar';

/** The latest Sonar analysis of every session, kept up to date. */
export function useSonarRuns(): Record<string, SonarRun> {
  const [runs, setRuns] = useState<Record<string, SonarRun>>({});
  useEffect(() => {
    let cancelled = false;
    window.api
      .invoke('sonar:runs')
      .then((all) => !cancelled && setRuns(all))
      .catch(() => {});
    const off = window.api.on('sonar:changed', (sessionId, run) =>
      setRuns((current) => {
        const next = { ...current };
        if (run) next[sessionId] = run;
        else delete next[sessionId];
        return next;
      }),
    );
    return () => {
      cancelled = true;
      off();
    };
  }, []);
  return runs;
}

/** An analysis that has not ended yet. */
export const sonarBusy = (run: SonarRun | undefined) =>
  run?.status === 'queued' || run?.status === 'running' || run?.status === 'processing';
