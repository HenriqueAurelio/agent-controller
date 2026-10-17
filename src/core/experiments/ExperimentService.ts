import { randomUUID } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import {
  ATTEMPTS_MAX,
  ATTEMPTS_MIN,
  attemptBranch,
  EXPERIMENT_DIFF_LIMIT,
  EXPERIMENT_FILES_LIMIT,
  EXPERIMENT_NAME_LIMIT,
  EXPERIMENT_PROMPT_LIMIT,
  type AttemptDiff,
  type AttemptRow,
  type AttemptSpec,
  type Comparison,
  type ExperimentCreated,
  type FileStat,
  type KeepResult,
  type KeptAttempt,
  type NewExperimentInput,
} from '@shared/experiments';
import { UserError } from '@shared/i18n';
import type { Session, SessionView, WorktreeOnClose } from '@shared/session';
import { isBinary, repositoryRoot, runGit } from '../git/GitService';
import { readyForQueue } from '../prompts/PromptQueue';
import type { SessionManager, WorktreeCreation } from '../sessions/SessionManager';
import { JsonStore } from '../store/JsonStore';

// An experiment is one request made to several attempts, each in a copy of the repository of its
// own. This only joins what exists: the copies (`createInWorktree`), the sessions and their group,
// and the text sent to an agent when it is ready.

export interface ExperimentAttempt {
  sessionId: string;
  /** Epoch ms of when the prompt reached the agent. */
  sentAt?: number;
  /** Epoch ms of the end of the first turn after that. */
  doneAt?: number;
}

export interface Experiment {
  id: string;
  name: string;
  prompt: string;
  /** What the copies started from, as the user wrote it. */
  base: string;
  /** The commit `base` was at, so every attempt is compared with the same tree. */
  baseCommit: string;
  groupId: string;
  attempts: ExperimentAttempt[];
  /** The attempt kept, while others are still waiting to be removed. */
  chosen?: string;
}

interface Stored {
  experiments: Experiment[];
}

export interface ExperimentServiceOptions {
  manager: SessionManager;
  /** The file the experiments are kept in. */
  file: string;
  worktrees(): WorktreeCreation;
  /** Called before the copy of an attempt is removed: stop what holds the folder open. */
  beforeRemove?(sessionId: string): Promise<void> | void;
  /** Words an error of the user, in their language. */
  describeError?(error: unknown): string;
  /** How long after the start the prompt may go, once the agent says it is ready. */
  settleMs?: number;
  now?: () => number;
}

const ID = /^[\w-]{1,64}$/;
const EXPERIMENTS_LIMIT = 50;
const SETTLE_MS = 1500;

function cleanStored(raw: unknown): Stored {
  const list = (raw as Partial<Stored> | null)?.experiments;
  const experiments: Experiment[] = [];
  for (const e of Array.isArray(list) ? (list as Partial<Experiment>[]) : []) {
    if (!e || typeof e.id !== 'string' || !ID.test(e.id)) continue;
    if (typeof e.name !== 'string' || typeof e.prompt !== 'string') continue;
    if (typeof e.base !== 'string' || typeof e.baseCommit !== 'string') continue;
    if (typeof e.groupId !== 'string' || !Array.isArray(e.attempts)) continue;
    const attempts: ExperimentAttempt[] = [];
    for (const a of e.attempts as Partial<ExperimentAttempt>[]) {
      if (!a || typeof a.sessionId !== 'string') continue;
      attempts.push({
        sessionId: a.sessionId,
        ...(typeof a.sentAt === 'number' && { sentAt: a.sentAt }),
        ...(typeof a.doneAt === 'number' && { doneAt: a.doneAt }),
      });
    }
    experiments.push({
      id: e.id,
      name: e.name.slice(0, EXPERIMENT_NAME_LIMIT),
      prompt: e.prompt.slice(0, EXPERIMENT_PROMPT_LIMIT),
      base: e.base,
      baseCommit: e.baseCommit,
      groupId: e.groupId,
      attempts: attempts.slice(0, ATTEMPTS_MAX),
      ...(typeof e.chosen === 'string' && { chosen: e.chosen }),
    });
  }
  return { experiments: experiments.slice(0, EXPERIMENTS_LIMIT) };
}

