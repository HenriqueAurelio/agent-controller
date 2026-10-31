// Asks the service for the pull requests of the watched repositories once a minute, keeps the
// latest answer and tells what changed that deserves a notice.
import { EventEmitter } from 'node:events';
import {
  EMPTY_PULLS_STATE,
  PIPELINE_TEXT_LIMIT,
  PULLS_INTERVAL_MS,
  type PullRequestView,
  type PullsState,
} from '@shared/pulls';
import { ForgeError, type FailedJob, type ForgeClient } from './github';

/** The share of the interval each watched repository takes, at most. */
const REPO_GAP_MS = 4000;

export type PullNoticeKind = 'failed' | 'comment' | 'review';

export interface PullNotice {
  kind: PullNoticeKind;
  pull: PullRequestView;
}

/**
 * What changed between two looks that the user wants to hear about. A repository that was not in
 * the previous look says nothing: adding it to the list is not news.
 */
export function pullNotices(
  previous: readonly PullRequestView[],
  previousRepos: ReadonlySet<string>,
  next: readonly PullRequestView[],
  login: string,
): PullNotice[] {
  const before = new Map(previous.map((p) => [p.key, p]));
  const me = login.toLowerCase();
  const notices: PullNotice[] = [];
  for (const pull of next) {
    if (!previousRepos.has(pull.repo.toLowerCase())) continue;
    const old = before.get(pull.key);
    if (pull.mine && pull.pipeline.state === 'failure') {
      // Once per commit: the same failure is not told again a minute later.
      const known = old?.pipeline.state === 'failure' && old.pipeline.sha === pull.pipeline.sha;
      if (!known) notices.push({ kind: 'failed', pull });
    }
    if (
      pull.mine &&
      old &&
      pull.comments > old.comments &&
      pull.lastCommentBy &&
      pull.lastCommentBy.toLowerCase() !== me
    ) {
      notices.push({ kind: 'comment', pull });
    }
    if (pull.reviewRequested && !old?.reviewRequested) notices.push({ kind: 'review', pull });
  }
  return notices;
}

export interface PullWatcherOptions {
  client: ForgeClient;
  intervalMs?: number;
  now?: () => number;
  describeError?: (err: unknown) => string;
}

interface Events {
  changed: [PullsState];
  notice: [PullNotice];
}

export class PullWatcher extends EventEmitter<Events> {
  private readonly client: ForgeClient;
  private readonly intervalMs: number;
  private readonly now: () => number;
  private readonly describeError: (err: unknown) => string;
  private state: PullsState = { ...EMPTY_PULLS_STATE };
  private failed: Record<string, FailedJob[]> = {};
  /** The repositories of the latest successful look, lowercased: only their news is told. */
  private seenRepos = new Set<string>();
  private repos: string[] = [];
  private account = '';
  private timer: NodeJS.Timeout | null = null;
  private running: Promise<void> | null = null;
  private again = false;
  private disposed = false;
  private lastLookAt = -Infinity;

  constructor(options: PullWatcherOptions) {
    super();
    this.client = options.client;
    this.intervalMs = options.intervalMs ?? PULLS_INTERVAL_MS;
    this.now = options.now ?? Date.now;
    this.describeError =
      options.describeError ?? ((err) => (err instanceof Error ? err.message : String(err)));
  }

  get(): PullsState {
    return this.state;
  }

  find(key: string): PullRequestView | undefined {
    return this.state.pulls.find((p) => p.key === key);
  }

  /** Which repositories, and with which account. A change looks again at once. */
  configure(settings: { repos: readonly string[]; account: string }): void {
    const repos = [...settings.repos];
    const same =
      settings.account === this.account &&
      repos.length === this.repos.length &&
      repos.every((r, i) => r === this.repos[i]);
    if (same) return;
    if (settings.account !== this.account) {
      // Another account sees other things: nothing of the previous one is news for it.
      this.seenRepos.clear();
      this.state = { ...this.state, pulls: [], login: null };
    }
    this.account = settings.account;
    this.repos = repos;
    this.client.setAccount(settings.account);
    this.state = { ...this.state, repos };
    if (this.timer || this.state.status !== 'idle') void this.refresh();
  }

