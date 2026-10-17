import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { PtyManager } from '@core/pty/PtyManager';
import { SessionManager } from '@core/sessions/SessionManager';
import { createSocketPath, HookServer } from '@core/signals/HookServer';
import { TaskBoard } from '@core/tasks/TaskBoard';
import { DEFAULT_PREFERENCES } from '@shared/prefs';
import {
  columnOf,
  draftsFromLines,
  taskBranch,
  taskPrompt,
  type NewTasksInput,
  type Task,
  type TaskSessionFacts,
} from '@shared/tasks';
import { AGENTCTL_SCRIPT, FIXTURES, removeDir, tempDir, waitFor } from './helpers';

const FAKE_AGENT = path.join(FIXTURES, 'fake-agent.cjs');

const git = (cwd: string, ...args: string[]) =>
  execFileSync('git', args, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });

const task = (patch: Partial<Task> = {}): Task => ({
  id: 't1',
  title: 'Login',
  description: '',
  profile: 'claude-code',
  isolated: true,
  base: 'main',
  ...patch,
});
const facts = (patch: Partial<TaskSessionFacts> = {}): TaskSessionFacts => ({
  state: 'trabalhando',
  running: true,
  ...patch,
});

describe('columnOf', () => {
  const started = { sessionId: 's1', sentAt: 1 };

  it('a card without a session is to do, and one the user marked is done', () => {
    expect(columnOf(task())).toBe('todo');
    expect(columnOf(task({ sessionClosed: true, branch: 'ac/login' }))).toBe('todo');
    expect(columnOf(task({ done: true }))).toBe('done');
    // A session the card names but the app no longer has.
    expect(columnOf(task(started), undefined)).toBe('todo');
    // Done wins over whatever the session is doing.
    expect(columnOf(task({ ...started, done: true }), facts())).toBe('done');
  });

  it('follows the state of the session', () => {
    expect(columnOf(task(started), facts({ state: 'trabalhando' }))).toBe('doing');
    expect(columnOf(task(started), facts({ state: 'iniciando' }))).toBe('doing');
    expect(columnOf(task(started), facts({ state: 'aguardando' }))).toBe('attention');
    expect(columnOf(task(started), facts({ state: 'erro', running: false }))).toBe('attention');
    expect(columnOf(task(started), facts({ state: 'parada', running: false }))).toBe('attention');
    expect(columnOf(task(started), facts({ state: 'terminou' }))).toBe('review');
  });

  it('items in the queue keep a finished session in progress', () => {
    expect(columnOf(task(started), facts({ state: 'terminou', queue: { items: 2 } }))).toBe(
      'doing',
    );
    expect(columnOf(task(started), facts({ state: 'terminou', queue: { items: 0 } }))).toBe(
      'review',
    );
  });

  it('the checks decide between review and "needs you" once the turn ended', () => {
    const ended = (checks: TaskSessionFacts['checks']) =>
      columnOf(task(started), facts({ state: 'terminou', checks }));
    expect(ended({ state: 'passed' })).toBe('review');
    expect(ended({ state: 'failed' })).toBe('attention');
    expect(ended({ state: 'running' })).toBe('doing');
    expect(ended({ state: 'queued' })).toBe('doing');
    expect(ended({ state: 'cancelled' })).toBe('review');
    expect(ended(undefined)).toBe('review');
  });

  it('an agent that is ready before the first prompt arrived is not waiting for you', () => {
    const fresh = { sessionId: 's1' };
    expect(columnOf(task(fresh), facts({ state: 'aguardando' }))).toBe('doing');
    expect(columnOf(task(fresh), facts({ state: 'terminou' }))).toBe('doing');
    expect(columnOf(task(fresh), facts({ state: 'parada', running: false }))).toBe('attention');
  });
});

describe('helpers of the cards', () => {
  it('makes a branch git takes out of any title', () => {
    expect(taskBranch('Corrigir o login!')).toBe('ac/corrigir-o-login');
    expect(taskBranch('Migração do IPC')).toBe('ac/migracao-do-ipc');
    expect(taskBranch('???')).toBe('ac/tarefa');
  });

  it('the description is the prompt, and the title stands in for an empty one', () => {
    expect(taskPrompt({ title: 'A', description: '  faça B ' })).toBe('faça B');
    expect(taskPrompt({ title: 'A', description: '  ' })).toBe('A');
  });

  it('a pasted list is one card per line, without bullets and empty lines', () => {
    const text = '- [ ] um\r\n\n* dois\n3. tres\n   \n  quatro  ';
    expect(draftsFromLines(text).map((d) => d.title)).toEqual(['um', 'dois', 'tres', 'quatro']);
  });
});