/** Counts the lines of a file git does not track yet: they all count as added. */
async function untrackedStat(root: string, file: string): Promise<FileStat> {
  const absolute = path.join(root, file);
  try {
    const stat = await fs.promises.stat(absolute);
    if (!stat.isFile()) return { path: file, added: 0, removed: 0, binary: false };
    if (stat.size > EXPERIMENT_DIFF_LIMIT * 5)
      return { path: file, added: 0, removed: 0, binary: true };
    const content = await fs.promises.readFile(absolute);
    if (isBinary(content)) return { path: file, added: 0, removed: 0, binary: true };
    const text = content.toString('utf8');
    const lines = text === '' ? 0 : text.split('\n').length - (text.endsWith('\n') ? 1 : 0);
    return { path: file, added: lines, removed: 0, binary: false };
  } catch {
    return { path: file, added: 0, removed: 0, binary: false };
  }
}

/** `git diff --numstat -z --no-renames`: `added<TAB>removed<TAB>path<NUL>`, `-` for binary. */
export function parseNumstat(output: string): FileStat[] {
  const stats: FileStat[] = [];
  for (const record of output.split('\0')) {
    const match = /^(-|\d+)\t(-|\d+)\t(.+)$/s.exec(record);
    if (!match) continue;
    const binary = match[1] === '-';
    stats.push({
      path: match[3]!,
      added: binary ? 0 : Number(match[1]),
      removed: binary ? 0 : Number(match[2]),
      binary,
    });
  }
  return stats;
}

/** What a copy changed since `baseCommit`: tracked files (staged or not) and new ones. */
export async function changedFiles(
  folder: string,
  baseCommit: string,
): Promise<{ files: FileStat[]; cut: boolean }> {
  const [tracked, others] = await Promise.all([
    runGit(folder, ['diff', '--numstat', '-z', '--no-renames', baseCommit, '--']),
    runGit(folder, ['ls-files', '--others', '--exclude-standard', '-z']),
  ]);
  const files = new Map<string, FileStat>();
  for (const stat of parseNumstat(tracked.stdout.toString('utf8'))) files.set(stat.path, stat);
  const fresh = others.stdout
    .toString('utf8')
    .split('\0')
    .filter((file) => file && !files.has(file));
  for (const file of fresh.slice(0, EXPERIMENT_FILES_LIMIT)) {
    files.set(file, await untrackedStat(folder, file));
  }
  const sorted = [...files.values()].sort((a, b) => a.path.localeCompare(b.path));
  return {
    files: sorted.slice(0, EXPERIMENT_FILES_LIMIT),
    cut: sorted.length > EXPERIMENT_FILES_LIMIT || fresh.length > EXPERIMENT_FILES_LIMIT,
  };
}

type DiffBody =
  { kind: 'binary' } | { kind: 'too-large'; size: number } | { kind: 'text'; text: string };

/** The text of the change of one file since `baseCommit`, as a unified diff. */
async function fileDiffText(
  folder: string,
  baseCommit: string,
  stat: FileStat,
  tracked: boolean,
): Promise<DiffBody> {
  if (stat.binary) return { kind: 'binary' };
  let text: string;
  if (tracked) {
    const result = await runGit(
      folder,
      ['diff', '--no-renames', '-U3', baseCommit, '--', stat.path],
      {
        maxBytes: EXPERIMENT_DIFF_LIMIT * 2,
      },
    );
    text = result.stdout.toString('utf8');
  } else {
    const content = await fs.promises.readFile(path.join(folder, stat.path), 'utf8');
    const lines = content.split('\n');
    if (lines[lines.length - 1] === '') lines.pop();
    text = [
      `--- /dev/null`,
      `+++ b/${stat.path}`,
      `@@ -0,0 +1,${lines.length} @@`,
      ...lines.map((line) => `+${line}`),
    ].join('\n');
  }
  const size = Buffer.byteLength(text);
  if (size > EXPERIMENT_DIFF_LIMIT) return { kind: 'too-large', size };
  return { kind: 'text', text };
}

