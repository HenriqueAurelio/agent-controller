import { EventEmitter } from 'node:events';
import {
  REVIEW_DIFF_LIMIT,
  REVIEW_TIMEOUT_MS,
  REVIEW_TRIGGERS,
  type ReviewItem,
  type ReviewResult,
  type ReviewState,
  type ReviewTrigger,
  type ReviewerChoice,
  type ReviewerSetInput,
  type ReviewerSummary,
} from '@shared/reviewer';
import { UserError } from '@shared/i18n';
import type { Session } from '@shared/session';
import type { CheckpointService } from '../git/CheckpointService';
import { repositoryRoot, runGit } from '../git/GitService';
import { readyForQueue } from '../prompts/PromptQueue';
import type { SessionManager } from '../sessions/SessionManager';
import { JsonStore } from '../store/JsonStore';
import type { HandoffService } from './HandoffService';
import { parseReview } from './review';

// The reviewer of a session: another session that is asked, after a turn, to read what the turn
// changed and to write its observations to a file (ADR 0023). This joins what exists: the
// checkpoints (what the turn changed), the handoff folder (the files that go and come back) and
// the sessions (who is asked). The app never sends the review back to the main agent.

export interface ReviewerLink {
  /** The session whose turns are reviewed. */
  target: string;
  /** The session that reviews. */
  reviewer: string;
  trigger: ReviewTrigger;
}

interface Stored {
  links: ReviewerLink[];
}

interface Status {
  state: ReviewState;
  items: ReviewItem[];
  requestedAt?: number;
  error?: string;
}

interface ReviewerEvents {
  changed: [targetId: string];
}

export interface ReviewerServiceOptions {
  manager: SessionManager;
  checkpoints: Pick<CheckpointService, 'latestPair' | 'idle'>;
  handoff: HandoffService;
  /** The file the links are kept in. */
  file: string;
  /** The text the reviewer is asked with, `{diff}` and `{revisao}` still to be filled in. */
  prompt(): string;
  /** Fills in the variables of the prompt for the session that was reviewed. */
  expand(targetId: string, text: string): Promise<string>;
  /** Whether the folder of the session has checks for the end of a turn. */
  hasTurnChecks(targetId: string): boolean;
  /** The name of the session that is created to review `target`. */
  reviewerName(target: Session): string;
  describeError?(error: unknown): string;
  timeoutMs?: number;
  /** How long a reviewer that was just started is left alone before the request goes. */
  settleMs?: number;
  /** How long to wait for a reviewer that was started to be at its prompt. */
  readyTimeoutMs?: number;
  pollMs?: number;
  diffLimit?: number;
  now?: () => number;
}

const SETTLE_MS = 1500;
const READY_TIMEOUT_MS = 90_000;

function cleanStored(raw: unknown): Stored {
  const list = (raw as Partial<Stored> | null)?.links;
  const links: ReviewerLink[] = [];
  const used = new Set<string>();
  for (const l of Array.isArray(list) ? (list as Partial<ReviewerLink>[]) : []) {
    if (!l || typeof l.target !== 'string' || typeof l.reviewer !== 'string') continue;
    if (l.target === l.reviewer || used.has(l.target) || used.has(l.reviewer)) continue;
    const trigger = REVIEW_TRIGGERS.find((t) => t === l.trigger) ?? 'turn';
    used.add(l.target);
    used.add(l.reviewer);
    links.push({ target: l.target, reviewer: l.reviewer, trigger });
  }
  return { links };
}

/**
 * What a turn changed, as a patch. A change too big for a file the reviewer can read at once is
 * left out: the file then lists the files and says how to read them with git, which is also what
 * the reviewer does when a file is long. This is text for an agent, not for the user.
 */
export async function turnDiff(
  root: string,
  from: string,
  to: string,
  limit = REVIEW_DIFF_LIMIT,
): Promise<{ text: string; cut: boolean }> {
  const full = await runGit(root, ['diff', '--no-renames', '-U3', from, to, '--'], {
    maxBytes: limit + 1,
  });
  if (full.code === 0 && !full.truncated && full.stdout.length <= limit) {
    return { text: full.stdout.toString('utf8'), cut: false };
  }
  const names = await runGit(root, ['diff', '--no-renames', '--name-status', from, to, '--']);
  const list = names.stdout.toString('utf8').trimEnd();
  const text = [
    '# The diff of this turn is too large to be put here.',
    '# Files changed (status, then path):',
    list,
    '',
    '# Read the changes with git, from the folder of the session, one file at a time:',
    `#   git diff ${from} ${to} -- <path>`,
    '',
  ].join('\n');
  return { text, cut: true };
}

