// What every service of repositories (GitHub, GitLab) gives the watcher, whatever its API.
import type { PullRequestView } from '@shared/pulls';

/** Why the service could not be read; the watcher turns it into the state the panel shows. */
export class ForgeError extends Error {
  /** The service gave up on a query that was too heavy: a smaller one may go. */
  timedOut = false;

  constructor(
    readonly kind: 'noCli' | 'loggedOut' | 'error',
    message: string,
    /** The GitLab server it is about, when there are many. */
    readonly host?: string,
  ) {
    super(message);
    this.name = 'ForgeError';
  }
}

/** A failed job and where its log is, for the prompt that sends it to an agent. */
export interface FailedJob {
  name: string;
  url: string | null;
  /** The id the service reads the log by; null when there is no log to read. */
  logId: number | null;
  /** GitLab: the project the job ran in, a fork's when the merge request comes from one. */
  project?: string;
}

export interface ForgePulls {
  login: string;
  pulls: PullRequestView[];
  /** The failed jobs of each pull request, by key. */
  failed: Record<string, FailedJob[]>;
  repoErrors: Record<string, string>;
}

/** What the watcher needs of a service. */
export interface ForgeClient {
  pulls(repos: readonly string[]): Promise<ForgePulls>;
  /** Repositories the account can see, the latest active first. `watched` names the servers. */
  available(watched: readonly string[]): Promise<string[]>;
  /** The last lines of the log of a job. */
  jobLog(repo: string, job: FailedJob): Promise<string>;
  /** The account to read with; empty for the active one. */
  setAccount(account: string): void;
}

/** Repositories asked at the same time. */
export const PARALLEL = 4;

/**
 * Runs `ask` for each repository, a few at a time, and puts the answers together. One that fails
 * becomes an error of its own; a missing login or tool fails the whole look, unless `lenient`,
 * where it only does when nothing at all could be read (GitLab, whose servers log in apart).
 */
export async function eachRepo(
  repos: readonly string[],
  ask: (repo: string) => Promise<ForgePulls>,
  lenient = false,
): Promise<ForgePulls> {
  const results: (ForgePulls | ForgeError)[] = new Array(repos.length);
  let next = 0;
  const worker = async () => {
    while (next < repos.length) {
      const index = next++;
      results[index] = await ask(repos[index]!).catch((err: unknown) =>
        err instanceof ForgeError ? err : new ForgeError('error', String(err)),
      );
    }
  };
  await Promise.all(Array.from({ length: Math.min(PARALLEL, repos.length) }, worker));
  const done = results.filter((r): r is ForgePulls => !(r instanceof ForgeError));
  const failed = results.filter((r): r is ForgeError => r instanceof ForgeError);
  // Without a login or with no answer at all, there is nothing to show of any repository.
  const fatal = failed.find((e) => e.kind !== 'error');
  if (fatal && (!lenient || done.length === 0)) throw fatal;
  if (done.length === 0) throw failed[0]!;
  const merged: ForgePulls = {
    login: done.find((d) => d.login)?.login ?? '',
    pulls: [],
    failed: {},
    repoErrors: {},
  };
  results.forEach((result, index) => {
    if (result instanceof ForgeError) {
      merged.repoErrors[repos[index]!] = result.message;
      return;
    }
    merged.pulls.push(...result.pulls);
    Object.assign(merged.failed, result.failed);
    Object.assign(merged.repoErrors, result.repoErrors);
  });
  merged.pulls.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  return merged;
}
