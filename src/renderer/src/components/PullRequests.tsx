import { useEffect, useMemo, useRef, useState, type KeyboardEvent } from 'react';
import type { PipelineFix } from '@shared/ipc';
import {
  parseRepoList,
  PULLS_REPOS_LIMIT,
  type PullRequestView,
  type PullsSettings,
} from '@shared/pulls';
import { errorMessage } from '../lib/format';
import { useT } from '../lib/i18n';
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

const saveSettings = (settings: PullsSettings) =>
  window.api.invoke('prefs:set', { pulls: settings });

const openSite = (url: string) => void window.api.invoke('shell:openExternal', url);

/**
 * The open pull requests of the watched repositories, with their pipelines: one look a minute,
 * in the main process, for this panel and for the notices.
 */
export function PullRequests({ onClose, focusKey, onFix }: Props) {
  const t = useT();
  const state = useAppState((s) => s.pulls);
  const settings = useAppState((s) => s.prefs.pulls);
  const now = useNow(10_000);
  const [tab, setTab] = useState<Tab>(() => (state.pulls.some((p) => p.mine) ? 'mine' : 'all'));
  const [editing, setEditing] = useState(settings.repos.length === 0);
  const [fixing, setFixing] = useState<string | null>(null);
  const [problem, setProblem] = useState<string | null>(null);
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

  const statusNote = () => {
    if (state.status === 'noCli') return t('pulls.status.noCli');
    if (state.status === 'loggedOut') {
      return t('pulls.status.loggedOut', {
        account: settings.account
          ? t('pulls.status.loggedOutAccount', { account: settings.account })
          : '',
      });
    }
    if (state.status === 'error') return t('pulls.status.error', { error: state.error ?? '' });
    return null;
  };
  const note = statusNote();

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
        <span className="muted pulls-checked" data-testid="pulls-checked">
          {state.loading
            ? t('pulls.checking')
            : state.checkedAt
              ? t('pulls.checkedAt', { age: duration(t, state.checkedAt, now) })
              : ''}
          {state.login && ` · ${t('pulls.as', { login: state.login })}`}
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
      {note && (
        <p className="board-note error" role="alert" data-testid="pulls-status">
          {note}
        </p>
      )}
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
      {editing && <RepoSettings settings={settings} />}
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
                />
              ))}
            </section>
          ))
        )}
      </div>
    </section>
  );
}

function PullRow({
  pull,
  now,
  focused,
  fixing,
  onFix,
}: {
  pull: PullRequestView;
  now: number;
  focused: boolean;
  fixing: boolean;
  onFix(): void;
}) {
  const t = useT();
  const { state, jobs } = pull.pipeline;
  const failed = jobs.filter((j) => j.state === 'failure');
  const counted = jobs.filter((j) => j.state !== 'skipped');
  const passed = counted.filter((j) => j.state === 'success').length;
  const updated = Date.parse(pull.updatedAt);
  return (
    <article
      className={`pull-row ${focused ? 'focused' : ''}`}
      data-testid="pull-row"
      data-key={pull.key}
      data-pipeline={state}
      data-mine={pull.mine}
    >
      <div className="pull-line">
        <span
          className={`pipeline-dot pipeline-${state}`}
          title={t(`pulls.pipeline.${state}`)}
          aria-label={t(`pulls.pipeline.${state}`)}
        />
        <a
          href={pull.url}
          className="pull-title"
          title={t('pulls.openSite')}
          onClick={(e) => {
            e.preventDefault();
            openSite(pull.url);
          }}
        >
          <span className="muted">#{pull.number}</span> {pull.title}
        </a>
        {pull.draft && <span className="pull-tag">{t('pulls.draft')}</span>}
        {pull.review && (
          <span className={`pull-tag review-${pull.review}`}>
            {t(`pulls.review.${pull.review}`)}
          </span>
        )}
        {pull.reviewRequested && (
          <span className="pull-tag review-me">{t('pulls.reviewRequested')}</span>
        )}
      </div>
      <div className="pull-meta muted">
        <span>{t('pulls.by', { author: pull.author, branch: pull.branch, base: pull.base })}</span>
        {Number.isFinite(updated) && (
          <span>{t('pulls.updated', { age: duration(t, updated, now) })}</span>
        )}
        {counted.length > 0 && (
          <span>{t('pulls.pipeline.jobs', { passed, total: counted.length })}</span>
        )}
        {pull.comments > 0 && (
          <span>
            {pull.comments === 1
              ? t('pulls.comment')
              : t('pulls.comments', { count: pull.comments })}
          </span>
        )}
        {pull.reviewers.length > 0 && (
          <span>{t('pulls.reviewers', { names: pull.reviewers.join(', ') })}</span>
        )}
      </div>
      {failed.length > 0 && (
        <div className="pull-failed">
          <ul>
            {failed.map((job) => (
              <li key={job.name}>
                {job.url ? (
                  <a
                    href={job.url}
                    onClick={(e) => {
                      e.preventDefault();
                      openSite(job.url!);
                    }}
                  >
                    {job.name}
                  </a>
                ) : (
                  job.name
                )}
              </li>
            ))}
          </ul>
          <button
            className="primary"
            onClick={onFix}
            disabled={fixing}
            title={t('pulls.fixHint')}
            data-testid="pull-fix"
          >
            {fixing ? t('pulls.fixing') : t('pulls.fix')}
          </button>
        </div>
      )}
    </article>
  );
}

