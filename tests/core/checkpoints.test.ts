import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  CHECKPOINT_NAMESPACE,
  CheckpointService,
  listCheckpoints,
  snapshot,
  toPrune,
  type Checkpoint,
} from '@core/git/CheckpointService';
import { parseCheckpointBase, sanitizeCheckpointSettings } from '@shared/checkpoints';
import { UserError } from '@shared/i18n';
import { removeDir, tempDir } from './helpers';

const SESSION = '0f9c8a6e-1111-4222-8333-944445555666';
let root: string;
let data: string;

const git = (...args: string[]) =>
  execFileSync('git', ['--no-optional-locks', ...args], {
    cwd: root,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
  });
const write = (file: string, content: string | Buffer) => {
  const absolute = path.join(root, file);
  fs.mkdirSync(path.dirname(absolute), { recursive: true });
  fs.writeFileSync(absolute, content);
};
const read = (file: string) => fs.readFileSync(path.join(root, file), 'utf8');
const exists = (file: string) => fs.existsSync(path.join(root, file));
const remove = (file: string) => fs.rmSync(path.join(root, file));
/** Everything git knows about the branch and the index, which checkpoints must leave alone. */
const gitState = () => ({
  head: git('rev-parse', 'HEAD'),
  branch: git('symbolic-ref', 'HEAD'),
  log: git('log', '--oneline', '--exclude=refs/agent-controller/*', '--all'),
  index: fs.readFileSync(path.join(root, '.git', 'index')).toString('hex'),
  staged: git('diff', '--cached', '--name-status'),
  status: git('status', '--porcelain'),
});

const service = (options: Partial<ConstructorParameters<typeof CheckpointService>[0]> = {}) =>
  new CheckpointService({
    directory: data,
    rootOf: async () => root,
    knownSessions: () => new Set([SESSION]),
    ...options,
  });

beforeEach(() => {
  root = tempDir('ac-checkpoint-ção ');
  data = tempDir('ac-checkpoint-dados-');
  git('init', '-q', '-b', 'main');
  git('config', 'user.email', 'teste@example.com');
  git('config', 'user.name', 'Teste');
  git('config', 'commit.gpgsign', 'false');
  git('config', 'core.autocrlf', 'false');
  write('.gitignore', 'node_modules/\n*.log\n');
  write('a.ts', 'export const a = 1;\n');
  write('velho nome.txt', 'linha 1\nlinha 2\nlinha 3\nlinha 4\n');
  write('removido.txt', 'adeus\n');
  write('pasta/ação.ts', 'export const x = 1;\n');
  git('add', '-A');
  git('commit', '-q', '-m', 'base');
});
afterEach(() => {
  removeDir(root);
  removeDir(data);
});