describe('TaskBoard', () => {
  let repo: string;
  let copies: string;
  let state: string;
  let ptys: PtyManager;
  let hooks: HookServer;
  let manager: SessionManager;
  let board: TaskBoard;

  const build = () => {
    board = new TaskBoard({
      manager,
      dir: path.join(state, 'tasks'),
      worktrees: () => ({ parent: copies }),
      settleMs: 100,
    });
  };
  const input = (titles: string[], patch: Partial<NewTasksInput> = {}): NewTasksInput => ({
    cwd: repo,
    profile: 'claude-code',
    isolated: true,
    base: 'main',
    drafts: titles.map((title) => ({ title, description: 'work' })),
    ...patch,
  });
  const cards = async () => (await board.list(repo)).tasks;

  beforeEach(async () => {
    repo = tempDir('ac task repo ação-');
    copies = tempDir('ac task cópias-');
    state = tempDir('ac task estado-');
    git(repo, 'init', '-q', '-b', 'main');
    git(repo, 'config', 'user.email', 'teste@example.com');
    git(repo, 'config', 'user.name', 'Teste');
    git(repo, 'config', 'commit.gpgsign', 'false');
    git(repo, 'config', 'core.autocrlf', 'false');
    fs.writeFileSync(path.join(repo, 'app.ts'), 'export const a = 1;\n');
    git(repo, 'add', '-A');
    git(repo, 'commit', '-q', '-m', 'base');

    ptys = new PtyManager();
    hooks = new HookServer({
      socketPath: createSocketPath(),
      isKnownSession: (id) => manager.has(id),
    });
    hooks.on('message', (message) => manager.handleHook(message));
    await hooks.listen();
    manager = new SessionManager({
      ptys,
      sessions: [],
      selectedId: null,
      prefs: { ...DEFAULT_PREFERENCES, silenceSeconds: 0 },
      persist: () => {},
      resolveLaunch: (session) => ({
        file: process.execPath,
        args: [FAKE_AGENT],
        env: {
          AGENTCTL_SESSION_ID: session.id,
          AGENTCTL_SOCKET: hooks.socketPath,
          FAKE_AGENTCTL: AGENTCTL_SCRIPT,
        },
      }),
    });
    build();
  });
  afterEach(async () => {
    board.dispose();
    await manager.dispose(0);
    await ptys.killAll({ graceMs: 0 });
    await hooks.close();
    for (const dir of [copies, repo, state]) removeDir(dir);
  });

  it('creates one card per draft, keeps them on disk and reads them back', async () => {
    const created = await board.create(input(['Um', 'Dois', 'Três']));
    expect(created.tasks.map((t) => t.title)).toEqual(['Um', 'Dois', 'Três']);
    expect(created.repos).toHaveLength(1);
    expect((await cards()).every((t) => !t.sessionId && t.base === 'main' && t.isolated)).toBe(
      true,
    );

    // The board of a repository is found from any folder inside it.
    fs.mkdirSync(path.join(repo, 'sub'));
    expect((await board.list(path.join(repo, 'sub'))).tasks).toHaveLength(3);

    board.dispose();
    build();
    expect((await cards()).map((t) => t.title)).toEqual(['Um', 'Dois', 'Três']);
    const files = fs.readdirSync(path.join(state, 'tasks'));
    expect(files).toHaveLength(1);
  });

  it('refuses what cannot be a card', async () => {
    const outside = tempDir('ac task fora-');
    try {
      await expect(board.create(input(['x'], { cwd: outside }))).rejects.toMatchObject({
        key: 'error.worktree.notRepo',
      });
    } finally {
      removeDir(outside);
    }
    await expect(board.create(input([]))).rejects.toMatchObject({ key: 'error.task.noTitle' });
    await expect(board.create(input(['  ']))).rejects.toMatchObject({
      key: 'error.task.noTitle',
    });
    await expect(board.create(input(['x'], { base: 'nao-existe' }))).rejects.toMatchObject({
      key: 'error.worktree.badBase',
    });
    await expect(board.create(input(['x'], { base: '--evil' }))).rejects.toMatchObject({
      key: 'error.worktree.badBase',
    });
    await expect(
      board.create(input(Array.from({ length: 51 }, (_, i) => `c${i}`))),
    ).rejects.toMatchObject({ key: 'error.task.tooManyPaste' });
    expect(await cards()).toHaveLength(0);
  });

  it('edits, reorders and removes cards that were not started', async () => {
    const [a, b, c] = (await board.create(input(['A', 'B', 'C']))).tasks as [Task, Task, Task];
    board.update(a.id, { title: ' Novo A ', description: 'detalhe' });
    expect((await cards())[0]).toMatchObject({ title: 'Novo A', description: 'detalhe' });
    expect(() => board.update(a.id, { title: ' ' })).toThrow();

    board.reorder((await board.list(repo)).repo, [c.id, a.id]);
    expect((await cards()).map((t) => t.id)).toEqual([c.id, a.id, b.id]);

    board.remove(a.id);
    expect((await cards()).map((t) => t.id)).toEqual([c.id, b.id]);
    expect(() => board.remove('nao-existe')).toThrow();
  });

  it('marks a card done and takes the mark back', async () => {
    const [a] = (await board.create(input(['A']))).tasks as [Task];
    board.done(a.id, true);
    expect(columnOf((await cards())[0]!)).toBe('done');
    board.done(a.id, false);
    expect(columnOf((await cards())[0]!)).toBe('todo');
  });

  it('starts a card: a copy, a branch ac/<title>, a session and the description as the prompt', async () => {
    const [a] = (await board.create(input(['Corrigir o login']))).tasks as [Task];
    const result = await board.start([a.id]);
    expect(result).toEqual({ started: [a.id], failed: [] });

    const [started] = await cards();
    expect(started).toMatchObject({ branch: 'ac/corrigir-o-login' });
    expect(started!.sessionClosed).toBeUndefined();
    const view = manager.get(started!.sessionId!);
    expect(view?.name).toBe('Corrigir o login');
    expect(view?.worktree).toMatchObject({ branch: 'ac/corrigir-o-login', base: 'main' });
    expect(git(view!.cwd, 'branch', '--show-current').trim()).toBe('ac/corrigir-o-login');
    expect(started!.startCommit).toBe(git(repo, 'rev-parse', 'main').trim());
    // A branch that has not moved is an ancestor of the base, and still not "in the base".
    expect(started!.done).toBeUndefined();

    await waitFor(async () => (await cards())[0]!.sentAt !== undefined, {
      timeout: 20000,
      message: 'o pedido chegar ao agente',
    });
    expect(
      columnOf((await cards())[0]!, { state: manager.list()[0]!.status.state, running: true }),
    ).not.toBe('todo');

    // Starting it again is refused: it has a session.
    await expect(board.start([a.id])).rejects.toMatchObject({ key: 'error.task.started' });
  });

  it('keeps the session in sight when starting from the board', async () => {
    const first = manager.create({ name: 'Em vista', cwd: repo, profile: 'claude-code' });
    const [a] = (await board.create(input(['Outra']))).tasks as [Task];
    await board.start([a.id]);
    expect(manager.selected).toBe(first.id);
  });

  it('starts at most four at a time, and a card that cannot start does not stop the others', async () => {
    const made = (await board.create(input(['a', 'b', 'c', 'd', 'e']))).tasks;
    await expect(board.start(made.map((t) => t.id))).rejects.toMatchObject({
      key: 'error.task.tooManyStart',
    });
    expect(manager.list()).toHaveLength(0);

    // Its branch name is free, but git is told it is taken: the second card fails alone.
    git(repo, 'branch', 'ac/b');
    const result = await board.start(made.slice(0, 3).map((t) => t.id));
    // The name of the card that found `ac/b` taken goes to `ac/b-2`: nothing fails.
    expect(result.failed).toEqual([]);
    expect(result.started).toHaveLength(3);
    const branches = (await cards())
      .map((t) => t.branch)
      .filter(Boolean)
      .sort();
    expect(branches).toEqual(['ac/a', 'ac/b-2', 'ac/c']);
  });

  it('reports a card whose copy cannot be made, and goes on with the next', async () => {
    const [a, b] = (await board.create(input(['a', 'b']))).tasks as [Task, Task];
    // A base that was there when the card was made and is gone when it starts.
    git(repo, 'branch', 'sumiu', 'main');
    board.dispose();
    build();
    const sumiu = await board.create(input(['c'], { base: 'sumiu' }));
    git(repo, 'branch', '-D', 'sumiu');
    const result = await board.start([sumiu.tasks[2]!.id, a.id]);
    expect(result.failed.map((f) => f.taskId)).toEqual([sumiu.tasks[2]!.id]);
    expect(result.started).toEqual([a.id]);
    expect(b.sessionId).toBeUndefined();
  });

  it('starts a card without a copy in the folder of the repository', async () => {
    const [a] = (await board.create(input(['Direto'], { isolated: false }))).tasks as [Task];
    await board.start([a.id]);
    const [started] = await cards();
    expect(started!.branch).toBeUndefined();
    expect(manager.get(started!.sessionId!)?.worktree).toBeUndefined();
    expect(manager.get(started!.sessionId!)?.cwd.toLowerCase()).toBe(
      fs.realpathSync.native(repo).toLowerCase(),
    );
  });

  it('a session closed by hand sends the card back to "to do", with the branch', async () => {
    const [a] = (await board.create(input(['Fechada']))).tasks as [Task];
    await board.start([a.id]);
    const sessionId = (await cards())[0]!.sessionId!;
    await manager.remove(sessionId, { worktree: 'keep' });
    const [card] = await cards();
    expect(card).toMatchObject({ sessionClosed: true, branch: 'ac/fechada' });
    expect(card!.sessionId).toBeUndefined();
    expect(columnOf(card!)).toBe('todo');

    // Started again, it gets a branch of its own: the old one is not touched.
    await board.start([a.id]);
    const [again] = await cards();
    expect(again!.sessionClosed).toBeUndefined();
    expect(again!.branch).toBe('ac/fechada-2');
    expect(git(repo, 'branch', '--list', 'ac/fechada')).toContain('ac/fechada');
  });

  it('a card done keeps being done when its session is closed', async () => {
    const [a] = (await board.create(input(['Pronta']))).tasks as [Task];
    await board.start([a.id]);
    board.done(a.id, true);
    await manager.remove((await cards())[0]!.sessionId!, { worktree: 'keep' });
    const [card] = await cards();
    expect(card!.done).toBe(true);
    expect(card!.sessionClosed).toBeUndefined();
  });

  it('the branch entering the base finishes the card, and only after it moved', async () => {
    const [a] = (await board.create(input(['Entra na base']))).tasks as [Task];
    await board.start([a.id]);
    const copy = manager.get((await cards())[0]!.sessionId!)!.cwd;
    expect((await cards())[0]!.done).toBeUndefined();

    fs.writeFileSync(path.join(copy, 'novo.ts'), 'export const n = 1;\n');
    git(copy, 'add', '-A');
    git(copy, 'commit', '-q', '-m', 'trabalho');
    // Committed, not merged yet.
    expect((await cards())[0]!.done).toBeUndefined();

    git(repo, 'merge', '-q', '--no-ff', '-m', 'merge', 'ac/entra-na-base');
    const [card] = await cards();
    expect(card!.done).toBe(true);
    expect(columnOf(card!, facts())).toBe('done');
  });

  it('forgets the session of cards when the app opens again without it', async () => {
    const [a] = (await board.create(input(['Sumiu']))).tasks as [Task];
    await board.start([a.id]);
    board.dispose();
    // A new manager that does not know the session: closed while the app was off.
    const other = new SessionManager({
      ptys,
      sessions: [],
      selectedId: null,
      prefs: { ...DEFAULT_PREFERENCES },
      persist: () => {},
      resolveLaunch: () => ({ file: process.execPath, args: [FAKE_AGENT], env: {} }),
    });
    const reopened = new TaskBoard({
      manager: other,
      dir: path.join(state, 'tasks'),
      worktrees: () => ({ parent: copies }),
    });
    try {
      const [card] = (await reopened.list(repo)).tasks;
      expect(card).toMatchObject({ sessionClosed: true, branch: 'ac/sumiu' });
      expect(card!.sessionId).toBeUndefined();
    } finally {
      reopened.dispose();
      await other.dispose(0);
    }
  });

  it('tells which repositories have a board', async () => {
    const second = tempDir('ac task segundo-');
    try {
      git(second, 'init', '-q', '-b', 'main');
      git(second, 'config', 'user.email', 'teste@example.com');
      git(second, 'config', 'user.name', 'Teste');
      fs.writeFileSync(path.join(second, 'x'), 'x');
      git(second, 'add', '-A');
      git(second, 'commit', '-q', '-m', 'x');
      await board.create(input(['Aqui']));
      await board.create(input(['Ali'], { cwd: second }));
      const state1 = await board.list(repo);
      expect(state1.repos).toHaveLength(2);
      expect((await board.list(second)).tasks.map((t) => t.title)).toEqual(['Ali']);
    } finally {
      removeDir(second);
    }
  });
});
