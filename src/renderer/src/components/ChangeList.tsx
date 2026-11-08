import type { Ref } from 'react';
import { CHANGE_LETTER, type FileChange, type RepoInfo } from '@shared/git';
import type { OverlapFile } from '@shared/overlaps';
import { fileName, type Group } from '../lib/changeGroups';
import { useT } from '../lib/i18n';
import { sessionNames } from '../lib/overlaps';
import { useAppState } from '../lib/store';

interface Props {
  listRef: Ref<HTMLUListElement>;
  groups: Group[];
  /** The files in the order the list shows them. */
  flat: FileChange[];
  changes: FileChange[];
  stagedCount: number;
  /** Repositories of the session with nothing changed, when it has more than one. */
  untouched: RepoInfo[];
  selected: string | null;
  /** Whether the list is also what can be staged, committed and discarded. */
  operable: boolean;
  operating: boolean;
  /** Boxes clicked whose change git has not confirmed yet. */
  marking: Record<string, boolean>;
  overlapOf: Map<string, OverlapFile>;
  onSelect(path: string): void;
  onMove(delta: number): void;
  onFocusCommit(): void;
  onFocusEditor(): void;
  onToggleStaged(change: FileChange): void;
  onDiscard(change: FileChange): void;
  onOpenInSession(sessionId: string, file: string): void;
}

/** The ⚠ of a file another session also changed: it opens the file over there. */
function OverlapMark({
  overlap,
  onOpenInSession,
}: {
  overlap: OverlapFile;
  onOpenInSession(sessionId: string, file: string): void;
}) {
  const t = useT();
  const sessions = useAppState((s) => s.sessions);
  const names = sessionNames(
    t,
    overlap.others.map((o) => o.sessionId),
    sessions,
  );
  const target = overlap.others.find((o) => o.likely) ?? overlap.others[0]!;
  const targetName = sessions.find((s) => s.id === target.sessionId)?.name ?? '';
  return (
    <button
      type="button"
      className={`overlap-mark ${overlap.likely ? 'likely' : ''}`}
      data-testid="overlap-mark"
      data-likely={overlap.likely}
      title={t(overlap.likely ? 'overlap.fileLikely' : 'overlap.fileSame', { names })}
      aria-label={t('overlap.openIn', { file: overlap.path, name: targetName })}
      onClick={(e) => {
        e.stopPropagation();
        // Leaving this session asks about unsaved edits by itself.
        onOpenInSession(target.sessionId, target.path);
      }}
    >
      ⚠
    </button>
  );
}

/** The files changed, by folder (and by repository and section when there are more). */
export function ChangeList({
  listRef,
  groups,
  flat,
  changes,
  stagedCount,
  untouched,
  selected,
  operable,
  operating,
  marking,
  overlapOf,
  onSelect,
  onMove,
  onFocusCommit,
  onFocusEditor,
  onToggleStaged,
  onDiscard,
  onOpenInSession,
}: Props) {
  const t = useT();
  return (
    <ul
      ref={listRef}
      className="changes-list"
      role="listbox"
      tabIndex={0}
      aria-label={t('changes.modifiedFiles')}
      aria-activedescendant={
        selected ? `change-${flat.findIndex((c) => c.path === selected)}` : undefined
      }
      onKeyDown={(e) => {
        if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
          e.preventDefault();
          onMove(e.key === 'ArrowDown' ? 1 : -1);
        } else if (e.key === 'Home' || e.key === 'End') {
          e.preventDefault();
          onMove(e.key === 'Home' ? -flat.length : flat.length);
        } else if (e.key === 'Enter' && e.ctrlKey) {
          // Straight to the message of the commit, when something is marked for it.
          e.preventDefault();
          onFocusCommit();
        } else if (e.key === 'Enter') {
          e.preventDefault();
          onFocusEditor();
        } else if (operable && !operating && (e.key === ' ' || e.key === 'Delete')) {
          const change = changes.find((c) => c.path === selected);
          if (!change) return;
          e.preventDefault();
          if (e.key === ' ') onToggleStaged(change);
          else if (change.kind !== 'conflict') onDiscard(change);
        }
      }}
    >
      {groups.map((group) => (
        <li key={group.key} role="presentation">
          {group.section && (
            <div className={`changes-section section-${group.section}`}>
              {group.section === 'staged'
                ? t('changes.section.staged', { count: stagedCount })
                : t('changes.section.unstaged', {
                    count: changes.length - stagedCount,
                  })}
            </div>
          )}
          {group.repo && (
            <div
              className="changes-repo"
              data-repo={group.repo.path}
              title={t('changes.repo', { name: group.repo.name })}
            >
              <span className="changes-repo-name">{group.repo.name}</span>
              {group.repo.branch && <span className="muted">{group.repo.branch}</span>}
              <span className="spacer" />
              <span className="count">{group.repo.count}</span>
            </div>
          )}
          <div className="changes-folder">{group.folder || t('changes.root')}</div>
          <ul role="presentation">
            {group.files.map((change) => {
              const overlap = overlapOf.get(change.path);
              return (
                <li
                  key={change.path}
                  id={`change-${flat.indexOf(change)}`}
                  role="option"
                  aria-selected={change.path === selected}
                  data-path={change.path}
                  data-kind={change.kind}
                  className={`change-item ${change.path === selected ? 'selected' : ''}`}
                  title={
                    change.origPath
                      ? `${t(`change.${change.kind}`)}: ${change.origPath} → ${change.path}`
                      : `${t(`change.${change.kind}`)}: ${change.path}`
                  }
                  data-staged={change.staged ?? 'none'}
                  onClick={() => onSelect(change.path)}
                >
                  {operable && (
                    <input
                      type="checkbox"
                      className="stage-box"
                      aria-label={t('changes.stageOf', { file: change.path })}
                      title={t(
                        change.staged === 'partial' ? 'changes.stagePartial' : 'changes.stageHint',
                      )}
                      checked={marking[change.path] ?? change.staged === 'all'}
                      ref={(box) => {
                        if (box) {
                          box.indeterminate =
                            marking[change.path] === undefined && change.staged === 'partial';
                        }
                      }}
                      disabled={operating}
                      onClick={(e) => e.stopPropagation()}
                      onChange={() => onToggleStaged(change)}
                    />
                  )}
                  <span className="change-name">{fileName(change.path)}</span>
                  {overlap && <OverlapMark overlap={overlap} onOpenInSession={onOpenInSession} />}
                  {operable && change.kind !== 'conflict' && (
                    <button
                      type="button"
                      className="discard-button"
                      aria-label={t('changes.discardOf', { file: change.path })}
                      title={t('changes.discardHint')}
                      disabled={operating}
                      onClick={(e) => {
                        e.stopPropagation();
                        onDiscard(change);
                      }}
                    >
                      ↺
                    </button>
                  )}
                  <span className={`change-kind kind-${change.kind}`}>
                    {CHANGE_LETTER[change.kind]}
                  </span>
                </li>
              );
            })}
          </ul>
        </li>
      ))}
      {untouched.length > 0 && (
        <li role="presentation" className="changes-untouched">
          {t('changes.untouched', { names: untouched.map((r) => r.name).join(', ') })}
        </li>
      )}
    </ul>
  );
}