const sleep = (ms: number, signal?: AbortSignal) =>
  new Promise<void>((resolve) => {
    const timer = setTimeout(done, ms);
    function done() {
      clearTimeout(timer);
      signal?.removeEventListener('abort', done);
      resolve();
    }
    signal?.addEventListener('abort', done, { once: true });
  });

export class ReviewerService extends EventEmitter<ReviewerEvents> {
  private readonly store: JsonStore<Stored>;
  private links = new Map<string, ReviewerLink>();
  private readonly statuses = new Map<string, Status>();
  private readonly runs = new Map<string, AbortController>();
  /** Targets whose turn ended and wait for the checks to say they passed. */
  private readonly awaitingChecks = new Set<string>();
  /** The checkpoint each session was last reviewed at: a turn that changed nothing asks nothing. */
  private readonly reviewed = new Map<string, string>();
  /** Resolves once the answers that were on disk when the app opened have been read. */
  readonly restored: Promise<void>;

  constructor(private readonly options: ReviewerServiceOptions) {
    super();
    this.store = new JsonStore<Stored>({
      file: options.file,
      version: 1,
      migrations: {},
      defaults: () => ({ links: [] }),
      validate: cleanStored,
    });
    const { manager } = options;
    const alive = this.store
      .load()
      .links.filter((l) => manager.has(l.target) && manager.has(l.reviewer));
    this.links = new Map(alive.map((l) => [l.target, l]));
    for (const link of alive) this.publish(link.target);
    manager.on('removed', (id) => void this.onRemoved(id));
    this.restored = this.restore();
  }

  private save(): void {
    try {
      this.store.save({ links: [...this.links.values()] });
    } catch {
      // The link still works in memory; the next change tries again.
    }
  }

  /** An answer already on disk from before the app was closed is shown as it was. */
  private async restore(): Promise<void> {
    for (const target of this.links.keys()) {
      const text = await this.options.handoff.read(target).catch(() => null);
      if (text === null || this.statuses.has(target)) continue;
      this.statuses.set(target, { state: 'ready', items: parseReview(text) });
      this.publish(target);
    }
  }

  private status(target: string): Status {
    return this.statuses.get(target) ?? { state: 'idle', items: [] };
  }

  private publish(target: string): void {
    const link = this.links.get(target);
    const { manager } = this.options;
    if (!link) {
      manager.setReviewer(target, undefined);
    } else {
      const status = this.status(target);
      const summary: ReviewerSummary = {
        reviewerId: link.reviewer,
        trigger: link.trigger,
        state: status.state,
        ...(status.state === 'ready' && { count: status.items.length }),
      };
      manager.setReviewer(target, summary);
      manager.setReviewer(link.reviewer, undefined, target);
    }
    this.emit('changed', target);
  }

  private setStatus(target: string, status: Status): void {
    this.statuses.set(target, status);
    this.publish(target);
  }

  list(): ReviewerLink[] {
    return [...this.links.values()].map((l) => ({ ...l }));
  }

  /** Whether the session is part of a pair, as the one reviewed or as the reviewer. */
  private involved(id: string): ReviewerLink | undefined {
    for (const link of this.links.values())
      if (link.target === id || link.reviewer === id) return link;
    return undefined;
  }

  // ---- linking --------------------------------------------------------------------------------

