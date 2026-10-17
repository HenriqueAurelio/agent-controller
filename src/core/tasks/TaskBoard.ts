import { createHash, randomUUID } from 'node:crypto';
import { EventEmitter } from 'node:events';
import fs from 'node:fs';
import path from 'node:path';
import { sanitizeAgentCommand } from '@shared/agents';
import { UserError } from '@shared/i18n';
import { AGENT_PROFILE_IDS, type SessionView } from '@shared/session';
import {
  TASK_DESCRIPTION_LIMIT,
  TASK_START_MAX,
  TASK_TITLE_LIMIT,
  TASKS_PER_BOARD_LIMIT,
  TASKS_PER_PASTE_LIMIT,
  taskBranch,
  taskPrompt,
  type NewTasksInput,
  type Task,
  type TaskBoardState,
  type TaskStartResult,
} from '@shared/tasks';
import { repositoryRoot, runGit } from '../git/GitService';
import { toLongPath } from '../pty/longPath';
import { readyForQueue } from '../prompts/PromptQueue';
import type { SessionManager, WorktreeCreation } from '../sessions/SessionManager';
import { JsonStore } from '../store/JsonStore';

// The cards of the task board, one file per repository. A card is only a title, a description and,
// once started, the session it became. Where it is on the board is read from that session
// (`columnOf`), never kept here: it could not disagree with the list of sessions.

interface Stored {
  repo: string;
  tasks: Task[];
}

interface Board {
  store: JsonStore<Stored>;
  data: Stored;
}

interface TaskBoardEvents {
  /** The cards of this repository changed. */
  changed: [repo: string];
}

export interface TaskBoardOptions {
  manager: SessionManager;
  /** The folder the boards are kept in, one file each. */
  dir: string;
  worktrees(): WorktreeCreation;
  /** Words an error of the user, in their language. */
  describeError?(error: unknown): string;
  /** How long after the start the prompt may go, once the agent says it is ready. */
  settleMs?: number;
  now?: () => number;
}

const ID = /^[\w-]{1,64}$/;
const SETTLE_MS = 1500;
const REPOS_LISTED = 50;

/** The same repository however its path is spelled (case and 8.3 names on Windows). */
const repoKey = (repo: string): string => {
  const long = toLongPath(path.resolve(repo));
  return process.platform === 'win32' ? long.toLowerCase() : long;
};
const fileName = (repo: string): string =>
  `${createHash('sha1').update(repoKey(repo)).digest('hex').slice(0, 20)}.json`;

function cleanTask(raw: unknown): Task | null {
  const t = raw as Partial<Task> | null;
  if (!t || typeof t.id !== 'string' || !ID.test(t.id)) return null;
  if (typeof t.title !== 'string' || typeof t.description !== 'string') return null;
  if (!AGENT_PROFILE_IDS.includes(t.profile as never)) return null;
  if (typeof t.base !== 'string') return null;
  const command = typeof t.command === 'string' ? sanitizeAgentCommand(t.command) : '';
  return {
    id: t.id,
    title: t.title.slice(0, TASK_TITLE_LIMIT),
    description: t.description.slice(0, TASK_DESCRIPTION_LIMIT),
    profile: t.profile!,
    ...(command && { command }),
    isolated: t.isolated !== false,
    base: t.base,
    ...(typeof t.groupId === 'string' && { groupId: t.groupId }),
    ...(typeof t.sessionId === 'string' && { sessionId: t.sessionId }),
    ...(typeof t.branch === 'string' && { branch: t.branch }),
    ...(typeof t.startCommit === 'string' && { startCommit: t.startCommit }),
    ...(typeof t.sentAt === 'number' && { sentAt: t.sentAt }),
    ...(t.sessionClosed === true && { sessionClosed: true }),
    ...(t.done === true && { done: true }),
  };
}

function cleanStored(raw: unknown): Stored {
  const value = raw as Partial<Stored> | null;
  if (!value || typeof value.repo !== 'string' || !Array.isArray(value.tasks)) {
    throw new Error('not a board');
  }
  const tasks: Task[] = [];
  for (const item of value.tasks) {
    const task = cleanTask(item);
    if (task) tasks.push(task);
  }
  return { repo: value.repo, tasks: tasks.slice(0, TASKS_PER_BOARD_LIMIT) };
}

