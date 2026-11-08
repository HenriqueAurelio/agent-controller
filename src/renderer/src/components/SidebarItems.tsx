// What a row of the list of sessions shows: a session (its name, marks and buttons) and the header
// of a group (its Sonar summary and buttons). The keyboard and the dragging stay in the Sidebar.
import { useEffect, useRef, useState } from 'react';
import type { SessionMetrics } from '@shared/ipc';
import { sonarSummary, type SonarRun } from '@shared/sonar';
import type { SessionGroup, SessionView } from '@shared/session';
import { formatCpu, formatMemory, PROFILE_LABEL } from '../lib/format';
import { useT } from '../lib/i18n';
import { useAppState } from '../lib/store';
import { ChecksBadge } from './ChecksDialog';
import { FlowBadge, OverlapBadge, PermissionAsk, QueueBadge, ReviewBadge } from './SessionMarks';
import { UsageBadge } from './UsageBadge';

export function RenameInput({
  value: initial,
  label,
  onCommit,
  onEnd,
}: {
  value: string;
  label: string;
  onCommit(value: string): void;
  onEnd(): void;
}) {
  const [value, setValue] = useState(initial);
  const ref = useRef<HTMLInputElement>(null);
  useEffect(() => ref.current?.select(), []);
  const commit = () => {
    if (value.trim()) onCommit(value);
    onEnd();
  };
  return (
    <input
      ref={ref}
      className="rename-input"
      data-keeps-focus
      aria-label={label}
      value={value}
      onChange={(e) => setValue(e.target.value)}
      onBlur={commit}
      onClick={(e) => e.stopPropagation()}
      onDoubleClick={(e) => e.stopPropagation()}
      onKeyDown={(e) => {
        e.stopPropagation();
        if (e.key === 'Enter') commit();
        if (e.key === 'Escape') onEnd();
      }}
    />
  );
}

/** Inside the row of a session: its state, name, marks, metrics and buttons. */
export function SessionItemContent({
  session,
  label,
  renaming,
  metrics,
  heaviest,
  onRenameEnd,
  onDuplicate,
  onClose,
}: {
  session: SessionView;
  /** The state of the session, in words. */
  label: string;
  renaming: boolean;
  /** CPU and memory, while it runs. */
  metrics: SessionMetrics | undefined;
  /** Whether it is the running session that weighs the most. */
  heaviest: boolean;
  onRenameEnd(): void;
  onDuplicate(): void;
  onClose(): void;
}) {
  const t = useT();
  const permissionStale = useAppState((s) => s.permissionStale);
  const m = metrics;
  return (
    <>
      <span
        className={`state-dot state-${session.status.state} ${session.status.confirmed ? '' : 'inferred'}`}
        title={label}
        aria-label={label}
      />
      <div className="session-text">
        {renaming ? (
          <RenameInput
            value={session.name}
            label={t('sidebar.sessionName')}
            onCommit={(name) => void window.api.invoke('sessions:rename', session.id, name)}
            onEnd={onRenameEnd}
          />
        ) : (
          <span className="session-name">{session.name}</span>
        )}
        <span className="session-meta">
          {/* First: the end of the line is cut when the list is narrow. */}
          <FlowBadge session={session} />
          <ReviewBadge session={session} />
          <OverlapBadge session={session} />
          <QueueBadge session={session} />
          <span className={`profile-tag profile-${session.profile}`}>
            {PROFILE_LABEL[session.profile]}
          </span>
          <UsageBadge session={session} />
          <span
            className={`session-state state-label state-label-${session.status.state} ${session.status.confirmed ? '' : 'inferred'}`}
          >
            {label}
          </span>
          {session.checks && <ChecksBadge summary={session.checks} />}
        </span>
        <PermissionAsk session={session} />
        {permissionStale === session.id && (
          <span className="permission-stale" role="status" data-testid="permission-stale">
            {t('permission.stale')}
          </span>
        )}
        {session.pendingSends ? (
          <span className="pending-send" data-testid="pending-send">
            {t('sidebar.pendingSend', { count: session.pendingSends })}
            <button
              className="link-button"
              aria-label={t('sidebar.cancelSend', { name: session.name })}
              onClick={(e) => {
                e.stopPropagation();
                void window.api.invoke('terminal:cancelSend', session.id);
              }}
            >
              {t('common.cancel')}
            </button>
          </span>
        ) : null}
        {m && (
          <span
            className={`session-metrics ${heaviest ? 'heaviest' : ''}`}
            title={t('sidebar.processes', { count: m.processes })}
          >
            CPU {formatCpu(m.cpu)} · RAM {formatMemory(m.memory)}
          </span>
        )}
      </div>
      {session.unread && <span className="badge" aria-label={t('sidebar.unread')} />}
      <button
        className="icon-button item-button"
        title={t('sidebar.duplicateHint')}
        aria-label={t('sidebar.duplicate', { name: session.name })}
        onClick={(e) => {
          e.stopPropagation();
          onDuplicate();
        }}
      >
        ⧉
      </button>
      <button
        className="icon-button item-button close-button"
        title={t('app.closeSession.title')}
        aria-label={t('sidebar.close', { name: session.name })}
        onClick={(e) => {
          e.stopPropagation();
          onClose();
        }}
      >
        ×
      </button>
    </>
  );
}

