import fs from 'node:fs';
import path from 'node:path';
import { HANDOFF_DAYS, REVIEW_FILE_LIMIT, REVIEW_TIMEOUT_MS } from '@shared/reviewer';
import { UserError } from '@shared/i18n';

// A handoff is work passed from one session to another through files in a folder of the app, not
// through the terminal: a diff does not belong in a pty (ADR 0023). The sender writes what the
// receiver reads, tells it where the answer goes, and waits for the file to appear.

export const DIFF_FILE = 'diff.patch';
export const REVIEW_FILE = 'revisao.md';

const ID = /^[\w-]{1,64}$/;
const DAY_MS = 24 * 60 * 60 * 1000;

export interface HandoffServiceOptions {
  /** `~/.agent-controller/handoffs` (the tests keep theirs apart). */
  root: string;
  /** How often the answer file is looked at. */
  pollMs?: number;
  /** How long the file must stay as it is before it counts as written: agents write in pieces. */
  stableMs?: number;
  now?: () => number;
}

export interface HandoffFiles {
  dir: string;
  diffFile: string;
  reviewFile: string;
}

export type WaitOutcome = 'arrived' | 'timeout' | 'cancelled';

export class HandoffService {
  private readonly pollMs: number;
  private readonly stableMs: number;
  private readonly now: () => number;

  constructor(private readonly options: HandoffServiceOptions) {
    this.pollMs = options.pollMs ?? 500;
    this.stableMs = options.stableMs ?? 1500;
    this.now = options.now ?? Date.now;
  }

  /** The folder of a handoff; an id that is not a plain name never becomes part of a path. */
  files(id: string): HandoffFiles {
    if (!ID.test(id))
      throw new UserError('error.invalidArgument', { name: { key: 'arg.session' } });
    const dir = path.join(this.options.root, id);
    return { dir, diffFile: path.join(dir, DIFF_FILE), reviewFile: path.join(dir, REVIEW_FILE) };
  }

  /**
   * Gets the folder ready for a new request: the diff in place and no answer of an earlier one,
   * which would be taken for the new answer.
   */
  async prepare(id: string, diff: string): Promise<HandoffFiles> {
    const files = this.files(id);
    await fs.promises.mkdir(files.dir, { recursive: true });
    await fs.promises.rm(files.reviewFile, { force: true });
    await fs.promises.writeFile(files.diffFile, diff, 'utf8');
    return files;
  }

  /** Writes only the diff, keeping the answer file: a flow rule hands over the diff of a turn. */
  async writeDiff(id: string, diff: string): Promise<HandoffFiles> {
    const files = this.files(id);
    await fs.promises.mkdir(files.dir, { recursive: true });
    await fs.promises.writeFile(files.diffFile, diff, 'utf8');
    return files;
  }

  /** Whether an answer is already in the folder, and what it says. */
  async read(id: string): Promise<string | null> {
    const { reviewFile } = this.files(id);
    try {
      const handle = await fs.promises.open(reviewFile, 'r');
      try {
        const buffer = Buffer.alloc(REVIEW_FILE_LIMIT);
        const { bytesRead } = await handle.read(buffer, 0, REVIEW_FILE_LIMIT, 0);
        return buffer.subarray(0, bytesRead).toString('utf8');
      } finally {
        await handle.close();
      }
    } catch {
      return null;
    }
  }

  /**
   * Resolves when the answer file exists, has content and has stopped changing; or when the time
   * is out, or `signal` is aborted.
   */
  waitForReview(
    id: string,
    options: { timeoutMs?: number; signal?: AbortSignal; since?: number } = {},
  ): Promise<WaitOutcome> {
    const { reviewFile } = this.files(id);
    const deadline = this.now() + (options.timeoutMs ?? REVIEW_TIMEOUT_MS);
    let last = '';
    let sameSince = 0;
    return new Promise<WaitOutcome>((resolve) => {
      let timer: NodeJS.Timeout | undefined;
      const finish = (outcome: WaitOutcome) => {
        if (timer) clearTimeout(timer);
        options.signal?.removeEventListener('abort', onAbort);
        resolve(outcome);
      };
      const onAbort = () => finish('cancelled');
      const look = async () => {
        if (options.signal?.aborted) return finish('cancelled');
        try {
          const stat = await fs.promises.stat(reviewFile);
          const mark = `${stat.size}:${stat.mtimeMs}`;
          const at = this.now();
          // A file from before `since` is an old answer, not the one that is waited for.
          if (stat.size > 0 && (options.since === undefined || stat.mtimeMs >= options.since)) {
            if (mark !== last) {
              last = mark;
              sameSince = at;
            } else if (at - sameSince >= this.stableMs) {
              return finish('arrived');
            }
          }
        } catch {
          // Not there yet.
        }
        if (options.signal?.aborted) return finish('cancelled');
        if (this.now() >= deadline) return finish('timeout');
        timer = setTimeout(() => void look(), this.pollMs);
        timer.unref();
      };
      options.signal?.addEventListener('abort', onAbort, { once: true });
      void look();
    });
  }

  /** Forgets the folder of one handoff. */
  async remove(id: string): Promise<void> {
    await fs.promises.rm(this.files(id).dir, { recursive: true, force: true });
  }

  /** Removes the handoffs not touched for `days`. Returns how many went. */
  async cleanOld(days = HANDOFF_DAYS): Promise<number> {
    let removed = 0;
    let names: string[];
    try {
      names = await fs.promises.readdir(this.options.root);
    } catch {
      return 0;
    }
    for (const name of names) {
      if (!ID.test(name)) continue;
      const dir = path.join(this.options.root, name);
      try {
        const stat = await fs.promises.stat(dir);
        if (!stat.isDirectory() || this.now() - stat.mtimeMs < days * DAY_MS) continue;
        await fs.promises.rm(dir, { recursive: true, force: true });
        removed++;
      } catch {
        // Gone already, or in use: the next start tries again.
      }
    }
    return removed;
  }
}