export class TaskBoard extends EventEmitter<TaskBoardEvents> {
  private readonly boards = new Map<string, Board>();
  /** Prompts waiting for their agent to be ready: session id to the text and when it started. */
  private readonly waiting = new Map<string, { prompt: string; since: number }>();
  private readonly timers = new Set<NodeJS.Timeout>();
  private readonly now: () => number;

  constructor(private readonly options: TaskBoardOptions) {
    super();
    this.now = options.now ?? Date.now;
    this.loadAll();
    this.pruneSessions();
    options.manager.on('transition', ({ session, previous }) => {
      if (this.waiting.has(session.id)) this.deliverWhenReady(session.id);
      if (session.status.state === 'terminou' && previous.state !== 'terminou') {
        void this.checkMergedOf(session.id);
      }
    });
    options.manager.on('removed', (id) => this.onRemoved(id));
  }

  // ---- storage --------------------------------------------------------------------------------

  private storeFor(repo: string): JsonStore<Stored> {
    return new JsonStore<Stored>({
      file: path.join(this.options.dir, fileName(repo)),
      version: 1,
      migrations: {},
      defaults: () => ({ repo, tasks: [] }),
      validate: cleanStored,
    });
  }

  private loadAll(): void {
    let files: string[];
    try {
      files = fs.readdirSync(this.options.dir).filter((f) => f.endsWith('.json'));
    } catch {
      return;
    }
    for (const file of files) {
      const probe = new JsonStore<Stored>({
        file: path.join(this.options.dir, file),
        version: 1,
        migrations: {},
        defaults: () => ({ repo: '', tasks: [] }),
        validate: cleanStored,
      });
      const data = probe.load();
      if (data.repo) this.boards.set(repoKey(data.repo), { store: probe, data });
    }
  }

  private board(repo: string): Board {
    const key = repoKey(repo);
    let found = this.boards.get(key);
    if (!found) {
      const store = this.storeFor(repo);
      found = { store, data: store.load() };
      this.boards.set(key, found);
    }
    return found;
  }

  private save(board: Board): void {
    try {
      board.store.save(board.data);
    } catch {
      // The cards still work in memory; the next change tries again.
    }
    this.emit('changed', board.data.repo);
  }

  private find(id: unknown): { board: Board; task: Task } {
    for (const board of this.boards.values()) {
      const task = board.data.tasks.find((t) => t.id === id);
      if (task) return { board, task };
    }
    throw new UserError('error.task.notFound');
  }

  private ofSession(sessionId: string): { board: Board; task: Task } | null {
    for (const board of this.boards.values()) {
      const task = board.data.tasks.find((t) => t.sessionId === sessionId);
      if (task) return { board, task };
    }
    return null;
  }

  /** Cards whose session is gone (closed while the app was off) go back to "to do". */
  private pruneSessions(): void {
    for (const board of this.boards.values()) {
      let changed = false;
      for (const task of board.data.tasks) {
        if (task.sessionId && !this.options.manager.has(task.sessionId)) {
          this.forgetSession(task);
          changed = true;
        }
      }
      if (changed) this.save(board);
    }
  }

  private forgetSession(task: Task): void {
    delete task.sessionId;
    delete task.sentAt;
    if (!task.done) task.sessionClosed = true;
  }

  private onRemoved(sessionId: string): void {
    this.waiting.delete(sessionId);
    const found = this.ofSession(sessionId);
    if (!found) return;
    this.forgetSession(found.task);
    this.save(found.board);
  }

  // ---- reading --------------------------------------------------------------------------------

  /** The board of the repository of `folder`; cards whose branch got into the base are done. */
  async list(folder: string): Promise<TaskBoardState> {
    const repo = await this.rootOf(folder);
    const board = this.board(repo);
    await this.checkMerged(board);
    return this.state(board);
  }

  private state(board: Board): TaskBoardState {
    const repos = [...this.boards.values()]
      .filter((b) => b.data.tasks.length > 0 || b === board)
      .map((b) => b.data.repo)
      .sort((a, b) => a.localeCompare(b))
      .slice(0, REPOS_LISTED);
    return {
      repo: board.data.repo,
      tasks: board.data.tasks.map((t) => ({ ...t })),
      repos,
    };
  }

