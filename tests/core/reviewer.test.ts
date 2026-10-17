import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { HandoffService } from '@core/handoff/HandoffService';
import { ReviewerService, turnDiff } from '@core/handoff/ReviewerService';
import { buildLaunchCommand } from '@core/agents';
import { PROFILES } from '@core/agents/profiles';
import { PtyManager } from '@core/pty/PtyManager';
import { SessionManager } from '@core/sessions/SessionManager';
import { createSocketPath, HookServer } from '@core/signals/HookServer';
import { DEFAULT_PREFERENCES } from '@shared/prefs';
import { AGENTCTL_SCRIPT, FIXTURES, removeDir, tempDir, waitFor } from './helpers';

const FAKE_AGENT = path.join(FIXTURES, 'fake-agent.cjs');

const git = (cwd: string, ...args: string[]) =>
  execFileSync('git', args, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();

const PROMPT = 'Revise {diff} e escreva em {revisao} (pasta {pasta})';

describe('ReviewerService', () => {
  let repo: string;
  let state: string;
  let ptys: PtyManager;
  let hooks: HookServer;
  let manager: SessionManager;
  let handoff: HandoffService;
  let service: ReviewerService;
  let written: [string, string][];
  let turnChecks = false;
  let checkpointId = 1;
  let hasPair = true;
  let targetId: string;

  const build = (options: { timeoutMs?: number } = {}) => {
    service = new ReviewerService({
      manager,
      handoff,
      file: path.join(state, 'reviewers.json'),
      checkpoints: {
        idle: async () => {},
        latestPair: async () =>
          hasPair
            ? {
                root: repo,
                from: { tree: git(repo, 'rev-parse', 'HEAD~1^{tree}') },
                to: { id: String(checkpointId), tree: git(repo, 'rev-parse', 'HEAD^{tree}') },
              }
            : null,
      } as never,
      prompt: () => PROMPT,
      expand: async (id, text) => text.replace('{pasta}', manager.get(id)!.cwd),
      hasTurnChecks: () => turnChecks,
      reviewerName: (target) => `Revisor de ${target.name}`,
      settleMs: 50,
      pollMs: 25,
      ...options,
    });
  };
  const typedTo = (id: string) =>
    written
      .filter(([to]) => to === id)
      .map(([, data]) => data)
      .join('');
  const reviewerOf = () => manager.list().find((s) => s.id === targetId)!.reviewer;

  beforeEach(async () => {
    repo = tempDir('ac rev repo ação-');
    state = tempDir('ac rev estado-');
    git(repo, 'init', '-q', '-b', 'main');
    git(repo, 'config', 'user.email', 'teste@example.com');
    git(repo, 'config', 'user.name', 'Teste');
    git(repo, 'config', 'commit.gpgsign', 'false');
    git(repo, 'config', 'core.autocrlf', 'false');
    fs.writeFileSync(path.join(repo, 'app.ts'), 'export const a = 1;\n');
    git(repo, 'add', '-A');
    git(repo, 'commit', '-q', '-m', 'base');
    fs.writeFileSync(path.join(repo, 'app.ts'), 'export const a = 2;\nexport const b = 3;\n');
    git(repo, 'commit', '-qam', 'o turno');
    turnChecks = false;
    checkpointId = 1;
    hasPair = true;

    ptys = new PtyManager();
    written = [];
    const write = ptys.write.bind(ptys);
    vi.spyOn(ptys, 'write').mockImplementation((id, data) => {
      written.push([id, data]);
      write(id, data);
    });
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
    handoff = new HandoffService({ root: path.join(state, 'handoffs'), pollMs: 25, stableMs: 100 });
    targetId = manager.create({ name: 'Principal', cwd: repo, profile: 'claude-code' }).id;
    build();
  });
  afterEach(async () => {
    service.dispose();
    await manager.dispose(0);
    await ptys.killAll({ graceMs: 0 });
    await hooks.close();
    vi.restoreAllMocks();
    for (const dir of [repo, state]) removeDir(dir);
  });

  const link = (trigger: 'turn' | 'manual' = 'turn') =>
    service.set({ sessionId: targetId, trigger, reviewer: { kind: 'new', profile: 'codex' } });
  const reviewerId = () => service.list()[0]!.reviewer;
  const answer = (text: string) => {
    fs.mkdirSync(path.join(state, 'handoffs', targetId), { recursive: true });
    fs.writeFileSync(path.join(state, 'handoffs', targetId, 'revisao.md'), text);
  };

  it('makes a read-only session in the same group, marked as the reviewer', async () => {
    const summary = await link();
    expect(summary).toMatchObject({ trigger: 'turn', state: 'idle' });
    const views = manager.list();
    const reviewer = views.find((s) => s.id === reviewerId())!;
    expect(reviewer).toMatchObject({
      name: 'Revisor de Principal',
      cwd: repo,
      profile: 'codex',
      readOnly: true,
      reviewing: targetId,
    });
    expect(reviewer.running).toBe(false);
    // The two share a group created for the pair, and the session in sight stays the same.
    const target = views.find((s) => s.id === targetId)!;
    expect(reviewer.groupId).toBeDefined();
    expect(reviewer.groupId).toBe(target.groupId);
    expect(manager.selected).toBe(targetId);

    // Kept on disk, read back by the next service.
    service.dispose();
    build();
    expect(service.list()).toEqual([{ target: targetId, reviewer: reviewerId(), trigger: 'turn' }]);
    expect(reviewerOf()).toMatchObject({ reviewerId: reviewerId() });
  });

  it('puts the read-only mode of each agent in the command line, and only for a reviewer', () => {
    const context = {
      agentctl: { command: 'agentctl', notify: ['agentctl'] },
      dataDirectory: state,
      socketPath: 'x',
    } as never;
    const claude = buildLaunchCommand(
      PROFILES['claude-code'],
      { id: 'a', readOnly: true },
      context,
    );
    expect(claude.args).toEqual(expect.arrayContaining(['--permission-mode', 'plan']));
    const codex = buildLaunchCommand(PROFILES.codex, { id: 'a', readOnly: true }, context);
    expect(codex.args).toEqual(expect.arrayContaining(['--sandbox', 'read-only']));
    expect(buildLaunchCommand(PROFILES.codex, { id: 'a' }, context).args).not.toContain(
      '--sandbox',
    );
  });

  it('at the end of a turn, sends the reviewer the diff in a file, and shows the answer', async () => {
    await link();
    service.turnEnded(targetId);
    const diffFile = path.join(state, 'handoffs', targetId, 'diff.patch');
    await waitFor(() => typedTo(reviewerId()).includes(diffFile), {
      timeout: 20000,
      message: 'o pedido chegar ao revisor',
    });
    // The diff is in the file, not in the terminal.
    expect(typedTo(reviewerId())).not.toContain('export const b = 3');
    expect(fs.readFileSync(diffFile, 'utf8')).toContain('+export const b = 3;');
    expect(typedTo(reviewerId())).toContain(path.join(state, 'handoffs', targetId, 'revisao.md'));
    expect(typedTo(reviewerId())).toContain(repo);
    expect(manager.get(reviewerId())).toBeDefined();
    expect(reviewerOf()?.state).toBe('waiting');

    // Written in two pieces: the answer is taken when it stops changing.
    answer('- app.ts:1 — primeira\n');
    await new Promise((resolve) => setTimeout(resolve, 40));
    fs.appendFileSync(
      path.join(state, 'handoffs', targetId, 'revisao.md'),
      '- app.ts:2 — segunda\n',
    );
    await waitFor(() => reviewerOf()?.state === 'ready', { message: 'a revisão ficar pronta' });
    expect(reviewerOf()?.count).toBe(2);
    const result = await service.result(targetId);
    expect(result.items).toEqual([
      { file: 'app.ts', line: 1, text: 'primeira' },
      { file: 'app.ts', line: 2, text: 'segunda' },
    ]);
  }, 30000);

  it('does not ask again for a turn that left no new checkpoint', async () => {
    await link();
    service.turnEnded(targetId);
    await waitFor(() => reviewerOf()?.state === 'waiting', { timeout: 20000 });
    // The Enter of the request follows the text a moment later.
    await new Promise((resolve) => setTimeout(resolve, 500));
    const before = typedTo(reviewerId()).length;
    service.turnEnded(targetId);
    await new Promise((resolve) => setTimeout(resolve, 300));
    expect(typedTo(reviewerId()).length).toBe(before);
    expect(reviewerOf()?.state).toBe('waiting');
  }, 30000);

  it('waits for the checks of the turn and asks nothing when they failed', async () => {
    turnChecks = true;
    await link();
    service.turnEnded(targetId);
    service.checksFinished(targetId, 'failed');
    await new Promise((resolve) => setTimeout(resolve, 200));
    expect(reviewerOf()?.state).toBe('idle');
    expect(manager.isRunning(reviewerId())).toBe(false);

    service.turnEnded(targetId);
    await new Promise((resolve) => setTimeout(resolve, 100));
    expect(reviewerOf()?.state).toBe('idle');
    service.checksFinished(targetId, 'passed');
    await waitFor(() => reviewerOf()?.state === 'waiting', {
      timeout: 20000,
      message: 'o pedido sair depois das verificações',
    });
  }, 30000);

  it('a new turn makes the review that waited for the checks stale', async () => {
    turnChecks = true;
    await link();
    service.turnEnded(targetId);
    service.turnStarted(targetId);
    service.checksFinished(targetId, 'passed');
    await new Promise((resolve) => setTimeout(resolve, 200));
    expect(reviewerOf()?.state).toBe('idle');
  });

  it('with the trigger on demand, only "review now" asks', async () => {
    await link('manual');
    service.turnEnded(targetId);
    await new Promise((resolve) => setTimeout(resolve, 200));
    expect(reviewerOf()?.state).toBe('idle');
    await service.runNow(targetId);
    await waitFor(() => reviewerOf()?.state === 'waiting', { timeout: 20000 });
  }, 30000);

  it('says so when there is no turn with changes to review', async () => {
    await link('manual');
    hasPair = false;
    await expect(service.runNow(targetId)).rejects.toThrow(/turno com mudanças/);
    expect(reviewerOf()?.state).toBe('idle');
  });

  it('gives up when the file does not come, and says so', async () => {
    service.dispose();
    build({ timeoutMs: 400 });
    await link();
    service.turnEnded(targetId);
    await waitFor(() => reviewerOf()?.state === 'timedOut', {
      timeout: 20000,
      message: 'o prazo acabar',
    });
  }, 30000);

  it('forgets the pair when the reviewer is closed in the middle of a review', async () => {
    await link();
    const reviewer = reviewerId();
    service.turnEnded(targetId);
    await waitFor(() => reviewerOf()?.state === 'waiting', { timeout: 20000 });
    await manager.remove(reviewer);
    await waitFor(() => reviewerOf() === undefined, { message: 'o par ser desfeito' });
    expect(service.list()).toEqual([]);
    // No answer is waited for any more, and nothing is left on the disk.
    await waitFor(() => !fs.existsSync(path.join(state, 'handoffs', targetId)));
    expect(manager.list().find((s) => s.id === targetId)).toBeDefined();
    await expect(service.result(targetId)).rejects.toThrow(/não tem revisor/);
  }, 30000);

  it('forgets the pair when the reviewed session is closed', async () => {
    await link();
    const reviewer = reviewerId();
    await manager.remove(targetId);
    await waitFor(() => service.list().length === 0);
    expect(manager.list().find((s) => s.id === reviewer)?.reviewing).toBeUndefined();
  });

  it('takes the reviewer away without closing its session', async () => {
    await link();
    const reviewer = reviewerId();
    expect(await service.set({ sessionId: targetId, trigger: 'turn', reviewer: null })).toBeNull();
    expect(reviewerOf()).toBeUndefined();
    expect(manager.get(reviewer)).toBeDefined();
    expect(manager.list().find((s) => s.id === reviewer)?.reviewing).toBeUndefined();
  });

  it('refuses a session that reviews itself or is already in a pair', async () => {
    await link();
    const other = manager.create({ name: 'Outra', cwd: repo, profile: 'claude-code' }).id;
    await expect(
      service.set({
        sessionId: other,
        trigger: 'turn',
        reviewer: { kind: 'existing', sessionId: other },
      }),
    ).rejects.toThrow(/si mesma/);
    await expect(
      service.set({
        sessionId: other,
        trigger: 'turn',
        reviewer: { kind: 'existing', sessionId: reviewerId() },
      }),
    ).rejects.toThrow(/par de revisão/);
    // Only the trigger changes when the same reviewer is chosen again.
    const same = await service.set({
      sessionId: targetId,
      trigger: 'manual',
      reviewer: { kind: 'existing', sessionId: reviewerId() },
    });
    expect(same).toMatchObject({ trigger: 'manual', reviewerId: reviewerId() });
  });

  it('refuses a folder that is not a repository', async () => {
    const plain = tempDir('ac rev sem git-');
    try {
      const id = manager.create({ name: 'Sem git', cwd: plain, profile: 'claude-code' }).id;
      await expect(
        service.set({
          sessionId: id,
          trigger: 'turn',
          reviewer: { kind: 'new', profile: 'codex' },
        }),
      ).rejects.toThrow(/repositório git/);
    } finally {
      removeDir(plain);
    }
  });

  it('shows an answer that was on the disk when the app opened', async () => {
    await link();
    answer('- app.ts:1 — de antes\n');
    service.dispose();
    build();
    await service.restored;
    expect(reviewerOf()).toMatchObject({ state: 'ready', count: 1 });
  });
});

describe('turnDiff', () => {
  let repo: string;
  beforeEach(() => {
    repo = tempDir('ac diff ação-');
    git(repo, 'init', '-q', '-b', 'main');
    git(repo, 'config', 'user.email', 'teste@example.com');
    git(repo, 'config', 'user.name', 'Teste');
    git(repo, 'config', 'commit.gpgsign', 'false');
    fs.writeFileSync(path.join(repo, 'a.ts'), 'um\n');
    git(repo, 'add', '-A');
    git(repo, 'commit', '-q', '-m', 'um');
    fs.writeFileSync(path.join(repo, 'a.ts'), `dois\n${'linha longa\n'.repeat(200)}`);
    fs.writeFileSync(path.join(repo, 'b.ts'), 'novo\n');
    git(repo, 'add', '-A');
    git(repo, 'commit', '-q', '-m', 'dois');
  });
  afterEach(() => removeDir(repo));

  const trees = () =>
    [git(repo, 'rev-parse', 'HEAD~1^{tree}'), git(repo, 'rev-parse', 'HEAD^{tree}')] as const;

  it('is the patch of the turn', async () => {
    const [from, to] = trees();
    const diff = await turnDiff(repo, from, to);
    expect(diff.cut).toBe(false);
    expect(diff.text).toContain('+dois');
    expect(diff.text).toContain('+++ b/b.ts');
  });

  it('lists the files and says how to read them when the patch is too big', async () => {
    const [from, to] = trees();
    const diff = await turnDiff(repo, from, to, 500);
    expect(diff.cut).toBe(true);
    expect(diff.text).toMatch(/M\ta\.ts/);
    expect(diff.text).toMatch(/A\tb\.ts/);
    expect(diff.text).toContain(`git diff ${from} ${to}`);
    expect(diff.text).not.toContain('linha longa');
  });
});
