// The way of a copy's branch out of the app (ADR 0029): pushed to the remote, to become a pull
// request, and brought up to date with its base. Nothing here forces, rewrites or touches the base.
import type { BaseUpdate } from '@shared/branchUpdate';
import { UserError } from '@shared/i18n';
import { runTool } from '../tools/ToolRunner';
import { runGit } from './GitService';

const PUSH_TIMEOUT_MS = 2 * 60_000;
const MERGE_TIMEOUT_MS = 2 * 60_000;

const NO_PROMPT = { ...process.env, GIT_TERMINAL_PROMPT: '0', GCM_INTERACTIVE: 'never' };

export interface BranchState {
  branch: string;
  base: string;
  /** The remote the branch goes to; null when the repository has none. */
  remote: string | null;
  /** The address of that remote, for the service and the repository it names. */
  remoteUrl: string | null;
  /** Commits of the branch that the base does not have. */
  ahead: number;
  /** The subjects of those commits, the oldest first. */
  subjects: string[];
  /** Files changed and not committed: what a push would leave behind. */
  dirty: number;
}

/** The branch checked out in the copy, and how it stands against its base. */
export async function branchState(cwd: string, base: string): Promise<BranchState> {
  const head = await runGit(cwd, ['symbolic-ref', '--quiet', '--short', 'HEAD']);
  const branch = head.code === 0 ? head.stdout.toString('utf8').trim() : '';
  if (!branch) throw new UserError('error.branch.detached');
  const remotes = (await runGit(cwd, ['remote'])).stdout
    .toString('utf8')
    .split(/\s+/)
    .filter(Boolean);
  // The branch's own remote when it has one; origin otherwise; else the only one.
  const tracked = await runGit(cwd, ['config', `branch.${branch}.remote`]);
  const configured = tracked.code === 0 ? tracked.stdout.toString('utf8').trim() : '';
  const remote =
    (configured && remotes.includes(configured) ? configured : null) ??
    (remotes.includes('origin') ? 'origin' : (remotes[0] ?? null));
  const url = remote ? await runGit(cwd, ['remote', 'get-url', remote]) : null;
  const log = await runGit(cwd, ['log', '--reverse', '--format=%s', `${base}..HEAD`]);
  const subjects = log.code === 0 ? log.stdout.toString('utf8').split('\n').filter(Boolean) : [];
  const status = await runGit(cwd, ['status', '--porcelain']);
  return {
    branch,
    base,
    remote,
    remoteUrl: url?.code === 0 ? url.stdout.toString('utf8').trim() : null,
    ahead: subjects.length,
    subjects,
    dirty: status.stdout.toString('utf8').split('\n').filter(Boolean).length,
  };
}

/** Pushes the branch to its remote, setting it as upstream. Never with force. */
export async function pushBranch(cwd: string, remote: string, branch: string): Promise<void> {
  if (!remote || remote.startsWith('-') || !branch || branch.startsWith('-')) {
    throw new UserError('error.branch.noRemote');
  }
  const result = await runTool({
    file: 'git',
    args: ['push', '--set-upstream', remote, `HEAD:refs/heads/${branch}`],
    cwd,
    env: NO_PROMPT,
    timeoutMs: PUSH_TIMEOUT_MS,
  });
  if (result.timedOut) throw new UserError('error.branch.pushTimeout');
  if (result.exitCode !== 0) {
    throw new UserError('error.branch.pushFailed', {
      output: (result.error ?? result.output).trim().slice(-2000),
    });
  }
}

/**
 * Brings the base into the copy with a merge (no rebase: the branch may be pushed already). The
 * base is read from the remote when it has it, which is what the pull request is compared with.
 * A conflict is left in the copy, for the agent to resolve.
 */
export async function updateFromBase(
  cwd: string,
  base: string,
  remote: string | null,
): Promise<BaseUpdate> {
  const dirty = (await runGit(cwd, ['status', '--porcelain', '--untracked-files=no'])).stdout
    .toString('utf8')
    .trim();
  if (dirty) throw new UserError('error.branch.dirty');
  let from = base;
  if (remote && !base.startsWith('-')) {
    const fetched = await runTool({
      file: 'git',
      args: ['fetch', '--quiet', remote, base],
      cwd,
      env: NO_PROMPT,
      timeoutMs: PUSH_TIMEOUT_MS,
    });
    if (fetched.exitCode === 0) from = 'FETCH_HEAD';
  }
  const behind = await runGit(cwd, ['rev-list', '--count', `HEAD..${from}`]);
  if (behind.code === 0 && behind.stdout.toString('utf8').trim() === '0') {
    return {
      status: 'current',
      from: from === 'FETCH_HEAD' ? `${remote}/${base}` : base,
      conflicts: [],
    };
  }
  const merge = await runTool({
    file: 'git',
    args: ['merge', '--no-edit', '--no-ff', from],
    cwd,
    env: { ...NO_PROMPT, GIT_MERGE_AUTOEDIT: 'no' },
    timeoutMs: MERGE_TIMEOUT_MS,
  });
  const label = from === 'FETCH_HEAD' ? `${remote}/${base}` : base;
  if (merge.exitCode === 0) return { status: 'merged', from: label, conflicts: [] };
  const unmerged = await runGit(cwd, ['diff', '--name-only', '--diff-filter=U']);
  const conflicts = unmerged.stdout.toString('utf8').split('\n').filter(Boolean);
  if (conflicts.length === 0) {
    throw new UserError('error.branch.mergeFailed', {
      output: (merge.error ?? merge.output).trim().slice(-2000),
    });
  }
  return { status: 'conflict', from: label, conflicts };
}
