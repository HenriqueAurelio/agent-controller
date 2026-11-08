// The channels of the board of tasks, and of the issues a task can come from.
import { runGit } from '@core/git/GitService';
import { errorText } from '@shared/i18n';
import { normalizeRepo, type IssueList } from '@shared/pulls';
import { TASK_DESCRIPTION_LIMIT, TASK_TITLE_LIMIT } from '@shared/tasks';
import type { IpcKit } from './kit';
import { ids, str, taskInput } from './args';

export function registerTasksIpc(kit: IpcKit): void {
  const { context, handle, tasks, language, remember } = kit;
  handle('tasks:list', (folder) => tasks.list(str(folder, 'folder')));
  handle('tasks:issues', async (folder): Promise<IssueList> => {
    const cwd = str(folder, 'folder');
    const remotes = await runGit(cwd, ['remote', '-v']).catch(() => null);
    // The first remote whose address names a repository of GitHub or GitLab.
    const repo =
      (remotes?.stdout.toString('utf8') ?? '')
        .split(/\s+/)
        .map((word) => normalizeRepo(word))
        .find((name): name is string => !!name) ?? null;
    if (!repo) return { repo: null, issues: [] };
    try {
      return { repo, issues: await context.pulls.issues(repo) };
    } catch (err) {
      return { repo, issues: [], error: errorText(language(), err) };
    }
  });
  handle('tasks:create', async (input) => {
    const clean = taskInput(input);
    const state = await tasks.create(clean);
    remember(clean.cwd);
    return state;
  });
  handle('tasks:update', (id, patch) => {
    const p = (patch && typeof patch === 'object' ? patch : {}) as Record<string, unknown>;
    return tasks.update(str(id, 'task', 64), {
      ...(p.title !== undefined && { title: str(p.title, 'name', TASK_TITLE_LIMIT * 4) }),
      ...(p.description !== undefined && {
        description: str(p.description, 'text', TASK_DESCRIPTION_LIMIT),
      }),
    });
  });
  handle('tasks:remove', (id) => tasks.remove(str(id, 'task', 64)));
  handle('tasks:reorder', (repo, taskIds) => tasks.reorder(str(repo, 'folder'), ids(taskIds)));
  handle('tasks:start', (taskIds) => tasks.start(ids(taskIds)));
  handle('tasks:done', (id, done) => tasks.done(str(id, 'task', 64), done === true));
}