  start(): void {
    if (this.timer || this.disposed) return;
    this.timer = setInterval(() => this.tick(), this.intervalMs);
    this.timer.unref?.();
    void this.refresh();
  }

  /** Looks now. A look already on its way is followed by one more, not by two. */
  refresh(): Promise<void> {
    if (this.running) {
      this.again = true;
      return this.running;
    }
    this.running = this.look().finally(() => {
      this.running = null;
      if (this.again && !this.disposed) {
        this.again = false;
        void this.refresh();
      }
    });
    return this.running;
  }

  /** The repositories the account can see, to pick from. */
  available(): Promise<string[]> {
    return this.client.available();
  }

  /** The text of `{pipeline}`: each failed job, its link and the end of its log. */
  async failureText(key: string): Promise<string> {
    const pull = this.find(key);
    const jobs = this.failed[key] ?? [];
    if (!pull || jobs.length === 0) return '';
    const parts: string[] = [];
    let size = 0;
    // The first three: past that, the rest is usually the same failure seen by other jobs.
    for (const job of jobs.slice(0, 3)) {
      const log = await this.client.jobLog(pull.repo, job).catch(() => '');
      const part = [`### ${job.name}`, job.url ?? '', log && '```\n' + log + '\n```']
        .filter(Boolean)
        .join('\n');
      if (size + part.length > PIPELINE_TEXT_LIMIT) break;
      parts.push(part);
      size += part.length + 2;
    }
    const rest = jobs.slice(parts.length).map((j) => `- ${j.name}${j.url ? ` ${j.url}` : ''}`);
    return [...parts, ...rest].join('\n\n');
  }

  dispose(): void {
    this.disposed = true;
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
    this.removeAllListeners();
  }

  private set(patch: Partial<PullsState>): void {
    this.state = { ...this.state, ...patch };
    if (!this.disposed) this.emit('changed', this.state);
  }

  /**
   * The timer's look. Each repository costs a query, and the hourly allowance of the API is shared
   * with the user's own `gh`: past fifteen repositories the looks space out.
   */
  private tick(): void {
    const gap = Math.max(this.intervalMs, this.repos.length * REPO_GAP_MS);
    if (this.now() - this.lastLookAt >= gap - 1000) void this.refresh();
  }

  private async look(): Promise<void> {
    if (this.disposed) return;
    this.lastLookAt = this.now();
    const repos = this.repos;
    // Nothing watched, nothing to ask: no `gh` runs for someone who never used the panel.
    if (repos.length === 0) {
      this.seenRepos.clear();
      this.set({
        status: 'idle',
        error: undefined,
        repos,
        repoErrors: {},
        pulls: [],
        loading: false,
      });
      return;
    }
    this.set({ loading: true });
    try {
      const result = await this.client.pulls(repos);
      if (this.disposed || repos !== this.repos) return;
      const notices = pullNotices(this.state.pulls, this.seenRepos, result.pulls, result.login);
      this.failed = result.failed;
      this.seenRepos = new Set(
        repos.filter((r) => !result.repoErrors[r]).map((r) => r.toLowerCase()),
      );
      this.set({
        status: 'ok',
        error: undefined,
        login: result.login,
        repos,
        repoErrors: result.repoErrors,
        pulls: result.pulls,
        checkedAt: this.now(),
        loading: false,
      });
      for (const notice of notices) this.emit('notice', notice);
    } catch (err) {
      if (this.disposed) return;
      // The previous answer stays on screen: a network that drops for a minute is not a void.
      this.set({
        status: err instanceof ForgeError ? err.kind : 'error',
        error: this.describeError(err),
        loading: false,
      });
    }
  }
}