function RepoSettings({ settings }: { settings: PullsSettings }) {
  const t = useT();
  const [text, setText] = useState('');
  const [note, setNote] = useState<string | null>(null);
  const [available, setAvailable] = useState<string[] | null>(null);
  const [loading, setLoading] = useState(false);
  const [filter, setFilter] = useState('');
  const [account, setAccount] = useState(settings.account);
  const watched = new Set(settings.repos.map((r) => r.toLowerCase()));

  const setRepos = (repos: string[]) => {
    if (repos.length > PULLS_REPOS_LIMIT) {
      setNote(t('pulls.repos.limit', { limit: PULLS_REPOS_LIMIT }));
      return;
    }
    void saveSettings({ ...settings, repos });
  };

  const add = () => {
    const { repos, invalid } = parseRepoList(text);
    const merged = parseRepoList([...settings.repos, ...repos].join(',')).repos;
    setNote(invalid.length > 0 ? t('pulls.repos.invalid', { items: invalid.join(', ') }) : null);
    if (merged.length > PULLS_REPOS_LIMIT) {
      setNote(t('pulls.repos.limit', { limit: PULLS_REPOS_LIMIT }));
      return;
    }
    setRepos(merged);
    setText(invalid.join(', '));
  };

  const pick = async () => {
    setLoading(true);
    setNote(null);
    try {
      setAvailable(await window.api.invoke('pulls:available'));
    } catch (err) {
      setNote(errorMessage(err));
    } finally {
      setLoading(false);
    }
  };

  const toggle = (repo: string) =>
    setRepos(
      watched.has(repo.toLowerCase())
        ? settings.repos.filter((r) => r.toLowerCase() !== repo.toLowerCase())
        : [...settings.repos, repo],
    );

  const shown = (available ?? []).filter((r) =>
    r.toLowerCase().includes(filter.trim().toLowerCase()),
  );

  return (
    <div className="pulls-settings" data-testid="pulls-settings">
      <h3>{t('pulls.repos.title')}</h3>
      <div className="pulls-add">
        <input
          aria-label={t('pulls.repos.pasteLabel')}
          title={t('pulls.repos.pasteLabel')}
          placeholder={t('pulls.repos.paste')}
          value={text}
          data-testid="pulls-repos-input"
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') add();
          }}
        />
        <button onClick={add} disabled={!text.trim()} data-testid="pulls-repos-add">
          {t('pulls.repos.add')}
        </button>
        <button
          onClick={() => {
            void window.api.invoke('clipboard:write', settings.repos.join(', '));
            setNote(t('pulls.repos.copied'));
          }}
          disabled={settings.repos.length === 0}
        >
          {t('pulls.repos.copy')}
        </button>
      </div>
      {note && (
        <p className="muted" role="status" data-testid="pulls-repos-note">
          {note}
        </p>
      )}
      <ul className="pulls-chips" data-testid="pulls-repos">
        {settings.repos.length === 0 && <li className="muted">{t('pulls.repos.none')}</li>}
        {settings.repos.map((repo) => (
          <li key={repo} className="pulls-chip">
            {repo}
            <button
              className="icon-button"
              aria-label={t('pulls.repos.remove', { repo })}
              title={t('pulls.repos.remove', { repo })}
              onClick={() => toggle(repo)}
            >
              ×
            </button>
          </li>
        ))}
      </ul>
      {available === null ? (
        <button onClick={() => void pick()} disabled={loading} data-testid="pulls-pick">
          {loading ? t('pulls.repos.loading') : t('pulls.repos.pick')}
        </button>
      ) : (
        <div className="pulls-available">
          <input
            aria-label={t('pulls.repos.filter')}
            placeholder={t('pulls.repos.filter')}
            value={filter}
            onChange={(e) => setFilter(e.target.value)}
          />
          <ul data-testid="pulls-available">
            {shown.map((repo) => (
              <li key={repo}>
                <label>
                  <input
                    type="checkbox"
                    checked={watched.has(repo.toLowerCase())}
                    onChange={() => toggle(repo)}
                  />
                  {repo}
                </label>
              </li>
            ))}
          </ul>
        </div>
      )}
      <div className="pulls-options">
        <label title={t('pulls.accountHint')}>
          {t('pulls.account')}
          <input
            value={account}
            placeholder="—"
            data-testid="pulls-account"
            onChange={(e) => setAccount(e.target.value)}
            onBlur={() => {
              if (account.trim() !== settings.account) {
                void saveSettings({ ...settings, account: account.trim() });
              }
            }}
          />
        </label>
        <fieldset>
          <legend>{t('pulls.notify.title')}</legend>
          {(['notifyFailed', 'notifyComments', 'notifyReview'] as const).map((key) => (
            <label key={key}>
              <input
                type="checkbox"
                checked={settings[key]}
                onChange={(e) => void saveSettings({ ...settings, [key]: e.target.checked })}
              />
              {t(
                key === 'notifyFailed'
                  ? 'pulls.notify.failed'
                  : key === 'notifyComments'
                    ? 'pulls.notify.comments'
                    : 'pulls.notify.review',
              )}
            </label>
          ))}
        </fieldset>
      </div>
    </div>
  );
}