describe('taking a checkpoint', () => {
  it('records the folder in a ref of the app, leaving the index, HEAD, branch and log as they were', async () => {
    write('a.ts', 'export const a = 2;\n');
    write('novo.ts', 'novo\n');
    git('add', 'novo.ts');
    write('staged-then-changed.ts', 'um\n');
    const before = gitState();

    const taken = await snapshot(root, SESSION, {
      indexFile: path.join(data, 'photo.index'),
      kind: 'turn',
    });
    expect(taken?.created).toBe(true);
    expect(gitState()).toEqual(before);

    const [checkpoint] = await listCheckpoints(root, SESSION);
    expect(checkpoint).toMatchObject({ kind: 'turn', turn: 1, id: '0', files: 3 });
    expect(checkpoint!.ref).toBe(`${CHECKPOINT_NAMESPACE}/${SESSION}/0`);
    expect(git('show', `${checkpoint!.commit}:a.ts`)).toBe('export const a = 2;\n');
    expect(git('show', `${checkpoint!.commit}:staged-then-changed.ts`)).toBe('um\n');
    // Not on any branch: `git log` of the user does not show it.
    expect(git('log', '--oneline')).not.toContain('agent-controller');
    expect(git('branch', '--contains', checkpoint!.commit)).toBe('');
  });

  it('leaves out what .gitignore covers, and files bigger than the limit, saying which', async () => {
    write('node_modules/pkg/index.js', 'module.exports = 1;\n');
    write('build.log', 'log\n');
    write('grande.bin', Buffer.alloc(4096, 1));
    write('pequeno.ts', 'ok\n');
    const taken = await snapshot(root, SESSION, {
      indexFile: path.join(data, 'photo.index'),
      kind: 'turn',
      maxFileBytes: 1024,
    });
    const files = git('ls-tree', '-r', '--name-only', taken!.checkpoint.commit).split('\n');
    expect(files).toContain('pequeno.ts');
    expect(files).not.toContain('node_modules/pkg/index.js');
    expect(files).not.toContain('build.log');
    expect(files).not.toContain('grande.bin');
    expect(taken!.checkpoint.skipped).toEqual(['grande.bin']);
  });

  it('writes nothing when the folder is the same as in the latest checkpoint', async () => {
    const options = { indexFile: path.join(data, 'photo.index'), kind: 'turn' as const };
    write('a.ts', 'export const a = 2;\n');
    expect((await snapshot(root, SESSION, options))?.created).toBe(true);
    expect((await snapshot(root, SESSION, options))?.created).toBe(false);
    write('a.ts', 'export const a = 3;\n');
    expect((await snapshot(root, SESSION, options))?.created).toBe(true);
    const all = await listCheckpoints(root, SESSION);
    expect(all.map((c) => [c.id, c.turn, c.files])).toEqual([
      ['0', 1, 1],
      ['1', 2, 1],
    ]);
  });

  it('works in a repository with no commit yet', async () => {
    const fresh = tempDir('ac-checkpoint-vazio-');
    try {
      execFileSync('git', ['init', '-q'], { cwd: fresh });
      fs.writeFileSync(path.join(fresh, 'x.txt'), 'x\n');
      const taken = await snapshot(fresh, SESSION, {
        indexFile: path.join(data, 'fresh.index'),
        kind: 'start',
      });
      expect(taken?.checkpoint).toMatchObject({ kind: 'start', turn: 0, files: 1 });
    } finally {
      removeDir(fresh);
    }
  });
});