  private async rootOf(folder: string): Promise<string> {
    const root = await repositoryRoot(folder);
    if (!root) throw new UserError('error.worktree.notRepo', { folder });
    return toLongPath(root);
  }

  // ---- changing the cards ---------------------------------------------------------------------

  async create(input: NewTasksInput): Promise<TaskBoardState> {
    const repo = await this.rootOf(input.cwd);
    if (input.drafts.length === 0) throw new UserError('error.task.noTitle');
    if (input.drafts.length > TASKS_PER_PASTE_LIMIT) {
      throw new UserError('error.task.tooManyPaste', { max: TASKS_PER_PASTE_LIMIT });
    }
    const base = input.base.trim();
    if (!base || base.startsWith('-')) throw new UserError('error.worktree.badBase', { base });
    if (input.isolated) {
      const ok = await runGit(repo, ['rev-parse', '--verify', '--quiet', `${base}^{commit}`]);
      if (ok.code !== 0) throw new UserError('error.worktree.badBase', { base });
    }
    const board = this.board(repo);
    if (board.data.tasks.length + input.drafts.length > TASKS_PER_BOARD_LIMIT) {
      throw new UserError('error.task.tooMany', { max: TASKS_PER_BOARD_LIMIT });
    }
    const command = input.command ? sanitizeAgentCommand(input.command) : '';
    const groupId = this.knownGroup(input.groupId);
    for (const draft of input.drafts) {
      const title = draft.title.trim().slice(0, TASK_TITLE_LIMIT);
      if (!title) throw new UserError('error.task.noTitle');
      if (draft.description.length > TASK_DESCRIPTION_LIMIT) {
        throw new UserError('error.prompt.tooLarge', { limit: TASK_DESCRIPTION_LIMIT });
      }
      board.data.tasks.push({
        id: randomUUID(),
        title,
        description: draft.description,
        profile: input.profile,
        ...(command && { command }),
        isolated: input.isolated,
        base,
        ...(groupId && { groupId }),
      });
    }
    this.save(board);
    return this.state(board);
  }

  private knownGroup(groupId: string | undefined): string | undefined {
    return groupId && this.options.manager.listGroups().some((g) => g.id === groupId)
      ? groupId
      : undefined;
  }

  /** Edits a card that was not started: afterwards it is the session that matters. */
  update(id: string, patch: { title?: string; description?: string }): TaskBoardState {
    const { board, task } = this.find(id);
    if (task.sessionId) throw new UserError('error.task.started');
    if (patch.title !== undefined) {
      const title = patch.title.trim().slice(0, TASK_TITLE_LIMIT);
      if (!title) throw new UserError('error.task.noTitle');
      task.title = title;
    }
    if (patch.description !== undefined) {
      if (patch.description.length > TASK_DESCRIPTION_LIMIT) {
        throw new UserError('error.prompt.tooLarge', { limit: TASK_DESCRIPTION_LIMIT });
      }
      task.description = patch.description;
    }
    this.save(board);
    return this.state(board);
  }

  /** Removes the card. The session it became, if any, is left as it is. */
  remove(id: string): TaskBoardState {
    const { board, task } = this.find(id);
    board.data.tasks = board.data.tasks.filter((t) => t !== task);
    if (task.sessionId) this.waiting.delete(task.sessionId);
    this.save(board);
    return this.state(board);
  }

  /** Puts the cards of `ids` in that order; the others keep their places after them. */
  reorder(repo: string, ids: string[]): TaskBoardState {
    const board = this.board(repo);
    const byId = new Map(board.data.tasks.map((t) => [t.id, t]));
    const first = ids.flatMap((id) => {
      const task = byId.get(id);
      byId.delete(id);
      return task ? [task] : [];
    });
    board.data.tasks = [...first, ...board.data.tasks.filter((t) => byId.has(t.id))];
    this.save(board);
    return this.state(board);
  }

  /** The user's mark: "done", or taking it back. The session is closed by the caller. */
  done(id: string, done: boolean): TaskBoardState {
    const { board, task } = this.find(id);
    if (done) task.done = true;
    else delete task.done;
    this.save(board);
    return this.state(board);
  }

  // ---- starting -------------------------------------------------------------------------------

