// The channels of the copies of repositories (`git worktree`) and of the experiments in them.
import fs from 'node:fs';
import path from 'node:path';
import { currentBranch } from '@core/git/GitService';
import {
  defaultWorktreesFolder,
  folderSize,
  localBranches,
  removeWorktree,
  worktreeOwner,
  worktreeStatus,
} from '@core/git/WorktreeService';
import { folderKey } from '@core/store/recentFolders';
import { sanitizeWorktreeSettings } from '@core/store/appStore';
import { UserError } from '@shared/i18n';
import type { WorktreeCopy, WorktreesInfo } from '@shared/ipc';
import type { AppData } from '@core/store/appStore';
import type { IpcKit } from './kit';
import { command, experimentInput, str } from './args';

/** Where the copies of the sessions go: the folder the user chose, or the default one. */
export const worktreesFolder = (data: AppData) => data.worktrees.folder || defaultWorktreesFolder();

export function registerWorktreesIpc(kit: IpcKit): void {
  const { context, handle, session, manager, experiments, isFolder, remember } = kit;
  const worktreesInfo = async (): Promise<WorktreesInfo> => {
    const parent = worktreesFolder(context.data);
    const sessions = manager.list();
    const found = new Map<string, string>();
    const add = (folder: string) => found.set(folderKey(folder), folder);
    for (const s of sessions) if (s.worktree) add(s.cwd);
    // What is in the folder of the copies: one folder per repository, one per copy in it.
    const children = async (dir: string) =>
      (await fs.promises.readdir(dir, { withFileTypes: true }).catch(() => []))
        .filter((entry) => entry.isDirectory())
        .map((entry) => path.join(dir, entry.name));
    for (const repoDir of await children(parent))
      for (const copy of await children(repoDir)) add(copy);
    const copies = await Promise.all(
      [...found.values()].map(async (folder): Promise<WorktreeCopy | null> => {
        const repoRoot = await worktreeOwner(folder);
        if (!repoRoot) return null;
        const [branch, size, stat] = await Promise.all([
          currentBranch(folder).catch(() => null),
          folderSize(folder),
          fs.promises.stat(folder),
        ]);
        return {
          folder,
          repoRoot,
          branch,
          size: size.bytes,
          sizeComplete: size.complete,
          modifiedAt: stat.mtimeMs,
          sessions: sessions
            .filter((s) => folderKey(s.cwd) === folderKey(folder))
            .map((s) => s.name),
        };
      }),
    );
    return {
      folder: parent,
      defaultFolder: defaultWorktreesFolder(),
      configuredFolder: context.data.worktrees.folder,
      setup: context.data.worktrees.setup,
      copy: context.data.worktrees.copy,
      copies: copies
        .filter((c): c is WorktreeCopy => c !== null)
        .sort((a, b) => b.modifiedAt - a.modifiedAt),
    };
  };
  handle('worktrees:inspect', async (folder) => {
    const target = str(folder, 'folder');
    if (!(await isFolder(target))) return { repo: false, current: null, branches: [] };
    const branches = await localBranches(target).catch(() => null);
    return branches
      ? { repo: true, current: branches.current, branches: branches.all }
      : { repo: false, current: null, branches: [] };
  });
  handle('worktrees:status', (id) => {
    const s = session(id);
    if (!s.worktree) throw new UserError('error.worktree.notWorktree', { folder: s.cwd });
    return worktreeStatus(s.cwd);
  });
  handle('worktrees:list', () => worktreesInfo());
  handle('worktrees:configure', (settings) => {
    const folder = str(settings?.folder, 'folder');
    const setup = command(str(settings?.setup, 'command'));
    if (folder.trim() && !path.isAbsolute(folder.trim())) {
      throw new UserError('error.worktree.folderNotAbsolute', { folder });
    }
    // Absent (an older caller): the list there was stays.
    const copy =
      settings?.copy === undefined ? context.data.worktrees.copy : str(settings.copy, 'text', 4000);
    context.data.worktrees = sanitizeWorktreeSettings({ folder, setup, copy });
    manager.flushPersist();
    return worktreesInfo();
  });
  handle('worktrees:remove', async (folder) => {
    const target = str(folder, 'folder');
    // Only a copy of the list: never any folder the renderer names.
    const copy = (await worktreesInfo()).copies.find(
      (c) => folderKey(c.folder) === folderKey(target),
    );
    if (!copy) throw new UserError('error.worktree.notWorktree', { folder: target });
    if (copy.sessions.length > 0)
      throw new UserError('error.worktree.inUse', { name: copy.sessions[0]! });
    await removeWorktree(copy.folder);
    return worktreesInfo();
  });
  handle('experiments:create', async (input) => {
    const clean = experimentInput(input);
    const created = await experiments.create(clean);
    remember(clean.cwd);
    return created;
  });
  handle('experiments:compare', (id) => experiments.compare(str(id, 'session', 64)));
  handle('experiments:diff', (id, file) =>
    experiments.diff(str(id, 'session', 64), str(file, 'file')),
  );
  handle('experiments:keep', (id, sessionId) =>
    experiments.keep(str(id, 'session', 64), session(sessionId).id),
  );
}