describe('going back and undoing it', () => {
  it('brings back modified, removed, renamed and binary files, removes new ones, and keeps ignored ones', async () => {
    const checkpoints = service();
    const binary = Buffer.from([0, 1, 2, 3, 255, 0, 7]);
    write('imagem.bin', binary);
    await checkpoints.sessionStarted(SESSION);

    // The turn after: one of each kind of change.
    write('a.ts', 'export const a = 2;\n');
    remove('removido.txt');
    fs.renameSync(path.join(root, 'velho nome.txt'), path.join(root, 'novo nome.txt'));
    write('imagem.bin', Buffer.from([9, 9, 0, 9]));
    write('criado/agora.ts', 'novo\n');
    write('node_modules/dep.js', 'ignorado\n');
    write('saida.log', 'ignorado\n');
    await checkpoints.turnEnded(SESSION);
    // Something the user wrote after the turn: going back takes it too, and undoing brings it back.
    write('depois.ts', 'escrito depois\n');
    const before = gitState();

    const { items } = await checkpoints.list(SESSION);
    expect(items.map((c) => [c.kind, c.turn])).toEqual([
      ['start', 0],
      ['turn', 1],
    ]);
    const result = await checkpoints.restore(SESSION, '0');
    expect(read('a.ts')).toBe('export const a = 1;\n');
    expect(read('removido.txt')).toBe('adeus\n');
    expect(exists('velho nome.txt')).toBe(true);
    expect(exists('novo nome.txt')).toBe(false);
    expect(fs.readFileSync(path.join(root, 'imagem.bin'))).toEqual(binary);
    expect(exists('criado/agora.ts')).toBe(false);
    expect(exists('criado')).toBe(false);
    expect(exists('depois.ts')).toBe(false);
    expect(read('node_modules/dep.js')).toBe('ignorado\n');
    expect(read('saida.log')).toBe('ignorado\n');
    // The index, HEAD and log are the user's: only the files moved.
    expect({ ...gitState(), status: '' }).toEqual({ ...before, status: '' });

    // The photo taken before going back is the way back: the turn comes back whole.
    expect((await checkpoints.list(SESSION)).items.at(-1)).toMatchObject({
      kind: 'restore',
      restoredTo: 0,
      id: result.undoId,
    });
    await checkpoints.restore(SESSION, result.undoId);
    expect(read('a.ts')).toBe('export const a = 2;\n');
    expect(exists('removido.txt')).toBe(false);
    expect(exists('novo nome.txt')).toBe(true);
    expect(exists('velho nome.txt')).toBe(false);
    expect(fs.readFileSync(path.join(root, 'imagem.bin'))).toEqual(Buffer.from([9, 9, 0, 9]));
    expect(read('criado/agora.ts')).toBe('novo\n');
    expect(read('depois.ts')).toBe('escrito depois\n');
    expect(gitState()).toEqual(before);
    // Undoing reuses the checkpoint that had those files: no new one each way.
    expect((await checkpoints.list(SESSION)).items).toHaveLength(3);
  });

  it('three turns: compares only the last one, goes back to the first and undoes it', async () => {
    const checkpoints = service();
    await checkpoints.sessionStarted(SESSION);
    for (const turn of [1, 2, 3]) {
      write(`turno${turn}.ts`, `export const t = ${turn};\n`);
      await checkpoints.turnEnded(SESSION);
    }
    const before = gitState();
    const previous = await checkpoints.previous(SESSION);
    expect(previous?.checkpoint.turn).toBe(2);
    expect(
      git(
        'diff-tree',
        '-r',
        '--name-only',
        previous!.checkpoint.tree,
        (await checkpoints.get(SESSION, '3')).checkpoint.tree,
      ).trim(),
    ).toBe('turno3.ts');

    const { undoId } = await checkpoints.restore(SESSION, '1');
    expect(exists('turno1.ts')).toBe(true);
    expect(exists('turno2.ts')).toBe(false);
    expect(exists('turno3.ts')).toBe(false);
    await checkpoints.restore(SESSION, undoId);
    expect(['turno1.ts', 'turno2.ts', 'turno3.ts'].every(exists)).toBe(true);
    expect(gitState()).toEqual(before);
  });

  it('leaves files too big for the photo as they are', async () => {
    const checkpoints = service({ maxFileBytes: 1024 });
    write('grande.bin', Buffer.alloc(4096, 1));
    await checkpoints.sessionStarted(SESSION);
    write('grande.bin', Buffer.alloc(4096, 2));
    write('a.ts', 'export const a = 2;\n');
    await checkpoints.turnEnded(SESSION);
    await checkpoints.restore(SESSION, '0');
    expect(read('a.ts')).toBe('export const a = 1;\n');
    expect(fs.readFileSync(path.join(root, 'grande.bin'))[0]).toBe(2);
  });

  it('is refused while the git of someone else holds the index, and for an id the session does not have', async () => {
    const checkpoints = service();
    await checkpoints.sessionStarted(SESSION);
    write('a.ts', 'export const a = 2;\n');
    await checkpoints.turnEnded(SESSION);
    await expect(checkpoints.restore(SESSION, '9')).rejects.toThrow(UserError);
    fs.writeFileSync(path.join(root, '.git', 'index.lock'), '');
    try {
      await expect(checkpoints.restore(SESSION, '0')).rejects.toMatchObject({
        key: 'error.git.locked',
      });
      expect(read('a.ts')).toBe('export const a = 2;\n');
    } finally {
      fs.rmSync(path.join(root, '.git', 'index.lock'));
    }
  });
});

