import { useEffect, useMemo, useRef, useState, type KeyboardEvent } from 'react';
import type { OverviewGit } from '@shared/ipc';
import { statusLabel, type SessionGroup, type SessionView } from '@shared/session';
import { hint, PROFILE_LABEL } from '../lib/format';
import { useT } from '../lib/i18n';
import { store, useAppState } from '../lib/store';
import { ChecksBadge } from './ChecksDialog';
import { OverlapBadge, PermissionAsk, QueueBadge, ReviewBadge } from './SessionMarks';

export type OverviewFilter = 'all' | 'waiting' | 'working';

const FILTERS: readonly OverviewFilter[] = ['all', 'waiting', 'working'];

interface Props {
  /** Opens a session: the overview gives way to its terminal. */
  onOpen(sessionId: string): void;
  onClose(): void;
}

// How it was left, for the next time it opens while the app runs.
const remembered = { filter: 'all' as OverviewFilter, byAttention: true };

const isWaiting = (s: SessionView) => s.status.state === 'aguardando' && s.running;

/** 0: waits for the user; 1: its checks failed; 2: the rest. */
export function attentionRank(s: SessionView): number {
  if (isWaiting(s)) return 0;
  if (s.checks?.state === 'failed') return 1;
  return 2;
}

export function matchesFilter(s: SessionView, filter: OverviewFilter): boolean {
  if (filter === 'waiting') return isWaiting(s);
  if (filter === 'working') return s.status.state === 'trabalhando';
  return true;
}

/** "há 4 min": how long the session has been in its state. */
function duration(t: ReturnType<typeof useT>, since: number, now: number): string {
  const seconds = Math.max(0, Math.floor((now - since) / 1000));
  if (seconds < 60) return t('overview.duration.seconds', { count: seconds });
  if (seconds < 3600) return t('overview.duration.minutes', { count: Math.floor(seconds / 60) });
  if (seconds < 86400) return t('overview.duration.hours', { count: Math.floor(seconds / 3600) });
  return t('overview.duration.days', { count: Math.floor(seconds / 86400) });
}

/**
 * The last lines of every session, while the overview is open: all of them at first, then the
 * ones that changed, at most once a second (`sessions:tails`).
 */
function useTails(): Record<string, string[]> {
  const [tails, setTails] = useState<Record<string, string[]>>({});
  useEffect(() => {
    let live = true;
    const off = window.api.on('sessions:tails', (batch) => {
      if (live) setTails((current) => ({ ...current, ...batch }));
    });
    void window.api
      .invoke('overview:watch', true)
      .then((all) => live && setTails((current) => ({ ...current, ...all })))
      .catch(() => {});
    return () => {
      live = false;
      off();
      void window.api.invoke('overview:watch', false).catch(() => {});
    };
  }, []);
  return tails;
}

/**
 * Branch and changed files of each session, asked again when its state or folder changes (a turn
 * that ended is when files change) or when the watcher of an open panel sees something.
 */
function useGitInfo(sessions: SessionView[]): Record<string, OverviewGit> {
  const [info, setInfo] = useState<Record<string, OverviewGit>>({});
  const asked = useRef(new Map<string, string>());
  const ask = (id: string) =>
    void window.api
      .invoke('overview:git', id)
      .then((git) => setInfo((current) => ({ ...current, [id]: git })))
      .catch(() => {});
  useEffect(() => {
    for (const s of sessions) {
      const key = `${s.cwd}|${s.status.state}|${s.running}`;
      if (asked.current.get(s.id) === key) continue;
      asked.current.set(s.id, key);
      ask(s.id);
    }
  }, [sessions]);
  useEffect(() => window.api.on('git:changed', (id) => ask(id)), []);
  return info;
}

/** Re-renders now and then, for the "há 4 min" to move. */
function useNow(everyMs: number): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), everyMs);
    return () => clearInterval(timer);
  }, [everyMs]);
  return now;
}

/**
 * Every session in a grid, one block per group, without a terminal of its own: the cards show the
 * last lines the main process keeps of each one (ADR 0009 counts every xterm).
 */