  /**
   * Starts up to `TASK_START_MAX` cards, one after the other (their setup command takes the
   * machine): a copy and a branch of its own when the card asks, the session, and the description
   * as the first prompt once the agent is ready. A card that cannot start is reported; the
   * others go on.
   */
  async start(ids: string[]): Promise<TaskStartResult> {
    const unique = [...new Set(ids)];
    if (unique.length === 0) return { started: [], failed: [] };
    if (unique.length > TASK_START_MAX) {
      throw new UserError('error.task.tooManyStart', { max: TASK_START_MAX });
    }
    const found = unique.map((id) => this.find(id));
    for (const { task } of found) {
      if (task.sessionId || task.done) throw new UserError('error.task.started');
    }
    const result: TaskStartResult = { started: [], failed: [] };
    for (const { board, task } of found) {
      try {
        await this.startOne(board, task);
        result.started.push(task.id);
      } catch (error) {
        result.failed.push({
          taskId: task.id,
          reason: this.options.describeError?.(error) ?? (error as Error).message,
        });
      }
    }
    return result;
  }

  private async freeBranch(repo: string, wanted: string): Promise<string> {
    for (let n = 1; n < 100; n++) {
      const name = n === 1 ? wanted : `${wanted}-${n}`;
      const taken = await runGit(repo, ['rev-parse', '--verify', '--quiet', `refs/heads/${name}`]);
      if (taken.code !== 0) return name;
    }
    return `${wanted}-${randomUUID().slice(0, 6)}`;
  }

  private async startOne(board: Board, task: Task): Promise<void> {
    const { manager } = this.options;
    const prompt = taskPrompt(task);
    const groupId = this.knownGroup(task.groupId);
    const common = {
      name: task.title,
      cwd: board.data.repo,
      profile: task.profile,
      ...(task.command && { command: task.command }),
      ...(groupId && { groupId }),
      // Starting cards from the board must not pull the user away from what they are looking at.
      keepSelection: true,
    };
    let view: SessionView;
    let branch: string | undefined;
    let startCommit: string | undefined;
    if (task.isolated) {
      branch = await this.freeBranch(board.data.repo, taskBranch(task.title));
      const tip = await runGit(board.data.repo, ['rev-parse', '--verify', `${task.base}^{commit}`]);
      if (tip.code !== 0) throw new UserError('error.worktree.badBase', { base: task.base });
      startCommit = tip.stdout.toString('utf8').trim();
      view = await manager.createInWorktree(
        { ...common, worktree: { branch, base: task.base } },
        this.options.worktrees(),
      );
    } else {
      view = manager.create(common);
    }
    task.sessionId = view.id;
    delete task.sessionClosed;
    delete task.sentAt;
    if (branch) {
      task.branch = branch;
      task.startCommit = startCommit;
    }
    this.save(board);
    this.waiting.set(view.id, { prompt, since: this.now() });
    manager.start(view.id);
    this.deliverWhenReady(view.id);
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
    const found = this.ofSession(sessionId);
    if (found) {
      found.task.sentAt = this.now();
      this.save(found.board);
    }
  }

  // ---- the branch got into the base -----------------------------------------------------------

  private async checkMergedOf(sessionId: string): Promise<void> {
    const found = this.ofSession(sessionId);
    if (found) await this.checkMerged(found.board).catch(() => {});
  }

  /**
   * A card is done when its branch has commits the base did not have at the start and the base now
   * contains them. A branch still where it started is an ancestor of the base too, and is not that.
   */
  private async checkMerged(board: Board): Promise<void> {
    let changed = false;
    for (const task of board.data.tasks) {
      if (task.done || !task.branch || !task.startCommit || task.base.startsWith('-')) continue;
      const tip = await runGit(board.data.repo, [
        'rev-parse',
        '--verify',
        '--quiet',
        `refs/heads/${task.branch}`,
      ]).catch(() => null);
      if (!tip || tip.code !== 0) continue;
      const head = tip.stdout.toString('utf8').trim();
      if (!head || head === task.startCommit) continue;
      const inside = await runGit(board.data.repo, [
        'merge-base',
        '--is-ancestor',
        head,
        task.base,
      ]).catch(() => null);
      if (inside?.code === 0) {
        task.done = true;
        changed = true;
      }
    }
    if (changed) this.save(board);
  }

  dispose(): void {
    this.waiting.clear();
    for (const timer of this.timers) clearTimeout(timer);
    this.timers.clear();
    this.removeAllListeners();
  }
}
