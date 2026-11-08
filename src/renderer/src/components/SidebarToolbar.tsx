import { hint } from '../lib/format';
import { useT } from '../lib/i18n';
import { useAppState } from '../lib/store';

interface Props {
  onOverview(): void;
  overviewOpen: boolean;
  onBoard(): void;
  boardOpen: boolean;
  onPulls(): void;
  pullsOpen: boolean;
  onBackground(): void;
  backgroundOpen: boolean;
  /** Without a group, asks for a new one. */
  onNewGroup(): void;
  onNewExperiment(): void;
  onPreferences(): void;
}

/** The top of the list of sessions: the panels, a new group or experiment, the preferences. */
export function SidebarToolbar({
  onOverview,
  overviewOpen,
  onBoard,
  boardOpen,
  onPulls,
  pullsOpen,
  onBackground,
  backgroundOpen,
  onNewGroup,
  onNewExperiment,
  onPreferences,
}: Props) {
  const t = useT();
  const shortcuts = useAppState((s) => s.prefs.shortcuts);
  // Background commands: how many run, and how many fell by themselves.
  const backgroundRunning = useAppState(
    (s) => Object.values(s.background.runs).filter((r) => r.status === 'running').length,
  );
  const backgroundFell = useAppState(
    (s) =>
      Object.values(s.background.runs).filter((r) => r.status === 'exited' || r.status === 'failed')
        .length,
  );
  // My pull requests whose pipeline failed: the button of the panel shows how many.
  const failingPulls = useAppState(
    (s) => s.pulls.pulls.filter((p) => p.mine && p.pipeline.state === 'failure').length,
  );
  return (
    <div className="sidebar-header">
      <span className="sidebar-title">{t('common.sessions')}</span>
      <span className="spacer" />
      <button
        className={`icon-button ${overviewOpen ? 'active' : ''}`}
        title={hint(t('overview.open'), shortcuts.overview[0])}
        aria-label={t('overview.open')}
        aria-pressed={overviewOpen}
        data-testid="overview-button"
        onClick={onOverview}
      >
        ▦
      </button>
      <button
        className={`icon-button ${boardOpen ? 'active' : ''}`}
        title={hint(t('board.open'), shortcuts.board[0])}
        aria-label={t('board.open')}
        aria-pressed={boardOpen}
        data-testid="board-button"
        onClick={onBoard}
      >
        ☷
      </button>
      <button
        className={`icon-button pulls-button ${pullsOpen ? 'active' : ''}`}
        title={hint(t('pulls.open'), shortcuts.pulls[0])}
        aria-label={t('pulls.open')}
        aria-pressed={pullsOpen}
        data-testid="pulls-button"
        onClick={onPulls}
      >
        ⇄
        {failingPulls > 0 && (
          <span className="pulls-badge" data-testid="pulls-badge">
            {failingPulls}
          </span>
        )}
      </button>
      <button
        className={`icon-button pulls-button ${backgroundOpen ? 'active' : ''}`}
        title={hint(
          backgroundRunning > 0
            ? t('background.openRunning', { count: backgroundRunning })
            : t('background.open'),
          shortcuts.background[0],
        )}
        aria-label={t('background.open')}
        aria-pressed={backgroundOpen}
        data-testid="background-button"
        data-running={backgroundRunning}
        onClick={onBackground}
      >
        ▶
        {backgroundFell > 0 ? (
          <span className="pulls-badge" data-testid="background-badge">
            {backgroundFell}
          </span>
        ) : (
          backgroundRunning > 0 && <span className="background-dot" aria-hidden="true" />
        )}
      </button>
      <button
        className="icon-button group-add-button"
        title={t('sidebar.newGroup')}
        aria-label={t('sidebar.newGroup')}
        data-testid="new-group-button"
        onClick={onNewGroup}
      >
        ⊞
      </button>
      <button
        className="icon-button"
        title={t('command.newExperiment')}
        aria-label={t('command.newExperiment')}
        data-testid="new-experiment-button"
        onClick={onNewExperiment}
      >
        ⑂
      </button>
      <button
        className="icon-button"
        title={hint(t('shortcut.preferences'), shortcuts.preferences[0])}
        onClick={onPreferences}
      >
        ⚙
      </button>
    </div>
  );
}
