import { useEffect, useMemo, useRef, useState, type KeyboardEvent } from 'react';
import type { PipelineFix } from '@shared/ipc';
import {
  type GuardState,
  type Forge,
  type ForgeProblem,
  type PullRequestView,
} from '@shared/pulls';
import { errorMessage } from '../lib/format';
import { PullReview } from './PullReview';
import { PullRow, type PullSonar } from './PullRow';
import { RepoSettings } from './PullsSettings';
import { useT } from '../lib/i18n';
import { useSonarRuns } from '../lib/sonar';
import { useAppState } from '../lib/store';
import { duration, useNow } from './Overview';

type Tab = 'mine' | 'review' | 'all';

interface Props {
  onClose(): void;
  /** The pull request a notice was about: the panel shows it. */
  focusKey: string | null;
  /** Opens the prompt "Fix the pipeline" filled in with this. */
  onFix(fix: PipelineFix): void;
}

const inTab = (tab: Tab, pull: PullRequestView) =>
  tab === 'all' || (tab === 'mine' ? pull.mine : pull.reviewRequested);

/**
 * The open pull requests of the watched repositories, with their pipelines: one look a minute,
 * in the main process, for this panel and for the notices.
 */
/** The guard of each guarded pull request, kept up to date while the panel is open. */
function useGuard(): GuardState {
  const [state, setState] = useState<GuardState>({});
  useEffect(() => {
    let cancelled = false;
    window.api
      .invoke('pulls:guard')
      .then((value) => !cancelled && setState(value))
      .catch(() => {});
    const off = window.api.on('pulls:guardChanged', setState);
    return () => {
      cancelled = true;
      off();
    };
  }, []);
  return state;
}