export class ExperimentService {
  private readonly store: JsonStore<Stored>;
  private experiments: Experiment[];
  /** Prompts waiting for their agent to be ready: session id to the text and when it started. */
  private readonly waiting = new Map<string, { prompt: string; since: number }>();
  private readonly timers = new Set<NodeJS.Timeout>();
  private readonly now: () => number;

  constructor(private readonly options: ExperimentServiceOptions) {
    this.now = options.now ?? Date.now;
    this.store = new JsonStore<Stored>({
      file: options.file,
      version: 1,
      migrations: {},
      defaults: () => ({ experiments: [] }),
      validate: cleanStored,
    });
    this.experiments = this.store.load().experiments;
    this.prune();
    options.manager.on('transition', ({ session, previous }) => {
      this.onTransition(session, previous.state);
    });
    options.manager.on('removed', (id) => this.onRemoved(id));
  }

  private save(): void {
    try {
      this.store.save({ experiments: this.experiments });
    } catch {
      // The experiment still works in memory; the next change tries again.
    }
  }

  /** Forgets attempts whose session is gone, and experiments with none left. */
  private prune(): void {
    const { manager } = this.options;
    let changed = false;
    for (const experiment of this.experiments) {
      const alive = experiment.attempts.filter((a) => manager.has(a.sessionId));
      if (alive.length !== experiment.attempts.length) {
        experiment.attempts = alive;
        changed = true;
      }
    }
    const before = this.experiments.length;
    this.experiments = this.experiments.filter((e) => e.attempts.length > 0);
    if (changed || before !== this.experiments.length) this.save();
  }

  private onRemoved(sessionId: string): void {
    this.waiting.delete(sessionId);
    const experiment = this.experiments.find((e) =>
      e.attempts.some((a) => a.sessionId === sessionId),
    );
    if (!experiment) return;
    experiment.attempts = experiment.attempts.filter((a) => a.sessionId !== sessionId);
    if (experiment.attempts.length === 0) {
      this.experiments = this.experiments.filter((e) => e !== experiment);
    }
    this.save();
  }

  private find(id: string): Experiment {
    const found = this.experiments.find((e) => e.id === id);
    if (!found) throw new UserError('error.experiment.notFound');
    return found;
  }

  list(): Experiment[] {
    return this.experiments.map((e) => ({ ...e, attempts: e.attempts.map((a) => ({ ...a })) }));
  }

  // ---- creating -------------------------------------------------------------------------------

  /**
   * The group and its sessions, one copy after the other (their setup command takes the machine).
   * When an attempt cannot be made, the ones made before it are closed (their copies and branches
   * stay: nothing is deleted without being asked) and the error is thrown.
   */
  async create(input: NewExperimentInput): Promise<ExperimentCreated> {
    const name = input.name.trim().slice(0, EXPERIMENT_NAME_LIMIT);
    if (!name) throw new UserError('error.experiment.noName');
    if (!input.prompt.trim()) throw new UserError('error.experiment.noPrompt');
    if (input.prompt.length > EXPERIMENT_PROMPT_LIMIT) {
      throw new UserError('error.prompt.tooLarge', { limit: EXPERIMENT_PROMPT_LIMIT });
    }
    const specs: AttemptSpec[] = input.attempts;
    if (specs.length < ATTEMPTS_MIN || specs.length > ATTEMPTS_MAX) {
      throw new UserError('error.experiment.attempts', { min: ATTEMPTS_MIN, max: ATTEMPTS_MAX });
    }
    if (this.experiments.length >= EXPERIMENTS_LIMIT) {
      throw new UserError('error.experiment.tooMany');
    }
    const root = await repositoryRoot(input.cwd);
    if (!root) throw new UserError('error.worktree.notRepo', { folder: input.cwd });
    const base = input.base.trim();
    const commit = base.startsWith('-')
      ? null
      : await runGit(root, ['rev-parse', '--verify', '--quiet', `${base}^{commit}`]);
    if (!base || !commit || commit.code !== 0)
      throw new UserError('error.worktree.badBase', { base });

    const { manager } = this.options;
    const id = randomUUID();
    const group = manager.createGroup(name, [], { experimentId: id });
    const made: SessionView[] = [];
    try {
      for (const [index, spec] of specs.entries()) {
        made.push(
          await manager.createInWorktree(
            {
              name: `${name} #${index + 1}`,
              cwd: input.cwd,
              profile: spec.profile,
              ...(spec.command && { command: spec.command }),
              groupId: group.id,
              worktree: { branch: attemptBranch(name, index), base },
            },
            this.options.worktrees(),
          ),
        );
      }
    } catch (error) {
      for (const view of made) await manager.remove(view.id).catch(() => {});
      manager.removeGroup(group.id);
      throw error;
    }

    this.experiments.push({
      id,
      name,
      prompt: input.prompt,
      base,
      baseCommit: commit.stdout.toString('utf8').trim(),
      groupId: group.id,
      attempts: made.map((view) => ({ sessionId: view.id })),
    });
    this.save();
    for (const view of made) {
      this.waiting.set(view.id, { prompt: input.prompt, since: this.now() });
      manager.start(view.id);
      this.deliverWhenReady(view.id);
    }
    return { id, groupId: group.id, sessionIds: made.map((view) => view.id) };
  }

