import { currentBranch, runGit } from '@core/git/GitService';
import type { SessionManager } from '@core/sessions/SessionManager';
import { normalizeRepo, type PullRequestView } from '@shared/pulls';

/**
 * The sessions with the branch of a pull request checked out; among them, the ones in a clone of
 * its repository first (the remote may be written with https or ssh).
 */
export async function sessionsForPull(
  manager: SessionManager,
  pull: PullRequestView,
): Promise<string[]> {
  const looks = await Promise.all(
    manager.list().map(async (s) => {
      const branch = await currentBranch(s.cwd).catch(() => null);
      if (branch !== pull.branch) return null;
      const remotes = await runGit(s.cwd, ['remote', '-v']).catch(() => null);
      // Each address read the way the watched list is (`git@host:group/project.git` too).
      const names = (remotes?.stdout.toString('utf8') ?? '')
        .split(/\s+/)
        .map((word) => normalizeRepo(word)?.toLowerCase());
      return { id: s.id, same: names.includes(pull.repo.toLowerCase()) };
    }),
  );
  const found = looks.filter((l) => l !== null);
  const same = found.filter((l) => l.same);
  return (same.length > 0 ? same : found).map((l) => l.id);
}
