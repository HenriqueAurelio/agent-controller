// The channels of git in the panel of changes, of the files of a session and of its checkpoints.
import type { CheckpointTrees } from '@core/git/ChangesService';
import { locateFiles, MAX_CANDIDATES } from '@core/git/FileLocator';
import { blameLine, commitDiff, fileLog } from '@core/git/history';
import { UserError } from '@shared/i18n';
import { parseCheckpointBase, type CheckpointUsage } from '@shared/checkpoints';
import type { DiffBase } from '@shared/git';
import { runGit } from '@core/git/GitService';
import { searchProject } from '@core/search/searchProject';
import type { IpcKit } from './kit';
import { str, hunkRevert, base, searchQuery } from './args';

export function registerGitIpc(kit: IpcKit): void {
  const { context, handle, session, manager, changes, checkpoints, overlaps } = kit;
  /** The base a session in a copy compares with: the one its branch started from. */
  const branchBase = (sessionId: string) => manager.get(sessionId)?.worktree?.base;
  /**
   * The trees a checkpoint base compares. The ids come from the renderer: only the checkpoints of
   * that session are taken, from its own repository.
   */
  const checkpointTrees = async (
    sessionId: string,
    diffBase: DiffBase,
  ): Promise<CheckpointTrees | undefined> => {
    if (diffBase === 'previousTurn') {
      const previous = await checkpoints.previous(sessionId);
      return previous ? { from: previous.checkpoint.tree } : undefined;
    }
    const parsed = parseCheckpointBase(diffBase);
    if (!parsed) return undefined;
    const from = (await checkpoints.get(sessionId, parsed.from)).checkpoint.tree;
    const to = parsed.to
      ? (await checkpoints.get(sessionId, parsed.to)).checkpoint.tree
      : undefined;
    return { from, ...(to && { to }) };
  };
  const overview = async (id: unknown, diffBase: unknown, watch: boolean) => {
    const s = session(id);
    const b = base(diffBase);
    return changes.overview(s.id, s.cwd, b, {
      watch,
      branchBase: branchBase(s.id),
      checkpoint: await checkpointTrees(s.id, b),
    });
  };
  handle('git:open', (id, diffBase) => {
    // A panel that opens shows what is in common as of now, not as of the latest turn.
    void overlaps.touch(session(id).id);
    return overview(id, diffBase, true);
  });
  handle('git:refresh', (id, diffBase) => overview(id, diffBase, false));
  handle('git:overlaps', (id) => overlaps.detail(session(id).id));
  handle('git:close', (id) => changes.close(str(id, 'session', 64)));
  handle('git:diff', async (id, file, diffBase) => {
    const s = session(id);
    const b = base(diffBase);
    return changes.diff(s.id, str(file, 'file'), b, await checkpointTrees(s.id, b));
  });
  handle('git:hunks', async (id, diffBase) => {
    const s = session(id);
    const b = base(diffBase);
    return changes.hunks(s.id, b, await checkpointTrees(s.id, b));
  });
  handle('git:revertHunk', async (id, diffBase, revert) => {
    const s = session(id);
    const b = base(diffBase);
    await changes.revertHunk(s.id, b, hunkRevert(revert), await checkpointTrees(s.id, b));
  });
  handle('git:log', (id, file) => {
    const { root, inside } = changes.locate(session(id).id, str(file, 'file'));
    return fileLog(root, inside);
  });
  handle('git:commitDiff', (id, file, sha) => {
    const { root, inside } = changes.locate(session(id).id, str(file, 'file'));
    return commitDiff(root, inside, str(sha, 'text', 64));
  });
  handle('git:blameLine', async (id, file, at) => {
    const s = session(id);
    const path0 = str(file, 'file');
    const { root, inside } = changes.locate(s.id, path0);
    const lineNo = typeof at === 'number' && Number.isInteger(at) && at >= 1 ? at : 1;
    // The file as it is on disk, so an edit not committed yet reads as such.
    const diff = await changes.diff(s.id, path0, 'head');
    const contents = diff.modified.kind === 'text' ? diff.modified.text : '';
    return blameLine(root, inside, lineNo, contents);
  });
  handle('git:save', async (id, file, content, expected) => {
    const result = await changes.save(
      session(id).id,
      str(file, 'file'),
      str(content, 'content', 4 * 1024 * 1024),
      expected === null ? null : str(expected, 'expected', 4 * 1024 * 1024),
    );
    return { saved: result.saved };
  });
  const files = (value: unknown) => {
    if (!Array.isArray(value) || value.length === 0 || value.length > 1000) {
      throw new UserError('error.invalidArgument', { name: { key: 'arg.file' } });
    }
    return value.map((file) => str(file, 'file'));
  };
  handle('git:stage', (id, list) => changes.stage(session(id).id, files(list)));
  handle('git:unstage', (id, list) => changes.unstage(session(id).id, files(list)));
  handle('git:commit', async (id, repo, message) => {
    const result = await changes.commit(
      session(id).id,
      str(repo, 'path'),
      str(message, 'message', 64 * 1024),
    );
    return { commit: result.commit };
  });
  handle('git:discard', async (id, file) => {
    const record = await changes.discard(session(id).id, str(file, 'file'), context.discardDir);
    return { id: record.id };
  });
  handle('git:undoDiscard', (id, discardId) =>
    changes.undoDiscard(session(id).id, str(discardId, 'text', 64), context.discardDir),
  );
  handle('git:count', (id) => {
    const s = session(id);
    return changes.count(s.id, s.cwd);
  });
  handle('files:list', (id, dir, showHidden) => {
    const s = session(id);
    return changes.list(s.id, s.cwd, str(dir, 'folder'), showHidden === true);
  });
  handle('files:index', (id, showHidden) => {
    const s = session(id);
    return changes.index(s.id, s.cwd, showHidden === true);
  });
  handle('files:locate', (id, candidates) => {
    if (!Array.isArray(candidates) || candidates.length > MAX_CANDIDATES) {
      throw new UserError('error.invalidArgument', { name: { key: 'arg.file' } });
    }
    return locateFiles(
      session(id).cwd,
      candidates.map((candidate) => str(candidate, 'file', 1024)),
    );
  });
  const checkpointId = (value: unknown) => {
    const id = str(value, 'checkpoint', 16);
    if (!/^\d{1,9}$/.test(id)) {
      throw new UserError('error.invalidArgument', { name: { key: 'arg.checkpoint' } });
    }
    return id;
  };
  handle('checkpoints:list', (id) => checkpoints.list(session(id).id));
  handle('checkpoints:restore', (id, checkpoint) =>
    checkpoints.restore(session(id).id, checkpointId(checkpoint)),
  );
  handle('checkpoints:prune', (id) => checkpoints.prune(session(id).id));
  handle('checkpoints:usage', async () => {
    const usage = await Promise.all(
      manager.list().map(async (s): Promise<CheckpointUsage> => ({
        sessionId: s.id,
        name: s.name,
        folder: s.cwd,
        ...(await checkpoints.usage(s.id).catch(() => ({ count: 0, bytes: 0 }))),
      })),
    );
    return usage.filter((u) => u.count > 0);
  });
  handle('search:run', async (id, value) => {
    const s = session(id);
    const query = searchQuery(value);
    // The root the panel shows paths from, so a click opens the right file.
    const root = changes.rootFor(s.id) ?? s.cwd;
    const repo = await runGit(root, ['rev-parse', '--is-inside-work-tree']).catch(() => null);
    const inGit = repo?.code === 0 && repo.stdout.toString('utf8').trim() === 'true';
    let changed: string[] = [];
    if (inGit && query.changedOnly) {
      const listed = await runGit(root, ['status', '--porcelain', '-z', '--untracked-files=all']);
      changed = listed.stdout
        .toString('utf8')
        .split('\0')
        .filter((entry) => entry.length > 3)
        .map((entry) => entry.slice(3));
    }
    return searchProject(root, query, { inGit, changed });
  });
}