/** How the analyses of the sessions of a group went: passed, failed, running. */
export function GroupSonar({ runs }: { runs: (SonarRun | undefined)[] }) {
  const t = useT();
  const summary = sonarSummary(runs);
  if (summary.passed + summary.failed + summary.running === 0) return null;
  return (
    <span
      className="group-sonar"
      data-testid="group-sonar-summary"
      data-passed={summary.passed}
      data-failed={summary.failed}
      data-running={summary.running}
      title={[
        t('sonar.summaryHint'),
        summary.passed > 0 && t('sonar.summary.passed', { count: summary.passed }),
        summary.failed > 0 && t('sonar.summary.failed', { count: summary.failed }),
        summary.running > 0 && t('sonar.summary.running', { count: summary.running }),
      ]
        .filter(Boolean)
        .join('\n')}
    >
      {summary.passed > 0 && <span className="sonar-ok">{summary.passed}✓</span>}
      {summary.failed > 0 && <span className="sonar-bad">{summary.failed}✗</span>}
      {summary.running > 0 && <span className="sonar-run">{summary.running}…</span>}
    </span>
  );
}

/** The buttons at the end of the header of a group. */
export function GroupActions({
  group,
  onSonar,
  onNew,
  onFlow,
  onCompare,
  onEdit,
}: {
  group: SessionGroup;
  onSonar(): void;
  onNew(): void;
  onFlow(): void;
  onCompare(experimentId: string): void;
  onEdit(): void;
}) {
  const t = useT();
  return (
    <>
      <button
        className="icon-button item-button sonar-button"
        title={t('sonar.buttonHint', { name: group.name })}
        aria-label={t('sonar.title', { name: group.name })}
        data-testid="sonar-button"
        onClick={(e) => {
          e.stopPropagation();
          onSonar();
        }}
      >
        ◈
      </button>
      <button
        className="icon-button item-button"
        title={t('group.newSession', { name: group.name })}
        aria-label={t('group.newSession', { name: group.name })}
        onClick={(e) => {
          e.stopPropagation();
          onNew();
        }}
      >
        +
      </button>
      {group.flow && (
        <button
          className="icon-button flow-pause-button"
          title={t(group.flow.paused ? 'flow.resumeLabel' : 'flow.stopLabel', {
            name: group.name,
          })}
          aria-label={t(group.flow.paused ? 'flow.resumeLabel' : 'flow.stopLabel', {
            name: group.name,
          })}
          data-testid="flow-pause-button"
          onClick={(e) => {
            e.stopPropagation();
            void window.api.invoke('flows:pause', group.id, !group.flow!.paused).catch(() => {});
          }}
        >
          {group.flow.paused ? '▶' : '⏸'}
        </button>
      )}
      <button
        className="icon-button item-button flow-button"
        title={t('flow.buttonHint')}
        aria-label={t('flow.title', { name: group.name })}
        data-testid="flow-button"
        onClick={(e) => {
          e.stopPropagation();
          onFlow();
        }}
      >
        ⇢
      </button>
      {group.experimentId && (
        <button
          className="icon-button item-button compare-button"
          title={t('group.compare', { name: group.name })}
          aria-label={t('group.compare', { name: group.name })}
          data-testid="compare-button"
          onClick={(e) => {
            e.stopPropagation();
            onCompare(group.experimentId!);
          }}
        >
          ⇄
        </button>
      )}
      <button
        className="icon-button item-button"
        title={t('group.edit', { name: group.name })}
        aria-label={t('group.edit', { name: group.name })}
        onClick={(e) => {
          e.stopPropagation();
          onEdit();
        }}
      >
        ✎
      </button>
      <button
        className="icon-button item-button close-button"
        title={t('group.remove', { name: group.name })}
        aria-label={t('group.remove', { name: group.name })}
        onClick={(e) => {
          e.stopPropagation();
          void window.api.invoke('groups:remove', group.id);
        }}
      >
        ×
      </button>
    </>
  );
}