describe('keeping and pruning', () => {
  const at = (session: string, n: number, days: number): Checkpoint => ({
    id: String(n),
    n,
    session,
    kind: 'turn',
    turn: n,
    at: Date.UTC(2026, 0, 31) - days * 24 * 60 * 60 * 1000,
    files: 1,
    skipped: [],
    ref: `${CHECKPOINT_NAMESPACE}/${session}/${n}`,
    commit: 'c',
    tree: 't',
  });
  const now = Date.UTC(2026, 0, 31);

  it('keeps the newest ones of the session and drops the old ones, always keeping the latest', () => {
    const all = [at('s', 0, 10), at('s', 1, 3), at('s', 2, 2), at('s', 3, 1)];
    const ids = (list: Checkpoint[]) => list.map((c) => c.n).sort();
    expect(ids(toPrune(all, 's', new Set(['s']), { keep: 2, days: 7 }, now))).toEqual([0, 1]);
    expect(ids(toPrune(all, 's', new Set(['s']), { keep: 50, days: 7 }, now))).toEqual([0]);
    expect(ids(toPrune([at('s', 0, 30)], 's', new Set(['s']), { keep: 50, days: 7 }, now))).toEqual(
      [],
    );
  });

  it('drops old checkpoints of sessions that are gone, by age only', () => {
    const all = [at('s', 0, 1), at('gone', 0, 10), at('gone', 1, 1), at('other', 0, 10)];
    const gone = toPrune(all, 's', new Set(['s', 'other']), { keep: 50, days: 7 }, now);
    expect(gone.map((c) => `${c.session}/${c.n}`)).toEqual(['gone/0']);
  });

  it('prunes after each checkpoint, removes all of a session, and tells what they take', async () => {
    let clock = Date.UTC(2026, 0, 1);
    const checkpoints = service({
      settings: () => ({ enabled: true, keep: 2, days: 7 }),
      now: () => clock,
    });
    for (const turn of [1, 2, 3, 4]) {
      write('a.ts', `export const a = ${turn * 100};\n`);
      clock += 1000;
      await checkpoints.turnEnded(SESSION);
    }
    expect((await checkpoints.list(SESSION)).items.map((c) => c.turn)).toEqual([3, 4]);
    const usage = await checkpoints.usage(SESSION);
    expect(usage.count).toBe(2);
    expect(usage.bytes).toBeGreaterThan(0);
    expect(await checkpoints.removeAll(SESSION)).toBe(2);
    expect(git('for-each-ref', CHECKPOINT_NAMESPACE)).toBe('');
  });

  it('a session that changes nothing leaves no ref in the repository', async () => {
    const checkpoints = service();
    await checkpoints.sessionStarted(SESSION);
    await checkpoints.turnEnded(SESSION);
    expect(git('for-each-ref', CHECKPOINT_NAMESPACE)).toBe('');
    // The first turn that changes something keeps the start along with it.
    write('a.ts', 'export const a = 2;\n');
    await checkpoints.turnEnded(SESSION);
    expect((await checkpoints.list(SESSION)).items.map((c) => [c.id, c.kind, c.files])).toEqual([
      ['0', 'start', 0],
      ['1', 'turn', 1],
    ]);
  });

  it('takes no checkpoint when they are turned off, nor outside a repository', async () => {
    write('a.ts', 'export const a = 2;\n');
    await service({ settings: () => ({ enabled: false, keep: 50, days: 7 }) }).turnEnded(SESSION);
    expect(await listCheckpoints(root, SESSION)).toEqual([]);
    const outside = service({ rootOf: async () => null });
    await outside.turnEnded(SESSION);
    expect(await outside.list(SESSION)).toEqual({ available: false, items: [] });
  });

  it('writes the outcome of the checks of the turn on its checkpoint', async () => {
    const checkpoints = service();
    write('a.ts', 'export const a = 2;\n');
    await checkpoints.turnEnded(SESSION);
    await checkpoints.recordChecks(SESSION, 'failed');
    expect((await checkpoints.list(SESSION)).items[0]).toMatchObject({ checks: 'failed' });
  });
});

describe('shared helpers', () => {
  it('reads the base of the panel for a checkpoint or a pair of them, and nothing else', () => {
    expect(parseCheckpointBase('checkpoint:3')).toEqual({ from: '3' });
    expect(parseCheckpointBase('checkpoint:1..4')).toEqual({ from: '1', to: '4' });
    expect(parseCheckpointBase('checkpoint:../x')).toBeNull();
    expect(parseCheckpointBase('head')).toBeNull();
  });

  it('keeps the settings within their limits', () => {
    expect(sanitizeCheckpointSettings({ keep: 0, days: 9999 })).toEqual({
      enabled: true,
      keep: 2,
      days: 365,
    });
    expect(sanitizeCheckpointSettings(undefined)).toEqual({ enabled: true, keep: 50, days: 7 });
  });
});
