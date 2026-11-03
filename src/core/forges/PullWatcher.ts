// Asks each service for the pull requests of the watched repositories once a minute, keeps the
// latest answer and tells what changed that deserves a notice.
import { EventEmitter } from 'node:events';
import {
  EMPTY_PULLS_STATE,
  type AvailableRepos,
  type GhAccounts,
  forgeOf,
  PIPELINE_TEXT_LIMIT,
  PULLS_INTERVAL_MS,
  type Forge,
  type ForgeIssue,
  type ForgeProblem,
  type PullRequestView,
  type PullsState,
} from '@shared/pulls';
import { ForgeError, type FailedJob, type ForgeClient, type ForgePulls } from './forge';
import { isIssueClient, isPullCreator, isReviewClient, type ReviewClient } from './review';
import { UserError } from '@shared/i18n';
import type {
  MergeOptions,
  NewPull,
  OpenedPull,
  PullReviewData,
  ReviewSubmission,
} from '@shared/pullReview';

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
  logins: Partial<Record<Forge, string>>,
): PullNotice[] {
  const before = new Map(previous.map((p) => [p.key, p]));
  const notices: PullNotice[] = [];
  for (const pull of next) {
    if (!previousRepos.has(pull.repo.toLowerCase())) continue;
    const me = (logins[pull.forge] ?? '').toLowerCase();
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
  clients: Partial<Record<Forge, ForgeClient>>;
  intervalMs?: number;
  now?: () => number;
  describeError?: (err: unknown) => string;
}

interface Events {
  changed: [PullsState];
  notice: [PullNotice];
}

type Answer =
  | { forge: Forge; repos: string[]; result: ForgePulls }
  | { forge: Forge; repos: string[]; error: unknown };

const byUpdate = (a: PullRequestView, b: PullRequestView) => b.updatedAt.localeCompare(a.updatedAt);

export class PullWatcher extends EventEmitter<Events> {
  private readonly clients: Partial<Record<Forge, ForgeClient>>;
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
    this.clients = options.clients;
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

  /** Which repositories, and with which account of `gh`. A change looks again at once. */
  configure(settings: { repos: readonly string[]; account: string }): void {
    const repos = [...settings.repos];
    const same =
      settings.account === this.account &&
      repos.length === this.repos.length &&
      repos.every((r, i) => r === this.repos[i]);
    if (same) return;
    if (settings.account !== this.account) {
      // Another account sees other things: nothing of the previous one is news for it.
      for (const repo of [...this.seenRepos]) {
        if (forgeOf(repo) === 'github') this.seenRepos.delete(repo);
      }
      const logins = { ...this.state.logins };
      delete logins.github;
      this.state = {
        ...this.state,
        pulls: this.state.pulls.filter((p) => p.forge !== 'github'),
        logins,
      };
    }
    this.account = settings.account;
    this.repos = repos;
    for (const client of Object.values(this.clients)) client.setAccount(settings.account);
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

  /**
   * The repositories the account can see on one service, to pick from. Each service is asked
   * apart: a slow or broken one does not hold the other's list, and says why it has none.
   */
  async available(forge: Forge): Promise<AvailableRepos> {
    const client = this.clients[forge];
    if (!client) return { repos: [] };
    try {
      return { repos: await client.available(this.repos) };
    } catch (err) {
      return { repos: [], problem: this.problem(forge, err) };
    }
  }

  /** The accounts of `gh`, when the GitHub client can list them. */
  async ghAccounts(): Promise<GhAccounts> {
    const github = this.clients.github as { accounts?: () => Promise<GhAccounts> } | undefined;
    return (await github?.accounts?.()) ?? { accounts: [], active: '' };
  }

  /** A pull request of the latest look and the client of its service, to review it. */
  private reviewer(key: string): { pull: PullRequestView; client: ReviewClient } {
    const pull = this.find(key);
    if (!pull) throw new UserError('error.pulls.notFound');
    const client = this.clients[pull.forge];
    if (!isReviewClient(client)) throw new UserError('error.pulls.notFound');
    return { pull, client };
  }

  /** Opens a pull request on the service of the repository; the next look shows it. */
  async createPull(repo: string, pull: NewPull): Promise<OpenedPull> {
    const client = this.clients[forgeOf(repo)];
    if (!isPullCreator(client)) throw new UserError('error.pulls.notFound');
    const opened = await client.createPull(repo, pull);
    void this.refresh();
    return opened;
  }

  /** The open issues of a repository, read now, from the service it lives on. */
  async issues(repo: string): Promise<ForgeIssue[]> {
    const client = this.clients[forgeOf(repo)];
    if (!isIssueClient(client)) return [];
    return client.issues(repo);
  }

  /** Its changes and the comments already on it, read now. */
  async review(key: string): Promise<PullReviewData> {
    const { pull, client } = this.reviewer(key);
    const data = await client.review(pull.repo, pull.number);
    return { ...data, key, mine: pull.mine };
  }

  /** Publishes a review written in the app; the next look shows what it changed. */
  async submitReview(key: string, submission: ReviewSubmission): Promise<void> {
    const { pull, client } = this.reviewer(key);
    await client.submitReview(pull.repo, pull.number, submission);
    void this.refresh();
  }

  async merge(key: string, options: MergeOptions): Promise<void> {
    const { pull, client } = this.reviewer(key);
    await client.merge(pull.repo, pull.number, pull.branch, options);
    void this.refresh();
  }

  /** The text of `{pipeline}`: each failed job, its link and the end of its log. */
  async failureText(key: string): Promise<string> {
    const pull = this.find(key);
    const jobs = this.failed[key] ?? [];
    const client = pull && this.clients[pull.forge];
    if (!pull || !client || jobs.length === 0) return '';
    const parts: string[] = [];
    let size = 0;
    // The first three: past that, the rest is usually the same failure seen by other jobs.
    for (const job of jobs.slice(0, 3)) {
      const log = await client.jobLog(pull.repo, job).catch(() => '');
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
   * with the user's own `gh` and `glab`: past fifteen repositories the looks space out.
   */
  private tick(): void {
    const gap = Math.max(this.intervalMs, this.repos.length * REPO_GAP_MS);
    if (this.now() - this.lastLookAt >= gap - 1000) void this.refresh();
  }

  private problem(forge: Forge, err: unknown): ForgeProblem {
    if (err instanceof ForgeError && err.kind !== 'error') {
      return { forge, status: err.kind, ...(err.host ? { host: err.host } : {}) };
    }
    return { forge, status: 'error', error: this.describeError(err) };
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
        problems: [],
        repos,
        repoErrors: {},
        pulls: [],
        loading: false,
      });
      return;
    }
    this.set({ loading: true });
    const groups = new Map<Forge, string[]>();
    for (const repo of repos)
      groups.set(forgeOf(repo), [...(groups.get(forgeOf(repo)) ?? []), repo]);
    const answers = await Promise.all(
      [...groups].map(async ([forge, list]): Promise<Answer> => {
        const client = this.clients[forge];
        if (!client) return { forge, repos: list, error: new Error(`no client for ${forge}`) };
        try {
          return { forge, repos: list, result: await client.pulls(list) };
        } catch (error) {
          return { forge, repos: list, error };
        }
      }),
    );
    if (this.disposed || repos !== this.repos) return;

    const problems = answers.flatMap((a) => ('error' in a ? [this.problem(a.forge, a.error)] : []));
    const answered = answers.filter((a) => 'result' in a);
    if (answered.length === 0) {
      // The previous answer stays on screen: a network that drops for a minute is not a void.
      this.set({
        status: problems[0]!.status,
        error: problems[0]!.error,
        problems,
        loading: false,
      });
      return;
    }

    // A service that failed this time keeps what it showed the last time.
    const down = new Set(problems.map((p) => p.forge));
    const kept = this.state.pulls.filter((p) => down.has(p.forge));
    const fresh = answered.flatMap((a) => a.result.pulls);
    const logins: Partial<Record<Forge, string>> = {};
    for (const forge of down)
      if (this.state.logins[forge]) logins[forge] = this.state.logins[forge];
    for (const a of answered) if (a.result.login) logins[a.forge] = a.result.login;

    const notices = pullNotices(this.state.pulls, this.seenRepos, fresh, logins);
    const failed: Record<string, FailedJob[]> = {};
    for (const pull of kept) if (this.failed[pull.key]) failed[pull.key] = this.failed[pull.key]!;
    for (const a of answered) Object.assign(failed, a.result.failed);
    this.failed = failed;
    const repoErrors = Object.assign({}, ...answered.map((a) => a.result.repoErrors)) as Record<
      string,
      string
    >;
    this.seenRepos = new Set([
      ...[...this.seenRepos].filter((r) => down.has(forgeOf(r))),
      ...answered.flatMap((a) => a.repos.filter((r) => !repoErrors[r]).map((r) => r.toLowerCase())),
    ]);
    this.set({
      status: 'ok',
      error: undefined,
      problems,
      logins,
      repos,
      repoErrors,
      pulls: [...fresh, ...kept].sort(byUpdate),
      checkedAt: this.now(),
      loading: false,
    });
    for (const notice of notices) this.emit('notice', notice);
  }
}
