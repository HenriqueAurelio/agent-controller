import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { changedFiles, ExperimentService, parseNumstat } from '@core/experiments/ExperimentService';
import { PtyManager } from '@core/pty/PtyManager';
import { SessionManager } from '@core/sessions/SessionManager';
import { createSocketPath, HookServer } from '@core/signals/HookServer';
import { attemptBranch } from '@shared/experiments';
import { DEFAULT_PREFERENCES } from '@shared/prefs';
import { AGENTCTL_SCRIPT, FIXTURES, removeDir, tempDir, waitFor } from './helpers';

const FAKE_AGENT = path.join(FIXTURES, 'fake-agent.cjs');

const git = (cwd: string, ...args: string[]) =>
  execFileSync('git', args, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
const write = (root: string, file: string, content: string) => {
  const absolute = path.join(root, file);
  fs.mkdirSync(path.dirname(absolute), { recursive: true });
  fs.writeFileSync(absolute, content);
};

describe('parseNumstat', () => {
  it('reads counts, paths with spaces and binary files', () => {
    const output = '3\t1\ta b.ts\0-\t-\timg.png\0';
    expect(parseNumstat(output)).toEqual([
      { path: 'a b.ts', added: 3, removed: 1, binary: false },
      { path: 'img.png', added: 0, removed: 0, binary: true },
    ]);
  });
});

describe('attemptBranch', () => {
  it('makes a branch git takes out of any name', () => {
    expect(attemptBranch('Refatorar o login!', 0)).toBe('ac/refatorar-o-login-1');
    expect(attemptBranch('???', 2)).toBe('ac/experimento-3');
  });
});

describe('ExperimentService', () => {
  let repo: string;
  let copies: string;
  let state: string;
  let ptys: PtyManager;
  let hooks: HookServer;
  let manager: SessionManager;
  let service: ExperimentService;

  const build = () => {
    service = new ExperimentService({
      manager,
      file: path.join(state, 'experiments.json'),
      worktrees: () => ({ parent: copies }),
    });
  };
  const input = (name = 'Login', attempts = 3, base = 'main') => ({
    name,
    cwd: repo,
    prompt: 'work',
    base,
    attempts: Array.from({ length: attempts }, (_, i) => ({
      profile: i === 2 ? ('codex' as const) : ('claude-code' as const),
    })),
  });

  beforeEach(async () => {
    repo = tempDir('ac exp repo ação-');
    copies = tempDir('ac exp cópias-');
    state = tempDir('ac exp estado-');
    git(repo, 'init', '-q', '-b', 'main');
    git(repo, 'config', 'user.email', 'teste@example.com');
    git(repo, 'config', 'user.name', 'Teste');
    git(repo, 'config', 'commit.gpgsign', 'false');
    git(repo, 'config', 'core.autocrlf', 'false');
    write(repo, 'app.ts', 'export const a = 1;\nexport const b = 2;\n');
    write(repo, 'util.ts', 'export const u = 1;\n');
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
    service.dispose();
    await manager.dispose(0);
    await ptys.killAll({ graceMs: 0 });
    await hooks.close();
    for (const dir of [copies, repo, state]) removeDir(dir);
  });

  it('makes a copy, a branch and a session per attempt in one group, and sends the prompt to all', async () => {
    const written: [string, string][] = [];
    const write = ptys.write.bind(ptys);
    vi.spyOn(ptys, 'write').mockImplementation((id, data) => {
      written.push([id, data]);
      write(id, data);
    });
    const created = await service.create(input());
    expect(created.sessionIds).toHaveLength(3);

    const group = manager.listGroups().find((g) => g.id === created.groupId);
    expect(group).toMatchObject({ name: 'Login', experimentId: created.id });
    const views = manager.list();
    expect(views.map((v) => v.name)).toEqual(['Login #1', 'Login #2', 'Login #3']);
    expect(views.map((v) => v.profile)).toEqual(['claude-code', 'claude-code', 'codex']);
    expect(views.every((v) => v.groupId === created.groupId)).toBe(true);
    expect(new Set(views.map((v) => v.cwd)).size).toBe(3);
    expect(views.map((v) => git(v.cwd, 'branch', '--show-current').trim())).toEqual([
      'ac/login-1',
      'ac/login-2',
      'ac/login-3',
    ]);

    // The prompt is typed when each agent is at its input. (What the fake agent does with it
    // differs between a ConPTY, which drops the paste markers, and a Linux terminal: the writes
    // are what is checked.)
    await waitFor(
      async () => (await service.compare(created.id)).attempts.every((a) => a.promptSent),
      { timeout: 20000, message: 'o pedido chegar às três' },
    );
    for (const id of created.sessionIds) {
      const typed = written.filter(([to]) => to === id).map(([, data]) => data);
      expect(typed.some((data) => data.includes('work'))).toBe(true);
    }
    const comparison = await service.compare(created.id);
    expect(comparison.attempts.every((a) => a.elapsedMs !== null)).toBe(true);

    // Kept on disk, and read back by the next service.
    const stored = JSON.parse(fs.readFileSync(path.join(state, 'experiments.json'), 'utf8'));
    expect(stored.experiments[0]).toMatchObject({ name: 'Login', base: 'main', prompt: 'work' });
    expect(stored.experiments[0].baseCommit).toBe(git(repo, 'rev-parse', 'main').trim());
    service.dispose();
    build();
    expect(service.list()).toHaveLength(1);
  });

  it('refuses what cannot be an experiment, before any copy is made', async () => {
    await expect(service.create(input('Login', 0))).rejects.toThrow(/1 a 4 tentativas/);
    await expect(service.create(input('Login', 5))).rejects.toThrow(/1 a 4 tentativas/);
    await expect(service.create({ ...input(), name: '  ' })).rejects.toThrow(/nome/);
    await expect(service.create({ ...input(), prompt: ' ' })).rejects.toThrow(/pedido/);
    await expect(service.create(input('Login', 2, 'nao-existe'))).rejects.toThrow(
      /não é uma branch/,
    );
    await expect(service.create({ ...input(), cwd: copies })).rejects.toThrow();
    expect(manager.list()).toEqual([]);
    expect(manager.listGroups()).toEqual([]);
    expect(fs.readdirSync(copies)).toEqual([]);
  });

  it('an attempt that cannot be made closes the ones before it, keeping their branches', async () => {
    git(repo, 'branch', 'ac/login-2');
    await expect(service.create(input('Login', 3))).rejects.toThrow(/ac\/login-2/);
    expect(manager.list()).toEqual([]);
    expect(manager.listGroups()).toEqual([]);
    expect(service.list()).toEqual([]);
    // Nothing is deleted without being asked: the first copy and its branch are still there.
    expect(git(repo, 'branch', '--list', 'ac/login-1')).toContain('ac/login-1');
  });

  it('compares the files, the lines and a file in every attempt against the same base', async () => {
    const created = await service.create(input());
    const [one, two, three] = manager.list();
    // One edits a file and adds another; two commits an edit to a different file; three does nothing.
    write(one!.cwd, 'app.ts', 'export const a = 1;\nexport const b = 3;\nexport const c = 4;\n');
    write(one!.cwd, 'novo.ts', 'um\ndois\ntres\n');
    write(two!.cwd, 'util.ts', 'export const u = 2;\n');
    git(two!.cwd, 'commit', '-qam', 'tentativa dois');

    const comparison = await service.compare(created.id);
    expect(comparison).toMatchObject({ name: 'Login', base: 'main', prompt: 'work' });
    const [a1, a2, a3] = comparison.attempts;
    expect(a1!.files).toEqual([
      { path: 'app.ts', added: 2, removed: 1, binary: false },
      { path: 'novo.ts', added: 3, removed: 0, binary: false },
    ]);
    expect([a1!.added, a1!.removed]).toEqual([5, 1]);
    // A committed change counts as well: the base is a commit, not the state of the branch.
    expect(a2!.files).toEqual([{ path: 'util.ts', added: 1, removed: 1, binary: false }]);
    expect(a3!.files).toEqual([]);
    expect(a3!.added).toBe(0);
    expect(comparison.files).toEqual(['app.ts', 'novo.ts', 'util.ts']);
    expect(comparison.attempts.map((a) => a.branch)).toEqual([
      'ac/login-1',
      'ac/login-2',
      'ac/login-3',
    ]);

    const app = await service.diff(created.id, 'app.ts');
    expect(app.map((d) => d.kind)).toEqual(['text', 'unchanged', 'unchanged']);
    expect(app[0]).toMatchObject({ sessionId: one!.id });
    expect((app[0] as { text: string }).text).toContain('+export const b = 3;');
    expect((app[0] as { text: string }).text).toContain('-export const b = 2;');

    // A file git does not know yet reads as all added; a committed one as its diff.
    const novo = await service.diff(created.id, 'novo.ts');
    expect((novo[0] as { text: string }).text).toContain('@@ -0,0 +1,3 @@');
    const util = await service.diff(created.id, 'util.ts');
    expect(util.map((d) => d.kind)).toEqual(['unchanged', 'text', 'unchanged']);

    // A name the attempt did not change is not read, wherever it points.
    const outside = await service.diff(created.id, '../../etc/passwd');
    expect(outside.every((d) => d.kind === 'unchanged')).toBe(true);
    expect(three!.cwd).not.toBe(one!.cwd);
  });

  it('does not show a diff that is too large, nor a binary file', async () => {
    const created = await service.create(input('Grande', 1));
    const [only] = manager.list();
    write(only!.cwd, 'big.txt', `${'x'.repeat(100)}\n`.repeat(3000));
    fs.writeFileSync(path.join(only!.cwd, 'img.bin'), Buffer.from([0, 1, 2, 0, 3]));
    const big = await service.diff(created.id, 'big.txt');
    expect(big[0]).toMatchObject({ kind: 'too-large' });
    const bin = await service.diff(created.id, 'img.bin');
    expect(bin[0]).toMatchObject({ kind: 'binary' });
    expect(
      (await changedFiles(only!.cwd, git(repo, 'rev-parse', 'main').trim())).files,
    ).toHaveLength(2);
  });

  it('keeping one closes the others and removes their copies, never a branch, nor a dirty copy', async () => {
    const created = await service.create(input());
    const [one, two, three] = manager.list();
    write(two!.cwd, 'pendente.ts', 'x\n');

    const first = await service.keep(created.id, one!.id);
    expect(first.removed).toBe(1);
    expect(first.kept).toHaveLength(1);
    expect(first.kept[0]).toMatchObject({ sessionId: two!.id, name: 'Login #2', folder: two!.cwd });
    expect(first.kept[0]!.reason).toMatch(/sem commit/);
    // The copy with something not committed stays, with its session; the clean one is gone.
    expect(manager.has(two!.id)).toBe(true);
    expect(fs.existsSync(two!.cwd)).toBe(true);
    expect(manager.has(three!.id)).toBe(false);
    expect(fs.existsSync(three!.cwd)).toBe(false);
    const rows = (await service.compare(created.id)).attempts;
    expect(rows.map((r) => [r.sessionId, r.chosen])).toEqual([
      [one!.id, true],
      [two!.id, false],
    ]);

    // Once the copy is clean, the same call finishes the job.
    fs.rmSync(path.join(two!.cwd, 'pendente.ts'));
    const second = await service.keep(created.id, one!.id);
    expect(second).toEqual({ removed: 1, kept: [] });
    expect(manager.list().map((v) => v.id)).toEqual([one!.id]);
    expect(manager.list()[0]!.groupId).toBeUndefined();
    expect(manager.listGroups()).toEqual([]);
    expect(service.list()).toEqual([]);
    expect(fs.existsSync(one!.cwd)).toBe(true);
    const branches = git(repo, 'branch', '--list', 'ac/*');
    for (const n of [1, 2, 3]) expect(branches).toContain(`ac/login-${n}`);
    await expect(service.compare(created.id)).rejects.toThrow(/não encontrado/);
  });

  it('keeping a session that is not an attempt is refused', async () => {
    const created = await service.create(input('Login', 2));
    const other = manager.create({ name: 'Solta', cwd: repo, profile: 'claude-code' });
    await expect(service.keep(created.id, other.id)).rejects.toThrow(/não é uma tentativa/);
    expect(manager.list()).toHaveLength(3);
  });

  it('forgets an attempt whose session was closed by hand, and the experiment with the last', async () => {
    const created = await service.create(input('Login', 2));
    const [one, two] = manager.list();
    await manager.remove(one!.id);
    expect((await service.compare(created.id)).attempts.map((a) => a.sessionId)).toEqual([two!.id]);
    await manager.remove(two!.id);
    expect(service.list()).toEqual([]);
  });
});
