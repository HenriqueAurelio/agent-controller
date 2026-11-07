// The guard of a pull request: when its pipeline fails, the fix goes to the agent of its branch
// by itself, a few times at most; when someone comments on it, the comments go there too. Decides only when to send and when to stop; who gets it and
// how it is sent belong to whoever listens.
import { EventEmitter } from 'node:events';
import {
  GUARD_ATTEMPTS,
  type GuardEntry,
  type GuardState,
  type PullRequestView,
  type PullsState,
} from '@shared/pulls';
import type { PullNotice } from './PullWatcher';

interface Events {
  changed: [GuardState];
  /** The pipeline of a guarded pull request failed: send its fix to the agent. */
  fix: [PullRequestView];
  /** It failed again after the last attempt: the guard stops and says so. */
  gaveUp: [PullRequestView];
  /** Someone else commented on a guarded pull request: send the open comments to the agent. */
  comments: [PullRequestView];
}

export class PullGuard extends EventEmitter<Events> {
  private entries = new Map<string, GuardEntry>();
  /** The commit of the failure each guard last acted on: the same failure is not sent twice. */
  private handled = new Map<string, string>();
  /** The count of comments each guard last sent: the same comments are not sent twice. */
  private commentsSent = new Map<string, number>();

  constructor(private readonly limit = GUARD_ATTEMPTS) {
    super();
  }

  get(): GuardState {
    return Object.fromEntries(this.entries);
  }

  /** The pull requests guarded, as saved; the count of each one already guarded is kept. */
  configure(keys: readonly string[]): void {
    const next = new Map<string, GuardEntry>();
    for (const key of keys)
      next.set(key, this.entries.get(key) ?? { attempts: 0, status: 'watching' });
    for (const key of this.handled.keys()) if (!next.has(key)) this.handled.delete(key);
    for (const key of this.commentsSent.keys()) if (!next.has(key)) this.commentsSent.delete(key);
    const changed =
      next.size !== this.entries.size || [...next.keys()].some((key) => !this.entries.has(key));
    this.entries = next;
    if (changed) this.emit('changed', this.get());
  }

  /** A guard just turned on: a pipeline already broken is acted on now, not at the next failure. */
  started(pull: PullRequestView | undefined): void {
    if (pull && this.entries.has(pull.key) && pull.pipeline.state === 'failure') this.failed(pull);
  }

  /** The news of the latest look of the services. */
  notice(notice: PullNotice): void {
    if (!this.entries.has(notice.pull.key)) return;
    if (notice.kind === 'failed') this.failed(notice.pull);
    if (notice.kind === 'comment') {
      // Comments are not failures: they take no attempt and never make the guard give up.
      if (this.commentsSent.get(notice.pull.key) === notice.pull.comments) return;
      this.commentsSent.set(notice.pull.key, notice.pull.comments);
      this.emit('comments', notice.pull);
    }
  }

  /** The latest look: a pipeline that passed again gives the guard all its attempts back. */
  update(state: PullsState): void {
    let changed = false;
    for (const pull of state.pulls) {
      const entry = this.entries.get(pull.key);
      if (!entry || pull.pipeline.state !== 'success') continue;
      if (entry.attempts === 0 && entry.status === 'watching') continue;
      this.entries.set(pull.key, { attempts: 0, status: 'watching' });
      this.handled.delete(pull.key);
      changed = true;
    }
    if (changed) this.emit('changed', this.get());
  }

  /** How the send went: to which session, or that no session is on the branch. */
  sent(key: string, session: string | null): void {
    const entry = this.entries.get(key);
    if (!entry) return;
    this.entries.set(
      key,
      session
        ? { ...entry, status: 'sent', session }
        : // Nobody got it: the attempt does not count.
          { attempts: Math.max(0, entry.attempts - 1), status: 'noSession' },
    );
    this.emit('changed', this.get());
  }

  private failed(pull: PullRequestView): void {
    const entry = this.entries.get(pull.key)!;
    if (this.handled.get(pull.key) === pull.pipeline.sha || entry.status === 'gaveUp') return;
    this.handled.set(pull.key, pull.pipeline.sha);
    if (entry.attempts >= this.limit) {
      this.entries.set(pull.key, { ...entry, status: 'gaveUp' });
      this.emit('changed', this.get());
      this.emit('gaveUp', pull);
      return;
    }
    this.entries.set(pull.key, { ...entry, attempts: entry.attempts + 1, status: 'sent' });
    this.emit('changed', this.get());
    this.emit('fix', pull);
  }
}
