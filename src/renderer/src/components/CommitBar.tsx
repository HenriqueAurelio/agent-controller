import type { Ref } from 'react';
import type { FileChange, RepoInfo } from '@shared/git';
import { fileName } from '../lib/changeGroups';
import { useT } from '../lib/i18n';

interface Props {
  commitRef: Ref<HTMLTextAreaElement>;
  /** The staged files of the repository the commit goes to. */
  goingIn: FileChange[];
  /** The repositories with something staged. */
  stagedRepos: string[];
  repoToCommit: string;
  repos: RepoInfo[];
  message: string;
  operating: boolean;
  onRepo(repo: string): void;
  onMessage(message: string): void;
  onCommit(): void;
}

/** The foot of the list of changes: what goes into the commit, and its message. */
export function CommitBar({
  commitRef,
  goingIn,
  stagedRepos,
  repoToCommit,
  repos,
  message,
  operating,
  onRepo,
  onMessage,
  onCommit,
}: Props) {
  const t = useT();
  return (
    <footer className="commit-bar" role="group" aria-label={t('changes.commitArea')}>
      <div className="commit-going-in" data-testid="commit-going-in">
        {t('changes.goingIn', {
          count: goingIn.length,
          files: goingIn.map((c) => fileName(c.path)).join(', '),
        })}
      </div>
      <div className="commit-row">
        {stagedRepos.length > 1 && (
          <select
            aria-label={t('changes.commitRepo')}
            value={repoToCommit}
            onChange={(e) => onRepo(e.target.value)}
          >
            {stagedRepos.map((repo) => (
              <option key={repo} value={repo}>
                {repos.find((r) => r.path === repo)?.name ?? repo}
              </option>
            ))}
          </select>
        )}
        <textarea
          ref={commitRef}
          aria-label={t('changes.commitMessage')}
          placeholder={t('changes.commitMessage')}
          value={message}
          rows={2}
          spellCheck={false}
          onChange={(e) => onMessage(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && e.ctrlKey && message.trim()) {
              e.preventDefault();
              onCommit();
            }
          }}
        />
        <button
          type="button"
          className="primary"
          disabled={operating || !message.trim()}
          title={t('changes.commitHint')}
          onClick={onCommit}
        >
          {t('changes.commit')}
        </button>
      </div>
    </footer>
  );
}