  /** Gives the session a reviewer, changes when it is asked, or takes the reviewer away. */
  async set(input: ReviewerSetInput): Promise<ReviewerSummary | null> {
    const { manager } = this.options;
    const target = manager.get(input.sessionId);
    if (!target) throw new UserError('error.session.notFound');
    if (!input.reviewer) {
      await this.unlink(target.id);
      return null;
    }
    if (!REVIEW_TRIGGERS.includes(input.trigger)) {
      throw new UserError('error.invalidArgument', { name: { key: 'arg.trigger' } });
    }
    const current = this.links.get(target.id);
    // The same reviewer, asked at another moment: only the trigger changes.
    if (
      current &&
      input.reviewer.kind === 'existing' &&
      input.reviewer.sessionId === current.reviewer
    ) {
      current.trigger = input.trigger;
      this.save();
      this.publish(target.id);
      return this.summaryOf(target.id);
    }
    if (!(await repositoryRoot(target.cwd))) {
      throw new UserError('error.reviewer.noRepo', { folder: target.cwd });
    }
    if (this.involved(target.id) && !current) throw new UserError('error.reviewer.busy');
    const reviewerId = await this.choose(target, input.reviewer);
    if (current) await this.unlink(target.id);
    this.links.set(target.id, { target: target.id, reviewer: reviewerId, trigger: input.trigger });
    this.statuses.delete(target.id);
    this.reviewed.delete(target.id);
    this.save();
    this.publish(target.id);
    return this.summaryOf(target.id);
  }

  private summaryOf(target: string): ReviewerSummary | null {
    return this.options.manager.list().find((s) => s.id === target)?.reviewer ?? null;
  }

  private async choose(target: Session, choice: ReviewerChoice): Promise<string> {
    const { manager } = this.options;
    if (choice.kind === 'existing') {
      const existing = manager.get(choice.sessionId);
      if (!existing) throw new UserError('error.session.notFound');
      if (existing.id === target.id) throw new UserError('error.reviewer.self');
      if (this.involved(existing.id)) throw new UserError('error.reviewer.busy');
      return existing.id;
    }
    // A new session, in the same folder and the same group, that only reads.
    const view = manager.create({
      name: this.options.reviewerName(target),
      cwd: target.cwd,
      profile: choice.profile,
      ...(choice.command && { command: choice.command }),
      ...(target.groupId && { groupId: target.groupId }),
      readOnly: true,
    });
    if (!target.groupId) manager.createGroup(target.name, [target.id, view.id]);
    // The session being worked in stays the one on screen.
    manager.select(target.id);
    return view.id;
  }

  private async unlink(target: string, options: { keepFiles?: boolean } = {}): Promise<void> {
    const link = this.links.get(target);
    this.runs.get(target)?.abort();
    this.runs.delete(target);
    this.awaitingChecks.delete(target);
    this.statuses.delete(target);
    this.reviewed.delete(target);
    if (!link) return;
    this.links.delete(target);
    this.save();
    this.options.manager.setReviewer(link.reviewer, undefined);
    this.publish(target);
    if (!options.keepFiles) await this.options.handoff.remove(target).catch(() => {});
  }

  private async onRemoved(id: string): Promise<void> {
    this.awaitingChecks.delete(id);
    for (const link of [...this.links.values()]) {
      if (link.target === id || link.reviewer === id) await this.unlink(link.target);
    }
  }

  // ---- asking ---------------------------------------------------------------------------------

  /** The agent ended a turn: the review is asked once the checks, if there are any, passed. */
  turnEnded(target: string): void {
    const link = this.links.get(target);
    if (!link || link.trigger !== 'turn') return;
    if (this.options.hasTurnChecks(target)) {
      this.awaitingChecks.add(target);
      return;
    }
    void this.auto(target);
  }

  /** The checks of the end of the turn are over. Failed ones ask for no review. */
  checksFinished(target: string, outcome: 'passed' | 'failed'): void {
    if (!this.awaitingChecks.delete(target)) return;
    if (outcome === 'passed') void this.auto(target);
  }

  /** The agent is working again: a review that waited for the checks would be of old work. */
  turnStarted(target: string): void {
    this.awaitingChecks.delete(target);
  }

  private async auto(target: string): Promise<void> {
    try {
      await this.options.checkpoints.idle(target);
      const ready = await this.prepare(target, true);
      if (ready) await ready();
    } catch (error) {
      this.fail(target, error);
    }
  }

  /** "Review now": the request goes out, and the answer is waited for in the background. */
  async runNow(target: string): Promise<void> {
    if (!this.links.has(target)) throw new UserError('error.reviewer.none');
    await this.options.checkpoints.idle(target);
    const ready = await this.prepare(target, false);
    if (ready) void ready().catch((error) => this.fail(target, error));
  }

  private fail(target: string, error: unknown): void {
    if (!this.links.has(target)) return;
    const message = this.options.describeError?.(error) ?? (error as Error).message;
    this.setStatus(target, { state: 'failed', items: [], error: message });
  }