  // ---- sending the prompt ---------------------------------------------------------------------

  private attemptOf(
    sessionId: string,
  ): { experiment: Experiment; attempt: ExperimentAttempt } | null {
    for (const experiment of this.experiments) {
      const attempt = experiment.attempts.find((a) => a.sessionId === sessionId);
      if (attempt) return { experiment, attempt };
    }
    return null;
  }

  private onTransition(session: SessionView, previous: string): void {
    if (this.waiting.has(session.id)) this.deliverWhenReady(session.id);
    const found = this.attemptOf(session.id);
    if (
      found?.attempt.sentAt !== undefined &&
      found.attempt.doneAt === undefined &&
      session.status.state === 'terminou' &&
      previous !== 'terminou'
    ) {
      found.attempt.doneAt = this.now();
      this.save();
    }
  }

  /** Sends the prompt once the agent is at its input, and not before: it would be lost. */
  private deliverWhenReady(sessionId: string): void {
    const waiting = this.waiting.get(sessionId);
    if (!waiting) return;
    const { manager } = this.options;
    if (!manager.has(sessionId)) {
      this.waiting.delete(sessionId);
      return;
    }
    if (
      !readyForQueue({ status: manager.statusOf(sessionId), running: manager.isRunning(sessionId) })
    ) {
      return;
    }
    // An agent says it is ready a little before its input is: a text sent then can be lost.
    const settle = waiting.since + (this.options.settleMs ?? SETTLE_MS) - this.now();
    if (settle > 0) {
      const timer = setTimeout(() => {
        this.timers.delete(timer);
        this.deliverWhenReady(sessionId);
      }, settle);
      this.timers.add(timer);
      return;
    }
    this.waiting.delete(sessionId);
    try {
      manager.sendText(sessionId, waiting.prompt, { submit: true });
    } catch {
      return;
    }
    const found = this.attemptOf(sessionId);
    if (found) {
      found.attempt.sentAt = this.now();
      this.save();
    }
  }

  // ---- comparing ------------------------------------------------------------------------------

