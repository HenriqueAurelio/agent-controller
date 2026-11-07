// The header of the session in sight: its name, agent, branch, state and folder, and the buttons
// of what can be opened for it (changes, files, side terminal, timeline, reviewer, queue,
// checks, ports, pull request, Sonar).
import type { CheckpointList } from '@shared/checkpoints';
import type { Preferences } from '@shared/prefs';
import { statusLabel, type SessionView } from '@shared/session';
import type { SonarRun } from '@shared/sonar';
import { hint, PROFILE_LABEL } from '../lib/format';
import { useT } from '../lib/i18n';
import type { PanelMode } from './ChangesPanel';
import { ChecksBadge } from './ChecksDialog';

/** The dialogs the header opens. */
export type HeaderOverlay = 'timeline' | 'reviewer' | 'queue' | 'checks' | 'branch';

interface Props {
  session: SessionView;
  /** What the session runs in place of the agent, when it is not the agent itself. */
  agentCommand: string | undefined;
  /** The detail of the state, already in words. */
  detail: string | null;
  changesOpen: boolean;
  panelMode: PanelMode;
  /** The files changed, for the count on "see changes"; null while unknown. */
  changeCount: number | null;
  timeline: CheckpointList | null;
  shortcuts: Preferences['shortcuts'];
  /** The ports the session listens on. */
  ports: number[];
  sonar: SonarRun | undefined;
  onChangeFolder(): void;
  onTogglePanel(mode: PanelMode): void;
  onToggleAux(): void;
  onOpen(overlay: HeaderOverlay): void;
  onOpenPort(port: number): void;
  onRunSonar(): void;
}

export function SessionHeader({
  session,
  agentCommand,
  detail,
  changesOpen,
  panelMode,
  changeCount,
  timeline,
  shortcuts,
  ports,
  sonar,
  onChangeFolder,
  onTogglePanel,
  onToggleAux,
  onOpen,
  onOpenPort,
  onRunSonar,
}: Props) {
  const t = useT();
  return (
    <header className="session-header">
      <span
        className={`state-dot state-${session.status.state} ${session.status.confirmed ? '' : 'inferred'}`}
      />
      <div className="session-header-text">
        <strong>{session.name}</strong>
        <span className="muted">
          {PROFILE_LABEL[session.profile]}
          {agentCommand && <span className="command"> · {agentCommand}</span>}
        </span>
        {session.worktree && (
          <span
            className="worktree-tag"
            data-testid="session-worktree"
            title={t('app.worktreeHint', {
              repo: session.worktree.repoRoot,
              branch: session.worktree.branch,
              base: session.worktree.base,
            })}
          >
            <span aria-hidden="true">⑂</span> {session.worktree.branch}
          </span>
        )}
        <span
          data-testid="session-status"
          className={`state-label state-label-${session.status.state} ${session.status.confirmed ? '' : 'inferred'}`}
        >
          {statusLabel(t, session.status)}
          {detail && session.status.state !== 'terminou' ? ` (${detail})` : ''}
        </span>
        <button
          className="muted path"
          title={`${session.cwd}\n${t('app.changeFolderHint')}`}
          aria-label={t('app.changeFolder')}
          onClick={onChangeFolder}
        >
          {session.cwd}
        </button>
      </div>
      <span className="spacer" />
      <button
        className={`session-action icon-button ${changesOpen && panelMode === 'changes' ? 'active' : ''}`}
        onClick={() => onTogglePanel('changes')}
        title={hint(t('app.seeChanges'), shortcuts.toggleChanges[0])}
        aria-label={t('app.seeChanges')}
      >
        <span aria-hidden="true">&#8781;</span>
        <span className="sr-only">{t('app.seeChanges')}</span>
        {changeCount !== null && changeCount > 0 && <span className="count">{changeCount}</span>}
      </button>
      <button
        className={`session-action icon-button ${changesOpen && panelMode === 'files' ? 'active' : ''}`}
        onClick={() => onTogglePanel('files')}
        title={hint(t('app.allFilesHint'), shortcuts.toggleFiles[0])}
        aria-label={t('common.files')}
      >
        <span aria-hidden="true">&#128193;</span>
        <span className="sr-only">{t('common.files')}</span>
      </button>
      <button
        className={`session-action icon-button ${session.auxOpen ? 'active' : ''}`}
        aria-pressed={session.auxOpen === true}
        onClick={onToggleAux}
        title={hint(t('app.auxHint'), shortcuts.toggleAux[0])}
        aria-label={t('app.aux')}
      >
        <span aria-hidden="true">&gt;_</span>
        <span className="sr-only">{t('app.aux')}</span>
      </button>
      {timeline?.available && (
        <button
          className="timeline-button session-action icon-button"
          onClick={() => onOpen('timeline')}
          title={t('app.timelineHint')}
          aria-label={t('app.timeline')}
        >
          <span aria-hidden="true">&#128339;</span>
          <span className="sr-only">{t('app.timeline')}</span>
          {timeline.items.length > 0 && <span className="count">{timeline.items.length}</span>}
        </button>
      )}
      <button
        className={`reviewer-button session-action icon-button ${session.reviewer?.state === 'ready' ? 'ready' : ''}`}
        data-testid="reviewer-button"
        onClick={() => onOpen('reviewer')}
        title={t('app.reviewerHint')}
        aria-label={
          session.reviewer?.state === 'ready'
            ? t('app.reviewerReady', { count: session.reviewer.count ?? 0 })
            : t('app.reviewer')
        }
      >
        <span aria-hidden="true">&#128269;</span>
        <span className="sr-only">
          {session.reviewer?.state === 'ready'
            ? t('app.reviewerReady', { count: session.reviewer.count ?? 0 })
            : t('app.reviewer')}
        </span>
      </button>
      <button
        className="queue-button session-action icon-button"
        onClick={() => onOpen('queue')}
        title={t('app.queueHint')}
        aria-label={t('app.queue')}
      >
        <span aria-hidden="true">&#9776;</span>
        <span className="sr-only">{t('app.queue')}</span>
        {session.queue && (
          <span className={`count ${session.queue.paused ? 'paused' : ''}`}>
            {session.queue.items}
          </span>
        )}
      </button>
      <button
        className="checks-button session-action icon-button"
        onClick={() => onOpen('checks')}
        title={t('app.checksHint')}
        aria-label={t('app.checks')}
      >
        <span aria-hidden="true">&#10003;</span>
        <span className="sr-only">{t('app.checks')}</span>
        {session.checks && <ChecksBadge summary={session.checks} />}
      </button>
      {ports.length > 0 && (
        <span className="session-ports" title={t('app.ports')} data-testid="session-ports">
          {ports.slice(0, 4).map((port) => (
            <button
              key={port}
              className="port-chip"
              title={t('app.port', { port })}
              onClick={() => onOpenPort(port)}
            >
              :{port}
            </button>
          ))}
        </span>
      )}
      {session.worktree && (
        <button
          className="branch-button session-action"
          data-testid="branch-button"
          onClick={() => onOpen('branch')}
          title={t('branch.buttonHint')}
        >
          {t('branch.button')}
        </button>
      )}
      {sonar && (
        <button
          className={`sonar-chip session-action status-${sonar.status}`}
          data-testid="sonar-chip"
          data-status={sonar.status}
          title={
            sonar.error ??
            t('sonar.chipHint', {
              status: t(`sonar.status.${sonar.status}`),
            })
          }
          onClick={onRunSonar}
        >
          {t('sonar.chip', { status: t(`sonar.status.${sonar.status}`) })}
        </button>
      )}
    </header>
  );
}