  /**
   * Checks there is something to review and writes the diff. Returns what remains to be done
   * (the request itself and the wait for the answer), or null when there is nothing to ask.
   */
  private async prepare(target: string, auto: boolean): Promise<(() => Promise<void>) | null> {
    const link = this.links.get(target);
    if (!link) return null;
    const pair = await this.options.checkpoints.latestPair(target);
    if (!pair) {
      if (auto) return null;
      throw new UserError('error.reviewer.noCheckpoints');
    }
    // A turn that changed nothing has no checkpoint of its own: there is no new work to read.
    if (auto && this.reviewed.get(target) === pair.to.id) return null;
    this.runs.get(target)?.abort();
    const control = new AbortController();
    this.runs.set(target, control);
    this.setStatus(target, { state: 'preparing', items: [] });
    const diff = await turnDiff(pair.root, pair.from.tree, pair.to.tree, this.options.diffLimit);
    const files = await this.options.handoff.prepare(target, diff.text);
    return () => this.request(target, link, pair.to.id, files, control);
  }

  private async request(
    target: string,
    link: ReviewerLink,
    checkpointId: string,
    files: { diffFile: string; reviewFile: string },
    control: AbortController,
  ): Promise<void> {
    const { manager, handoff } = this.options;
    const { signal } = control;
    try {
      await this.reach(link.reviewer, signal);
      if (signal.aborted) return;
      const filled = this.options
        .prompt()
        .replace(/\{diff\}/gi, files.diffFile)
        .replace(/\{(?:revisao|revisão|review)\}/gi, files.reviewFile);
      const text = await this.options.expand(target, filled);
      if (signal.aborted) return;
      manager.sendText(link.reviewer, text, { submit: true });
      this.reviewed.set(target, checkpointId);
      const requestedAt = (this.options.now ?? Date.now)();
      this.setStatus(target, { state: 'waiting', items: [], requestedAt });
      const outcome = await handoff.waitForReview(target, {
        signal,
        timeoutMs: this.options.timeoutMs ?? REVIEW_TIMEOUT_MS,
      });
      if (signal.aborted || outcome === 'cancelled' || !this.links.has(target)) return;
      if (outcome === 'timeout') {
        this.setStatus(target, { state: 'timedOut', items: [], requestedAt });
        return;
      }
      const items = parseReview((await handoff.read(target)) ?? '');
      this.setStatus(target, { state: 'ready', items, requestedAt });
    } catch (error) {
      if (!signal.aborted) this.fail(target, error);
    } finally {
      if (this.runs.get(target) === control) this.runs.delete(target);
    }
  }

  /** The reviewer running and at its prompt: started if it was not, and given a moment. */
  private async reach(reviewerId: string, signal: AbortSignal): Promise<void> {
    const { manager } = this.options;
    if (!manager.has(reviewerId)) throw new UserError('error.session.notFound');
    if (manager.isRunning(reviewerId)) return;
    manager.start(reviewerId);
    const now = this.options.now ?? Date.now;
    const started = now();
    const settle = this.options.settleMs ?? SETTLE_MS;
    const timeout = this.options.readyTimeoutMs ?? READY_TIMEOUT_MS;
    for (;;) {
      if (signal.aborted) return;
      if (!manager.has(reviewerId)) throw new UserError('error.session.notFound');
      const ready = readyForQueue({
        status: manager.statusOf(reviewerId),
        running: manager.isRunning(reviewerId),
      });
      // An agent says it is ready a little before its input is: a text sent then can be lost.
      if (ready && now() - started >= settle) return;
      if (now() - started > timeout) throw new UserError('error.reviewer.notReady');
      await sleep(this.options.pollMs ?? 200, signal);
    }
  }

  // ---- reading --------------------------------------------------------------------------------

  async result(target: string): Promise<ReviewResult> {
    if (!this.links.has(target)) throw new UserError('error.reviewer.none');
    await this.restored;
    const status = this.status(target);
    return {
      state: status.state,
      items: status.items.map((item) => ({ ...item })),
      ...(status.requestedAt !== undefined && { requestedAt: status.requestedAt }),
      ...(status.error && { error: status.error }),
    };
  }

  dispose(): void {
    for (const control of this.runs.values()) control.abort();
    this.runs.clear();
    this.awaitingChecks.clear();
  }
}