  /** The attempts as they are now: the table of the comparison. */
  async compare(experimentId: string): Promise<Comparison> {
    const experiment = this.find(experimentId);
    const views = new Map(this.options.manager.list().map((view) => [view.id, view]));
    const rows = await Promise.all(
      experiment.attempts.map(async (attempt): Promise<AttemptRow | null> => {
        const view = views.get(attempt.sessionId);
        if (!view) return null;
        const changed = await changedFiles(view.cwd, experiment.baseCommit).catch(() => ({
          files: [] as FileStat[],
          cut: false,
        }));
        const end = attempt.doneAt ?? this.now();
        return {
          sessionId: view.id,
          name: view.name,
          profile: view.profile,
          branch: view.worktree?.branch ?? '',
          state: view.status.state,
          running: view.running,
          promptSent: attempt.sentAt !== undefined,
          ...(view.checks && { checks: view.checks }),
          files: changed.files,
          filesCut: changed.cut,
          added: changed.files.reduce((sum, f) => sum + f.added, 0),
          removed: changed.files.reduce((sum, f) => sum + f.removed, 0),
          elapsedMs: attempt.sentAt === undefined ? null : Math.max(0, end - attempt.sentAt),
          chosen: experiment.chosen === attempt.sessionId,
        };
      }),
    );
    const attempts = rows.filter((row): row is AttemptRow => row !== null);
    const files = [...new Set(attempts.flatMap((row) => row.files.map((f) => f.path)))].sort(
      (a, b) => a.localeCompare(b),
    );
    return {
      id: experiment.id,
      name: experiment.name,
      prompt: experiment.prompt,
      base: experiment.base,
      attempts,
      files,
    };
  }

  /** One file in every attempt, against the same base. */
  async diff(experimentId: string, file: string): Promise<AttemptDiff[]> {
    const experiment = this.find(experimentId);
    const views = new Map(this.options.manager.list().map((view) => [view.id, view]));
    return Promise.all(
      experiment.attempts.flatMap((attempt) => {
        const view = views.get(attempt.sessionId);
        if (!view) return [];
        return [
          (async (): Promise<AttemptDiff> => {
            // Only a file the attempt changed is read: the name comes from the renderer.
            const { files } = await changedFiles(view.cwd, experiment.baseCommit);
            const stat = files.find((f) => f.path === file);
            if (!stat) return { sessionId: view.id, kind: 'unchanged' };
            const tracked =
              (await runGit(view.cwd, ['ls-files', '--error-unmatch', '--', stat.path])).code ===
                0 ||
              (await runGit(view.cwd, ['cat-file', '-e', `${experiment.baseCommit}:${stat.path}`]))
                .code === 0;
            const body = await fileDiffText(view.cwd, experiment.baseCommit, stat, tracked);
            return { sessionId: view.id, ...body } as AttemptDiff;
          })().catch((): AttemptDiff => ({ sessionId: view.id, kind: 'unchanged' })),
        ];
      }),
    );
  }

  // ---- keeping one ----------------------------------------------------------------------------

  /**
   * Keeps one attempt as an ordinary session and closes the others, removing their copies. A copy
   * with anything not committed, or one another session works in, is not removed: that session
   * stays (stopped) and is listed. The branches are never deleted.
   */
  async keep(experimentId: string, sessionId: string): Promise<KeepResult> {
    const experiment = this.find(experimentId);
    if (!experiment.attempts.some((a) => a.sessionId === sessionId)) {
      throw new UserError('error.experiment.notAttempt');
    }
    const { manager } = this.options;
    experiment.chosen = sessionId;
    const kept: KeptAttempt[] = [];
    let removed = 0;
    for (const attempt of [...experiment.attempts]) {
      if (attempt.sessionId === sessionId) continue;
      const session: Session | undefined = manager.get(attempt.sessionId);
      if (!session) continue;
      try {
        await this.options.beforeRemove?.(session.id);
        const worktree: WorktreeOnClose = session.worktree ? 'remove' : 'keep';
        await manager.remove(session.id, { worktree });
        removed++;
      } catch (error) {
        kept.push({
          sessionId: session.id,
          name: session.name,
          folder: session.cwd,
          reason: this.options.describeError?.(error) ?? (error as Error).message,
        });
      }
    }
    if (kept.length === 0) {
      // Nothing left to compare: the chosen one goes on as any session, out of the group.
      this.experiments = this.experiments.filter((e) => e !== experiment);
      this.save();
      manager.removeGroup(experiment.groupId);
    } else {
      this.save();
    }
    return { removed, kept };
  }

  dispose(): void {
    this.waiting.clear();
    for (const timer of this.timers) clearTimeout(timer);
    this.timers.clear();
  }
}
