// The copy of the repository a new session works in (`git worktree`), on a new branch: made,
// given what git leaves out (`.env`), and prepared by the command of the user, before the session
// exists. When any step fails, the error says why; the copy and its branch stay.
import { copyIntoWorktree } from '../git/copyIntoWorktree';
import { repositoryRoot } from '../git/GitService';
import { checkBranchName, createWorktree, suggestWorktreeFolder } from '../git/WorktreeService';
import { runInShell, type RunResult } from '../tools/ToolRunner';
import { UserError } from '@shared/i18n';

/** How a session in a copy of its repository is made. */
export interface WorktreeCreation {
  /** The folder the copies of every repository go into. */
  parent: string;
  /** Run once in the new copy, in the user's shell, before the session exists (`npm ci`). */
  setup?: string;
  /** Files of the repository copied into the new copy (`.env*`), as patterns. */
  copy?: string[];
}

export const SETUP_TIMEOUT_MS = 15 * 60 * 1000;
/** Lines of the output of a setup that failed that the error carries. */
const SETUP_ERROR_LINES = 15;

export const defaultSetup = (command: string, cwd: string): Promise<RunResult> =>
  // Tools print less color and no prompts when they know nobody is at the keyboard.
  runInShell(command, { cwd, env: { ...process.env, CI: '1' }, timeoutMs: SETUP_TIMEOUT_MS });

/** Where the copy is, and what the session keeps of it. */
export interface PreparedCopy {
  folder: string;
  repoRoot: string;
  branch: string;
  base: string;
}

/** Makes and prepares the copy of the repository of `cwd` on a new branch. */
export async function prepareWorktreeCopy(
  cwd: string,
  wanted: { branch: string; base: string },
  creation: WorktreeCreation,
  runSetup: (command: string, cwd: string) => Promise<RunResult> = defaultSetup,
): Promise<PreparedCopy> {
  const repoRoot = await repositoryRoot(cwd);
  if (!repoRoot) throw new UserError('error.worktree.notRepo', { folder: cwd });
  const branch = await checkBranchName(repoRoot, wanted.branch);
  const created = await createWorktree({
    repo: repoRoot,
    branch,
    base: wanted.base,
    folder: suggestWorktreeFolder(creation.parent, repoRoot, branch),
  });
  // What git leaves out (`.env`), before the setup that may need it.
  if (creation.copy?.length) {
    await copyIntoWorktree(repoRoot, created.folder, creation.copy).catch(() => []);
  }
  const setup = creation.setup?.trim();
  if (setup) {
    const result = await runSetup(setup, created.folder);
    if (result.exitCode !== 0 || result.timedOut || result.error !== undefined) {
      const output = (result.error ?? result.output).trimEnd().split('\n');
      // The copy and its branch stay: nothing is deleted without being asked.
      throw new UserError('error.worktree.setupFailed', {
        command: setup,
        folder: created.folder,
        output: output.slice(-SETUP_ERROR_LINES).join('\n'),
      });
    }
  }
  return created;
}