export function Overview({ onOpen, onClose }: Props) {
  const t = useT();
  const sessions = useAppState((s) => s.sessions);
  const groups = useAppState((s) => s.groups);
  const selectedId = useAppState((s) => s.selectedId);
  const shortcuts = useAppState((s) => s.prefs.shortcuts);
  const [filter, setFilterState] = useState<OverviewFilter>(remembered.filter);
  const [byAttention, setByAttentionState] = useState(remembered.byAttention);
  const tails = useTails();
  const git = useGitInfo(sessions);
  const now = useNow(10_000);
  const root = useRef<HTMLElement>(null);

  const setFilter = (value: OverviewFilter) => {
    remembered.filter = value;
    setFilterState(value);
  };
  const setByAttention = (value: boolean) => {
    remembered.byAttention = value;
    setByAttentionState(value);
  };

  const blocks = useMemo(() => {
    const known = new Set(groups.map((g) => g.id));
    const order = (list: SessionView[]) =>
      byAttention
        ? list
            .map((s, i) => ({ s, i }))
            .sort((a, b) => attentionRank(a.s) - attentionRank(b.s) || a.i - b.i)
            .map(({ s }) => s)
        : list;
    const shown = sessions.filter((s) => matchesFilter(s, filter));
    const result: { group: SessionGroup | null; sessions: SessionView[] }[] = [];
    const loose = shown.filter((s) => !s.groupId || !known.has(s.groupId));
    if (loose.length) result.push({ group: null, sessions: order(loose) });
    for (const group of groups) {
      const members = shown.filter((s) => s.groupId === group.id);
      if (members.length) result.push({ group, sessions: order(members) });
    }
    return result;
  }, [sessions, groups, filter, byAttention]);

  const counts: Record<OverviewFilter, number> = {
    all: sessions.length,
    waiting: sessions.filter((s) => matchesFilter(s, 'waiting')).length,
    working: sessions.filter((s) => matchesFilter(s, 'working')).length,
  };

  // The keyboard starts on the session in sight, or on the first card; only when it opens; later
  // it stays where the user took it.
  useEffect(() => {
    const current = store.get().selectedId;
    const cards = root.current?.querySelectorAll<HTMLElement>('.overview-card');
    const first =
      root.current?.querySelector<HTMLElement>(`.overview-card[data-session-id="${current}"]`) ??
      cards?.[0];
    (first ?? root.current)?.focus();
  }, []);

  /** Left and right walk the cards in order; up and down go to the nearest card in that row. */
  const move = (from: HTMLElement, key: string) => {
    const cards = [...(root.current?.querySelectorAll<HTMLElement>('.overview-card') ?? [])];
    const at = cards.indexOf(from);
    if (key === 'ArrowLeft' || key === 'ArrowRight') {
      cards[Math.max(0, Math.min(cards.length - 1, at + (key === 'ArrowRight' ? 1 : -1)))]?.focus();
      return;
    }
    const box = from.getBoundingClientRect();
    const down = key === 'ArrowDown';
    let best: { card: HTMLElement; score: number } | null = null;
    for (const card of cards) {
      const other = card.getBoundingClientRect();
      const dy = down ? other.top - box.top : box.top - other.top;
      if (dy <= 1) continue;
      const score = dy * 1000 + Math.abs(other.left - box.left);
      if (!best || score < best.score) best = { card, score };
    }
    best?.card.focus();
  };

  const onCardKey = (event: KeyboardEvent, session: SessionView) => {
    if (event.target !== event.currentTarget) return;
    if (event.key.startsWith('Arrow')) {
      event.preventDefault();
      move(event.currentTarget as HTMLElement, event.key);
    } else if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault();
      onOpen(session.id);
    }
  };

  const renderCard = (session: SessionView) => {
    const label = statusLabel(t, session.status);
    const lines = tails[session.id] ?? [];
    const info = git[session.id];
    const branch = session.worktree?.branch ?? info?.branch ?? null;
    return (
      <article
        key={session.id}
        role="listitem"
        tabIndex={0}
        className={`overview-card ${session.id === selectedId ? 'current' : ''}`}
        data-session-id={session.id}
        data-state={session.status.state}
        aria-label={t('overview.card', { name: session.name, state: label })}
        onClick={() => onOpen(session.id)}
        onKeyDown={(e) => onCardKey(e, session)}
      >
        <div className="overview-card-head">
          <span
            className={`state-dot state-${session.status.state} ${session.status.confirmed ? '' : 'inferred'}`}
            aria-hidden="true"
          />
          <strong className="overview-card-name">{session.name}</strong>
          <span className={`profile-tag profile-${session.profile}`}>
            {PROFILE_LABEL[session.profile]}
          </span>
          {session.unread && <span className="badge" aria-label={t('sidebar.unread')} />}
        </div>
        <div
          className={`overview-card-state state-label state-label-${session.status.state} ${session.status.confirmed ? '' : 'inferred'}`}
          data-testid="overview-state"
        >
          {t('overview.since', { state: label, duration: duration(t, session.status.since, now) })}
        </div>
        {lines.length ? (
          <div
            className="overview-card-lines"
            data-testid="overview-lines"
            role="log"
            aria-label={t('overview.lines', { name: session.name })}
          >
            {lines.map((line, i) => (
              <div key={i} className="overview-line" title={line}>
                {line}
              </div>
            ))}
          </div>
        ) : (
          <div className="overview-card-lines empty" data-testid="overview-lines">
            {t('overview.noOutput')}
          </div>
        )}
        <PermissionAsk session={session} />
        <div className="overview-card-foot">
          {branch && (
            <span className="overview-branch" title={t('overview.branch', { branch })}>
              <span aria-hidden="true">⑂</span> {branch}
            </span>
          )}
          {info?.changes ? (
            <span
              className="overview-changes"
              data-testid="overview-changes"
              title={t('overview.changes', { count: info.changes })}
            >
              ± {info.changes}
            </span>
          ) : null}
          {session.checks && <ChecksBadge summary={session.checks} />}
          <ReviewBadge session={session} />
          <QueueBadge session={session} />
          <OverlapBadge session={session} />
        </div>
      </article>
    );
  };

  return (
    <section
      ref={root}
      className="overview"
      aria-label={t('overview.title')}
      tabIndex={-1}
      data-testid="overview"
      onKeyDown={(event) => {
        if (event.key !== 'Escape') return;
        event.preventDefault();
        event.stopPropagation();
        onClose();
      }}
    >
      <header className="overview-header">
        <h2>{t('overview.title')}</h2>
        <div className="overview-filters" role="radiogroup" aria-label={t('overview.filter')}>
          {FILTERS.map((value) => (
            <button
              key={value}
              role="radio"
              aria-checked={filter === value}
              className={filter === value ? 'active' : ''}
              onClick={() => setFilter(value)}
            >
              {t(`overview.filter.${value}`)}{' '}
              <span className="overview-count">{counts[value]}</span>
            </button>
          ))}
        </div>
        <label className="overview-sort" title={t('overview.sortByAttentionHint')}>
          <input
            type="checkbox"
            checked={byAttention}
            onChange={(e) => setByAttention(e.target.checked)}
          />
          {t('overview.sortByAttention')}
        </label>
        <span className="spacer" />
        <span className="muted overview-keys">{t('overview.keys')}</span>
        <button onClick={onClose} title={hint(t('overview.back'), shortcuts.overview[0])}>
          {t('overview.back')}
        </button>
      </header>
      <div className="overview-body">
        {blocks.length === 0 && (
          <p className="muted overview-empty">
            {sessions.length ? t('overview.emptyFilter') : t('overview.empty')}
          </p>
        )}
        {blocks.map(({ group, sessions: members }) => (
          <section
            key={group?.id ?? ''}
            className="overview-group"
            aria-label={group?.name ?? t('overview.ungrouped')}
          >
            {(group || groups.length > 0) && (
              <h3>
                {group?.name ?? t('overview.ungrouped')}{' '}
                <span className="group-count">{members.length}</span>
              </h3>
            )}
            <div className="overview-grid" role="list">
              {members.map(renderCard)}
            </div>
          </section>
        ))}
      </div>
    </section>
  );
}