export function PullRequests({ onClose, focusKey, onFix }: Props) {
  const t = useT();
  const guard = useGuard();
  const state = useAppState((s) => s.pulls);
  const settings = useAppState((s) => s.prefs.pulls);
  const now = useNow(10_000);
  const sessions = useAppState((s) => s.sessions);
  const sonarRuns = useSonarRuns();
  // The analysis of Sonar the app ran on the head commit of a pull request, in any session.
  const sonarOf = (pull: PullRequestView): PullSonar | undefined => {
    if (!pull.pipeline.sha) return undefined;
    for (const session of sessions) {
      const run = sonarRuns[session.id];
      if (run?.commit !== pull.pipeline.sha) continue;
      if (run.status === 'passed' || run.status === 'failed') {
        return { status: run.status, session: session.name };
      }
    }
    return undefined;
  };
  const [tab, setTab] = useState<Tab>(() => (state.pulls.some((p) => p.mine) ? 'mine' : 'all'));
  const [editing, setEditing] = useState(settings.repos.length === 0);
  const [fixing, setFixing] = useState<string | null>(null);
  const [problem, setProblem] = useState<string | null>(null);
  /** The pull request being reviewed in the app, which takes the place of the list. */
  const [reviewing, setReviewing] = useState<PullRequestView | null>(null);
  const root = useRef<HTMLElement>(null);

  useEffect(() => root.current?.focus(), []);

  // A notice opens the panel on its pull request, in a tab where it is. Only when another notice
  // comes in, not on every look: hence the latest list and tab are read through a ref.
  const latest = useRef({ pulls: state.pulls, tab });
  latest.current = { pulls: state.pulls, tab };
  useEffect(() => {
    if (!focusKey) return;
    const pull = latest.current.pulls.find((p) => p.key === focusKey);
    if (pull && !inTab(latest.current.tab, pull)) setTab('all');
    requestAnimationFrame(() =>
      root.current
        ?.querySelector(`[data-key="${CSS.escape(focusKey)}"]`)
        ?.scrollIntoView({ block: 'nearest' }),
    );
  }, [focusKey]);

  const counts = useMemo(
    () => ({
      mine: state.pulls.filter((p) => p.mine).length,
      review: state.pulls.filter((p) => p.reviewRequested).length,
      all: state.pulls.length,
    }),
    [state.pulls],
  );
  const groups = useMemo(() => {
    const byRepo = new Map<string, PullRequestView[]>();
    for (const pull of state.pulls) {
      if (!inTab(tab, pull)) continue;
      const list = byRepo.get(pull.repo) ?? [];
      list.push(pull);
      byRepo.set(pull.repo, list);
    }
    return [...byRepo.entries()];
  }, [state.pulls, tab]);

  const refresh = () => {
    setProblem(null);
    window.api.invoke('pulls:refresh').catch((err) => setProblem(errorMessage(err)));
  };

  const fix = async (pull: PullRequestView) => {
    setProblem(null);
    setFixing(pull.key);
    try {
      onFix(await window.api.invoke('pulls:fixPipeline', pull.key));
    } catch (err) {
      setProblem(errorMessage(err));
    } finally {
      setFixing(null);
    }
  };

  const onKey = (event: KeyboardEvent) => {
    if (event.key === 'Escape') {
      event.stopPropagation();
      onClose();
    }
  };

  // One note for each service that could not be read; the others still show.
  const problemNote = (problem: ForgeProblem) => {
    const service = t(`pulls.forge.${problem.forge}`);
    if (problem.status === 'error') {
      return t('pulls.status.error', { service, error: problem.error ?? '' });
    }
    if (problem.forge === 'gitlab') {
      return problem.status === 'noCli'
        ? t('pulls.status.noCliGitlab')
        : t('pulls.status.loggedOutGitlab', { host: problem.host ?? 'gitlab.com' });
    }
    if (problem.status === 'noCli') return t('pulls.status.noCli');
    return t('pulls.status.loggedOut', {
      account: settings.account
        ? t('pulls.status.loggedOutAccount', { account: settings.account })
        : '',
    });
  };
  const notes = state.problems.map((p) => ({ key: p.forge, text: problemNote(p) }));
  if (notes.length === 0 && state.status === 'error') {
    notes.push({ key: 'github', text: state.error ?? '' });
  }
  // With both services, each login says which one it is: the accounts often differ.
  const logins = (Object.entries(state.logins) as [Forge, string][]).filter(([, login]) => login);
  const loginText =
    logins.length > 1
      ? logins.map(([forge, login]) => `${login} (${t(`pulls.forge.${forge}`)})`).join(', ')
      : (logins[0]?.[1] ?? '');

  if (reviewing) {
    return (
      <section className="board pulls" aria-label={t('pulls.title')} data-testid="pulls-view">
        <PullReview
          pullKey={reviewing.key}
          forge={reviewing.forge}
          onBack={() => {
            setReviewing(null);
            requestAnimationFrame(() => root.current?.focus());
          }}
        />
      </section>
    );
  }

  return (
    <section
      ref={root}
      className="board pulls"
      aria-label={t('pulls.title')}
      tabIndex={-1}
      data-testid="pulls-view"
      data-status={state.status}
      onKeyDown={onKey}
    >
      <header className="board-header">
        <h2>{t('pulls.title')}</h2>
        <div className="pulls-tabs" role="tablist">
          {(['mine', 'review', 'all'] as const).map((id) => (
            <button
              key={id}
              role="tab"
              aria-selected={tab === id}
              className={`pulls-tab ${tab === id ? 'active' : ''}`}
              data-testid={`pulls-tab-${id}`}
              onClick={() => setTab(id)}
            >
              {t('pulls.tabCount', { label: t(`pulls.tab.${id}`), count: counts[id] })}
            </button>
          ))}
        </div>
        <span className="pulls-spacer" />
        <span
          className="muted pulls-checked"
          data-testid="pulls-checked"
          title={loginText ? t('pulls.as', { login: loginText }) : undefined}
        >
          {state.loading
            ? t('pulls.checking')
            : state.checkedAt
              ? t('pulls.checkedAt', { age: duration(t, state.checkedAt, now) })
              : ''}
          {loginText && ` · ${t('pulls.as', { login: loginText })}`}
        </span>
        <button onClick={refresh} disabled={state.loading} data-testid="pulls-refresh">
          {t('pulls.refresh')}
        </button>
        <button
          aria-pressed={editing}
          className={editing ? 'active' : ''}
          onClick={() => setEditing((e) => !e)}
          data-testid="pulls-repos-button"
        >
          {t('pulls.repos')} ({settings.repos.length})
        </button>
        <button
          className="icon-button"
          aria-label={t('pulls.close')}
          title={t('pulls.close')}
          onClick={onClose}
        >
          ×
        </button>
      </header>
      {notes.map((note) => (
        <p
          key={note.key}
          className="board-note error"
          role="alert"
          data-testid="pulls-status"
          data-forge={note.key}
        >
          {note.text}
        </p>
      ))}
      {problem && (
        <p className="board-note error" role="alert">
          {problem}
        </p>
      )}
      {Object.entries(state.repoErrors).map(([repo, error]) => (
        <p key={repo} className="board-note muted" data-testid="pulls-repo-error">
          {t('pulls.repoError', { repo, error })}
        </p>
      ))}
      {editing && <RepoSettings settings={settings} problemNote={problemNote} />}
      <div className="pulls-list" data-testid="pulls-list">
        {settings.repos.length === 0 ? (
          <p className="muted pulls-empty">{t('pulls.empty.repos')}</p>
        ) : groups.length === 0 ? (
          <p className="muted pulls-empty" data-testid="pulls-empty">
            {t('pulls.empty.none')}
          </p>
        ) : (
          groups.map(([repo, list]) => (
            <section key={repo} className="pulls-repo" aria-label={repo}>
              <h3>{repo}</h3>
              {list.map((pull) => (
                <PullRow
                  key={pull.key}
                  pull={pull}
                  now={now}
                  focused={pull.key === focusKey}
                  fixing={fixing === pull.key}
                  onFix={() => void fix(pull)}
                  guard={guard[pull.key]}
                  sonar={sonarOf(pull)}
                  onReview={() => setReviewing(pull)}
                  onGuard={(on) =>
                    void window.api
                      .invoke('pulls:setGuard', pull.key, on)
                      .catch((err) => setProblem(errorMessage(err)))
                  }
                />
              ))}
            </section>
          ))
        )}
      </div>
    </section>
  );
}
