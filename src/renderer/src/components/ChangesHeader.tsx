import type { CheckpointList } from '@shared/checkpoints';
import type { DiffBase, GitOverview } from '@shared/git';
import { useT } from '../lib/i18n';
import type { PanelMode } from './ChangesPanel';

interface Props {
  mode: PanelMode;
  /** The problems found, and whether there are more than listed. */
  problems: { count: number; more: boolean };
  commentCount: number;
  showHidden: boolean;
  overview: GitOverview | null;
  /** The base branch of the copy the session works in, when it works in one. */
  worktreeBase?: string;
  timeline: CheckpointList | null;
  /** How the select names a comparison the timeline asked for. */
  checkpointName: string | null;
  inline: boolean;
  onToggleInline(): void;
  onSwitchMode(next: PanelMode): void;
  onBase(base: DiffBase): void;
  onClose(): void;
}

/** The top of the panel of changes: its tabs, what it compares with, and how it shows it. */
export function ChangesHeader({
  mode,
  problems,
  commentCount,
  showHidden,
  overview,
  worktreeBase,
  timeline,
  checkpointName,
  inline,
  onToggleInline,
  onSwitchMode,
  onBase,
  onClose,
}: Props) {
  const t = useT();
  const files = mode === 'files';
  const problemsMode = mode === 'problems';
  const reviewMode = mode === 'review';
  const allMode = mode === 'all';
  const searchMode = mode === 'search';
  return (
    <header className="changes-header">
      <h2>
        {t('changes.title')}{' '}
        <span className="count">{overview?.ok ? overview.changes.length : ''}</span>
      </h2>
      <button
        className={files ? 'active' : ''}
        aria-pressed={files}
        onClick={() => onSwitchMode(files ? 'changes' : 'files')}
        title={t('changes.allFilesHint')}
      >
        {t('changes.allFiles')}
      </button>
      <button
        className={allMode ? 'active' : ''}
        aria-pressed={allMode}
        data-testid="all-tab"
        onClick={() => onSwitchMode(allMode ? 'changes' : 'all')}
        title={t('all.tabHint')}
      >
        {t('all.tab')}
      </button>
      <button
        className={problemsMode ? 'active' : ''}
        aria-pressed={problemsMode}
        data-testid="problems-tab"
        onClick={() => onSwitchMode(problemsMode ? 'changes' : 'problems')}
        title={t('problems.tabHint')}
      >
        {problems.count > 0
          ? `${t('problems.tab')} (${problems.count}${problems.more ? '+' : ''})`
          : t('problems.tab')}
      </button>
      <button
        className={searchMode ? 'active' : ''}
        aria-pressed={searchMode}
        data-testid="search-tab"
        onClick={() => onSwitchMode(searchMode ? 'changes' : 'search')}
        title={t('search.tabHint')}
      >
        {t('search.tab')}
      </button>
      <button
        className={reviewMode ? 'active' : ''}
        aria-pressed={reviewMode}
        data-testid="review-tab"
        onClick={() => onSwitchMode(reviewMode ? 'changes' : 'review')}
        title={t('review.tabHint')}
      >
        {commentCount > 0 ? `${t('review.tab')} (${commentCount})` : t('review.tab')}
      </button>
      {files && (
        <label className="check">
          <input
            type="checkbox"
            checked={showHidden}
            onChange={(e) =>
              void window.api.invoke('prefs:set', { showHiddenFiles: e.target.checked })
            }
          />
          {t('changes.hidden')}
        </label>
      )}
      <span className="readonly-tag" title={t('changes.editableHint')}>
        {t('changes.editable')}
      </span>
      <span className="spacer" />
      {overview?.ok && (
        <>
          <label className="field-inline">
            <span>{t('changes.compareWith')}</span>
            <select
              aria-label={t('changes.compareWith')}
              value={overview.base}
              onChange={(e) => onBase(e.target.value as DiffBase)}
            >
              <option value="head">{t('changes.base.head')}</option>
              <option value="session" disabled={!overview.hasSessionBase}>
                {t('changes.base.session')}
              </option>
              {worktreeBase !== undefined && (
                <option value="branchBase" disabled={!overview.hasBranchBase}>
                  {t('changes.base.branchBase', { base: worktreeBase })}
                </option>
              )}
              {timeline?.available && (
                <option value="previousTurn" disabled={timeline.items.length === 0}>
                  {t('changes.base.previousTurn')}
                </option>
              )}
              {checkpointName && <option value={overview.base}>{checkpointName}</option>}
            </select>
          </label>
          <button
            className={inline ? 'active' : ''}
            aria-pressed={inline}
            onClick={onToggleInline}
            title={t('changes.viewHint')}
          >
            {inline ? t('changes.inline') : t('changes.sideBySide')}
          </button>
        </>
      )}
      <button onClick={onClose} title={t('changes.closeHint')} aria-label={t('changes.close')}>
        ×
      </button>
    </header>
  );
}
