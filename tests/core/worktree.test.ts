import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { ChangesService } from '@core/git/ChangesService';
import { linkedGitDir, RepoWatcher } from '@core/git/RepoWatcher';
import {
  checkBranchName,
  createWorktree,
  defaultWorktreesFolder,
  folderSize,
  listWorktrees,
  localBranches,
  parseWorktreeList,
  removeWorktree,
  suggestWorktreeFolder,
  worktreeOwner,
  worktreeStatus,
} from '@core/git/WorktreeService';
import { PtyManager } from '@core/pty/PtyManager';
import { SessionManager } from '@core/sessions/SessionManager';
import type { RunResult } from '@core/tools/ToolRunner';
import { createAppStore } from '@core/store/appStore';
import { UserError } from '@shared/i18n';
import { DEFAULT_PREFERENCES } from '@shared/prefs';
import type { Session } from '@shared/session';
import { removeDir, sleep, tempDir, waitFor } from './helpers';

let repo: string;
let copies: string;

const git = (cwd: string, ...args: string[]) =>
  execFileSync('git', args, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
const write = (root: string, file: string, content: string) => {
  const absolute = path.join(root, file);
  fs.mkdirSync(path.dirname(absolute), { recursive: true });
  fs.writeFileSync(absolute, content);
};

beforeEach(() => {
  // Spaces and accents in both: the folders of real users have them.
  repo = tempDir('ac repo ação-');
  copies = tempDir('ac cópias-');
  git(repo, 'init', '-q', '-b', 'main');
  git(repo, 'config', 'user.email', 'teste@example.com');
  git(repo, 'config', 'user.name', 'Teste');
  git(repo, 'config', 'commit.gpgsign', 'false');
  git(repo, 'config', 'core.autocrlf', 'false');
  write(repo, 'app.ts', 'export const a = 1;\n');
  git(repo, 'add', '-A');
  git(repo, 'commit', '-q', '-m', 'base');
});
afterEach(() => {
  // Worktrees first: removing the repository would leave them dangling, but they are temp too.
  removeDir(copies);
  removeDir(repo);
});

describe('WorktreeService', () => {
  it('creates a copy on a new branch, lists it, and knows the repository it belongs to', async () => {
    const folder = path.join(copies, 'repo', 'login ação');
    const created = await createWorktree({ repo, branch: 'ac/login', base: 'main', folder });
    expect(created).toMatchObject({ branch: 'ac/login', base: 'main' });
    expect(fs.readFileSync(path.join(folder, 'app.ts'), 'utf8')).toBe('export const a = 1;\n');
    expect(git(folder, 'branch', '--show-current').trim()).toBe('ac/login');

    const list = await listWorktrees(repo);
    expect(list).toHaveLength(2);
    expect(list[0]).toMatchObject({ main: true, branch: 'main' });
    expect(list[1]).toMatchObject({ main: false, branch: 'ac/login' });
    expect(fs.realpathSync(list[1]!.folder)).toBe(fs.realpathSync(folder));

    expect(fs.realpathSync((await worktreeOwner(folder))!)).toBe(fs.realpathSync(repo));
    // The repository itself is not a copy, nor is a plain folder.
    expect(await worktreeOwner(repo)).toBeNull();
    expect(await worktreeOwner(copies)).toBeNull();
  });

  it('refuses a bad branch name, a branch that exists, an unknown base and a folder that exists', async () => {
    const folder = (name: string) => path.join(copies, name);
    await expect(checkBranchName(repo, 'tem espaço')).rejects.toThrow(UserError);
    await expect(checkBranchName(repo, '-x')).rejects.toThrow(/não serve como nome de branch/);
    await expect(checkBranchName(repo, 'a..b')).rejects.toThrow(UserError);
    expect(await checkBranchName(repo, ' ac/certo ')).toBe('ac/certo');

    await expect(
      createWorktree({ repo, branch: 'main', base: 'main', folder: folder('a') }),
    ).rejects.toThrow(/já existe/);
    await expect(
      createWorktree({ repo, branch: 'ac/x', base: 'nao-existe', folder: folder('b') }),
    ).rejects.toThrow(/não é uma branch/);
    fs.mkdirSync(folder('c'));
    await expect(
      createWorktree({ repo, branch: 'ac/y', base: 'main', folder: folder('c') }),
    ).rejects.toThrow(/já existe/);
    await expect(
      createWorktree({ repo: copies, branch: 'ac/z', base: 'main', folder: folder('d') }),
    ).rejects.toThrow(/não está num repositório git/);
    // Nothing was left behind by what was refused.
    expect(await listWorktrees(repo)).toHaveLength(1);
  });

  it('refuses to remove a copy with changes, and removes a clean one keeping its branch', async () => {
    const folder = path.join(copies, 'pagina');
    await createWorktree({ repo, branch: 'ac/pagina', base: 'main', folder });
    write(folder, 'app.ts', 'export const a = 2;\n');
    write(folder, 'novo arquivo.ts', 'novo\n');
    expect((await worktreeStatus(folder)).map((c) => c.path).sort()).toEqual([
      'app.ts',
      'novo arquivo.ts',
    ]);
    await expect(removeWorktree(folder)).rejects.toThrow(/2 arquivo\(s\) sem commit/);
    expect(fs.existsSync(folder)).toBe(true);

    git(folder, 'add', '-A');
    git(folder, 'commit', '-q', '-m', 'trabalho');
    await removeWorktree(folder);
    expect(fs.existsSync(folder)).toBe(false);
    expect(await listWorktrees(repo)).toHaveLength(1);
    // The work is still there, on its branch.
    expect(git(repo, 'branch', '--list', 'ac/pagina').trim()).toContain('ac/pagina');
    await expect(removeWorktree(repo)).rejects.toThrow(/não é uma cópia isolada/);
  });

  it('names the folder of a copy after its repository and branch, in a short default place', () => {
    expect(suggestWorktreeFolder(copies, path.join('x', 'Minha Loja'), 'ac/Ação rápida')).toBe(
      path.join(copies, 'Minha-Loja', 'Acao-rapida'),
    );
    expect(defaultWorktreesFolder(path.join('h', 'u'))).toBe(
      path.join('h', 'u', '.agent-controller', 'worktrees'),
    );
  });

  it('lists the local branches, the checked-out one first', async () => {
    git(repo, 'branch', 'outra');
    expect(await localBranches(repo)).toEqual({ current: 'main', all: ['main', 'outra'] });
  });

  it('parses the porcelain list, detached and bare included', () => {
    const list = parseWorktreeList(
      'worktree /r\nHEAD aaa\nbranch refs/heads/main\n\nworktree /c\nHEAD bbb\ndetached\n\n',
    );
    expect(list.map((w) => [w.branch, w.head, w.main])).toEqual([
      ['main', 'aaa', true],
      [null, 'bbb', false],
    ]);
  });

  it('measures a folder, and says when it stopped counting', async () => {
    write(copies, 'a.txt', '12345');
    write(copies, 'sub/b.txt', '123');
    expect(await folderSize(copies)).toEqual({ bytes: 8, complete: true });
    expect((await folderSize(copies, 1)).complete).toBe(false);
  });
});

describe('compare with the base of the branch', () => {
  it('shows everything the branch changed since its base: commits and what is not committed', async () => {
    const folder = path.join(copies, 'base');
    await createWorktree({ repo, branch: 'ac/base', base: 'main', folder });
    write(folder, 'primeiro.ts', '1\n');
    git(folder, 'add', '-A');
    git(folder, 'commit', '-q', '-m', 'um');
    write(folder, 'app.ts', 'export const a = 3;\n');
    git(folder, 'commit', '-q', '-am', 'dois');
    write(folder, 'sem commit.ts', 'ainda não\n');
    // The base moves on: what it did is not the branch's.
    write(repo, 'da main.ts', 'outro trabalho\n');
    git(repo, 'add', '-A');
    git(repo, 'commit', '-q', '-m', 'main andou');

    const work = tempDir();
    const service = new ChangesService({ workDirectory: work, onChange: () => {} });
    try {
      const head = await service.overview('s', folder, 'head', { branchBase: 'main' });
      expect(head.ok && head.changes.map((c) => c.path)).toEqual(['sem commit.ts']);
      expect(head.ok && head.hasBranchBase).toBe(true);

      const branch = await service.overview('s', folder, 'branchBase', { branchBase: 'main' });
      expect(branch.ok && branch.base).toBe('branchBase');
      expect(branch.ok && branch.changes.map((c) => `${c.kind} ${c.path}`)).toEqual([
        'modified app.ts',
        'added primeiro.ts',
        'added sem commit.ts',
      ]);
      const diff = await service.diff('s', 'app.ts', 'branchBase');
      expect(diff.original).toEqual({ kind: 'text', text: 'export const a = 1;\n' });
      expect(diff.modified).toEqual({ kind: 'text', text: 'export const a = 3;\n' });

      // A session that is not in a copy has no such base.
      const plain = await service.overview('r', repo, 'branchBase');
      expect(plain.ok && plain.base).toBe('head');
      expect(plain.ok && plain.hasBranchBase).toBe(false);
    } finally {
      service.dispose();
      removeDir(work);
    }
  });
});

describe('the watcher of the panel, in a copy', () => {
  it('sees a commit made in the copy, whose index lives in the repository it came from', async () => {
    const folder = path.join(copies, 'vigiada');
    await createWorktree({ repo, branch: 'ac/vigiada', base: 'main', folder });
    expect(linkedGitDir(folder)).toContain(path.join('.git', 'worktrees'));
    expect(linkedGitDir(repo)).toBeNull();
    write(folder, 'novo.ts', '1\n');
    git(folder, 'add', '-A');
    let changes = 0;
    const watcher = new RepoWatcher({ root: folder, onChange: () => changes++, debounceMs: 100 });
    watcher.start();
    try {
      await sleep(300);
      changes = 0;
      git(folder, 'commit', '-q', '-m', 'na cópia');
      await waitFor(() => changes > 0, { message: 'o commit na cópia não chegou ao watcher' });
    } finally {
      watcher.stop();
    }
  });
});

describe('sessions in a copy of the repository', () => {
  let ptys: PtyManager;
  let manager: SessionManager;
  let setups: { command: string; cwd: string }[];
  let setupResult: Partial<RunResult>;

  beforeEach(() => {
    ptys = new PtyManager();
    setups = [];
    setupResult = { exitCode: 0, output: '' };
    manager = new SessionManager({
      ptys,
      sessions: [],
      selectedId: null,
      prefs: DEFAULT_PREFERENCES,
      persist: () => {},
      resolveLaunch: () => ({ file: process.execPath, args: ['-e', ''], env: {} }),
      runSetup: async (command, cwd) => {
        setups.push({ command, cwd });
        return {
          exitCode: 0,
          stdout: '',
          stderr: '',
          output: '',
          truncated: false,
          timedOut: false,
          cancelled: false,
          durationMs: 1,
          ...setupResult,
        };
      },
    });
  });
  afterEach(async () => {
    await manager.dispose(0);
    await ptys.killAll({ graceMs: 0 });
  });

  const input = (name: string, branch: string) => ({
    name,
    cwd: repo,
    profile: 'claude-code' as const,
    worktree: { branch, base: 'main' },
  });

  it('two sessions get a copy and a branch each, prepared before they exist', async () => {
    const login = await manager.createInWorktree(input('Login', 'ac/login'), {
      parent: copies,
      setup: 'npm ci',
    });
    const report = await manager.createInWorktree(input('Relatório', 'ac/relatorio'), {
      parent: copies,
    });
    expect(login.worktree).toMatchObject({ branch: 'ac/login', base: 'main' });
    expect(fs.realpathSync(login.worktree!.repoRoot)).toBe(fs.realpathSync(repo));
    expect(login.cwd).not.toBe(report.cwd);
    expect(git(login.cwd, 'branch', '--show-current').trim()).toBe('ac/login');
    expect(git(report.cwd, 'branch', '--show-current').trim()).toBe('ac/relatorio');
    // The setup ran once, in the copy, and only where there was one.
    expect(setups).toEqual([{ command: 'npm ci', cwd: login.cwd }]);

    // What one does is not in the other.
    write(login.cwd, 'app.ts', 'export const a = 9;\n');
    expect((await worktreeStatus(login.cwd)).map((c) => c.path)).toEqual(['app.ts']);
    expect(await worktreeStatus(report.cwd)).toEqual([]);
  });

  it('a copy that cannot be made, or prepared, makes no session', async () => {
    await expect(
      manager.createInWorktree(input('Ruim', 'nome ruim'), { parent: copies }),
    ).rejects.toThrow(/não serve como nome de branch/);
    setupResult = { exitCode: 1, output: 'npm ERR! sem rede\n' };
    await expect(
      manager.createInWorktree(input('Sem rede', 'ac/sem-rede'), {
        parent: copies,
        setup: 'npm ci',
      }),
    ).rejects.toThrow(/npm ci falhou[\s\S]*sem rede/);
    expect(manager.list()).toEqual([]);
  });

  it('closing keeps the copy by default; removing refuses changes and shared copies', async () => {
    const s = await manager.createInWorktree(input('Login', 'ac/login'), { parent: copies });
    const copy = manager.duplicate(s.id);
    // The duplicate works in the same copy: it is not made again.
    expect(copy.cwd).toBe(s.cwd);
    expect(copy.worktree).toEqual(s.worktree);
    await expect(manager.remove(s.id, { worktree: 'remove' })).rejects.toThrow(/Login \(2\)/);
    expect(manager.has(s.id)).toBe(true);

    await manager.remove(copy.id);
    expect(fs.existsSync(s.cwd)).toBe(true);

    write(s.cwd, 'pendente.ts', 'x\n');
    await expect(manager.remove(s.id, { worktree: 'remove' })).rejects.toThrow(/sem commit/);
    expect(manager.has(s.id)).toBe(true);
    expect(fs.existsSync(path.join(s.cwd, 'pendente.ts'))).toBe(true);

    fs.rmSync(path.join(s.cwd, 'pendente.ts'));
    await manager.remove(s.id, { worktree: 'remove' });
    expect(manager.has(s.id)).toBe(false);
    expect(fs.existsSync(s.cwd)).toBe(false);
    expect(git(repo, 'branch', '--list', 'ac/login')).toContain('ac/login');
  });

  it('the copy of a session is saved with it, and checked when read back', () => {
    const dir = tempDir();
    try {
      const store = createAppStore(dir);
      const data = store.load();
      const session: Session = {
        id: 'a',
        name: 'Login',
        cwd: path.join(copies, 'x'),
        profile: 'claude-code',
        worktree: { repoRoot: repo, branch: 'ac/login', base: 'main' },
        order: 0,
      };
      const broken = { ...session, id: 'b', worktree: { repoRoot: repo, branch: 7 } };
      store.save({
        ...data,
        sessions: [session, broken as never],
        worktrees: { folder: copies, setup: 'npm ci\nrm -rf /' },
      });
      const back = createAppStore(dir).load();
      expect(back.sessions[0]!.worktree).toEqual(session.worktree);
      expect(back.sessions[1]!.worktree).toBeUndefined();
      // A command of more than one line is never kept.
      expect(back.worktrees).toEqual({ folder: copies, setup: '' });
    } finally {
      removeDir(dir);
    }
  });
});
