// The repositories the panel of pull requests watches, and the account of `gh` that reads them.
import { useEffect, useRef, useState, type KeyboardEvent } from 'react';
import {
  FORGES,
  forgeOf,
  parseRepoList,
  PULLS_REPOS_LIMIT,
  type AvailableRepos,
  type GhAccounts,
  type Forge,
  type ForgeProblem,
  type PullsSettings,
} from '@shared/pulls';
import { errorMessage } from '../lib/format';
import { useT } from '../lib/i18n';

const saveSettings = (settings: PullsSettings) =>
  window.api.invoke('prefs:set', { pulls: settings });

interface SettingsProps {
  settings: PullsSettings;
  problemNote(problem: ForgeProblem): string;
}

export function RepoSettings({ settings, problemNote }: SettingsProps) {
  const t = useT();
  const [note, setNote] = useState<string | null>(null);

  /** Saves the list, unless it goes past the limit; false then. */
  const save = (repos: string[]) => {
    if (repos.length > PULLS_REPOS_LIMIT) {
      setNote(t('pulls.repos.limit', { limit: PULLS_REPOS_LIMIT }));
      return false;
    }
    setNote(null);
    void saveSettings({ ...settings, repos });
    return true;
  };

  return (
    <div className="pulls-settings" data-testid="pulls-settings">
      <div className="pulls-settings-head">
        <h3>{t('pulls.repos.title')}</h3>
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
      <div className="pulls-forges">
        {FORGES.map((forge) => (
          <fieldset key={forge} className="pulls-forge" data-testid={`pulls-forge-${forge}`}>
            <legend>{t(`pulls.forge.${forge}`)}</legend>
            <RepoPicker
              // Another account sees other repositories: the list is asked again.
              key={forge === 'github' ? `github:${settings.account}` : forge}
              forge={forge}
              repos={settings.repos}
              onChange={save}
              problemNote={problemNote}
            />
            {forge === 'github' && (
              <GhAccountSelect
                value={settings.account}
                onChange={(account) => void saveSettings({ ...settings, account })}
              />
            )}
          </fieldset>
        ))}
      </div>
      <fieldset className="pulls-notify">
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
  );
}

interface PickerProps {
  forge: Forge;
  /** Every watched repository, of both services: the picker shows and changes its own. */
  repos: string[];
  onChange(repos: string[]): boolean;
  problemNote(problem: ForgeProblem): string;
}

/**
 * Which account of `gh` reads GitHub. Only with more than one logged in: with one, there is
 * nothing to pick. The active one of `gh` is the default and is not changed.
 */
function GhAccountSelect({ value, onChange }: { value: string; onChange(account: string): void }) {
  const t = useT();
  const [list, setList] = useState<GhAccounts | null>(null);
  useEffect(() => {
    let alive = true;
    window.api
      .invoke('pulls:accounts')
      .then((answer) => alive && setList(answer))
      .catch(() => alive && setList({ accounts: [], active: '' }));
    return () => {
      alive = false;
    };
  }, []);
  if (!list) return null;
  // One saved that is no longer logged in still shows, to be changed.
  const missing = value && !list.accounts.includes(value);
  if (list.accounts.length < 2 && !missing) return null;
  return (
    <label className="pulls-account" title={t('pulls.accountHint')}>
      {t('pulls.account')}
      <select
        value={value === list.active ? '' : value}
        data-testid="pulls-account"
        onChange={(e) => onChange(e.target.value)}
      >
        <option value="">
          {list.active
            ? t('pulls.accountActive', { login: list.active })
            : t('pulls.accountDefault')}
        </option>
        {list.accounts
          .filter((login) => login !== list.active)
          .map((login) => (
            <option key={login} value={login}>
              {login}
            </option>
          ))}
        {missing && <option value={value}>{t('pulls.accountMissing', { login: value })}</option>}
      </select>
    </label>
  );
}

/**
 * One box per service: the watched repositories as chips, and a field that filters the ones the
 * account can see (a list that opens under it, several picked in a row) and takes pasted names
 * and addresses too, separated by commas.
 */
function RepoPicker({ forge, repos, onChange, problemNote }: PickerProps) {
  const t = useT();
  const [query, setQuery] = useState('');
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);
  const [available, setAvailable] = useState<AvailableRepos | null>(null);
  const [loading, setLoading] = useState(false);
  const [invalid, setInvalid] = useState<string[]>([]);
  const input = useRef<HTMLInputElement>(null);
  const box = useRef<HTMLDivElement>(null);
  const listId = `pulls-options-${forge}`;

  const mine = repos.filter((r) => forgeOf(r) === forge);
  const watched = new Set(repos.map((r) => r.toLowerCase()));

  // The list is asked the first time the box is used, not when the panel opens: it costs a
  // query to the service, and most visits only look at the pull requests.
  // Asked again each time the list opens: a login done meanwhile, or a failure that passed,
  // shows without closing the panel. What was there stays on screen until the answer comes.
  const load = () => {
    if (loading) return;
    setLoading(true);
    window.api
      .invoke('pulls:available', forge)
      .then(setAvailable)
      .catch((err) =>
        setAvailable({
          repos: [],
          problem: { forge, status: 'error', error: errorMessage(err) },
        }),
      )
      .finally(() => setLoading(false));
  };

  const needle = query.trim().toLowerCase();
  const typed = parseRepoList(query).repos.filter((r) => !watched.has(r.toLowerCase()));
  // A comma means a pasted list, never a filter.
  const shown = query.includes(',')
    ? []
    : (available?.repos ?? []).filter((r) => r.toLowerCase().includes(needle));
  // What is typed and is a repository goes first, as "add", unless the list has it already.
  const extra = typed.filter((r) => !shown.some((s) => s.toLowerCase() === r.toLowerCase()));
  const options = [
    ...(extra.length > 0 ? [{ kind: 'add' as const, repos: extra }] : []),
    ...shown.map((repo) => ({ kind: 'repo' as const, repos: [repo] })),
  ];
  const current = Math.min(active, Math.max(0, options.length - 1));

  const toggle = (repo: string) => {
    onChange(
      watched.has(repo.toLowerCase())
        ? repos.filter((r) => r.toLowerCase() !== repo.toLowerCase())
        : [...repos, repo],
    );
  };

  const addTyped = () => {
    const parsed = parseRepoList(query);
    const merged = parseRepoList([...repos, ...parsed.repos].join(',')).repos;
    if (!onChange(merged)) return;
    setInvalid(parsed.invalid);
    // What was not understood stays in the field, to fix.
    setQuery(parsed.invalid.join(', '));
    setActive(0);
  };

  const choose = (index: number) => {
    const option = options[index];
    if (!option) return;
    if (option.kind === 'add') addTyped();
    else toggle(option.repos[0]!);
    input.current?.focus();
  };

  const onKey = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      event.preventDefault();
      if (!open) load();
      setOpen(true);
      const step = event.key === 'ArrowDown' ? 1 : -1;
      setActive((current + step + options.length) % Math.max(1, options.length));
    } else if (event.key === 'Enter') {
      event.preventDefault();
      if (options.length > 0 && (open || options[current]?.kind === 'add')) choose(current);
      else if (query.trim()) addTyped();
    } else if (event.key === 'Backspace' && query === '' && mine.length > 0) {
      toggle(mine[mine.length - 1]!);
    } else if (event.key === 'Escape' && open) {
      // Only the list closes; a second Esc closes the panel.
      event.stopPropagation();
      setOpen(false);
    }
  };

  const problem = available?.problem;

  return (
    <div
      ref={box}
      className="pulls-picker"
      data-testid={`pulls-picker-${forge}`}
      onBlur={(event) => {
        if (!box.current?.contains(event.relatedTarget as Node | null)) setOpen(false);
      }}
    >
      <div className="pulls-picker-field" onClick={() => input.current?.focus()}>
        <ul className="pulls-chips" data-testid={`pulls-repos-${forge}`}>
          {mine.map((repo) => (
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
        <input
          ref={input}
          role="combobox"
          aria-expanded={open}
          aria-controls={listId}
          aria-autocomplete="list"
          aria-activedescendant={open && options.length > 0 ? `${listId}-${current}` : undefined}
          aria-label={t('pulls.repos.inputLabel', { service: t(`pulls.forge.${forge}`) })}
          placeholder={mine.length === 0 ? t(`pulls.repos.placeholder.${forge}`) : ''}
          value={query}
          data-testid={`pulls-repos-input-${forge}`}
          onFocus={() => {
            setOpen(true);
            load();
          }}
          onChange={(e) => {
            setQuery(e.target.value);
            setInvalid([]);
            setActive(0);
            setOpen(true);
          }}
          onKeyDown={onKey}
        />
      </div>
      {open && (
        <ul
          id={listId}
          role="listbox"
          aria-multiselectable="true"
          className="pulls-options"
          data-testid={`pulls-available-${forge}`}
        >
          {options.map((option, index) => {
            const label =
              option.kind === 'add'
                ? t('pulls.repos.addTyped', { items: option.repos.join(', ') })
                : option.repos[0]!;
            const selected = option.kind === 'repo' && watched.has(label.toLowerCase());
            return (
              <li
                key={option.kind === 'add' ? '+' : label}
                id={`${listId}-${index}`}
                role="option"
                aria-selected={selected}
                className={`pulls-option ${index === current ? 'active' : ''} ${option.kind}`}
                // Keeps the focus in the field, so the list stays open for the next one.
                onMouseDown={(e) => e.preventDefault()}
                onMouseEnter={() => setActive(index)}
                onClick={() => choose(index)}
              >
                <span className="pulls-check" aria-hidden="true">
                  {option.kind === 'add' ? '+' : selected ? '✓' : ''}
                </span>
                {label}
              </li>
            );
          })}
          {options.length === 0 && (
            <li className="pulls-option muted" role="presentation">
              {loading
                ? t('pulls.repos.loading')
                : problem
                  ? t('pulls.repos.unavailable')
                  : needle
                    ? t('pulls.repos.noMatch')
                    : t('pulls.repos.none')}
            </li>
          )}
          {loading && options.length > 0 && (
            <li className="pulls-option muted" role="presentation">
              {t('pulls.repos.loading')}
            </li>
          )}
        </ul>
      )}
      {invalid.length > 0 && (
        <p className="muted" role="status" data-testid={`pulls-repos-invalid-${forge}`}>
          {t('pulls.repos.invalid', { items: invalid.join(', ') })}
        </p>
      )}
      {problem && (
        <p
          className="pulls-picker-problem"
          role="status"
          data-testid={`pulls-available-problem-${forge}`}
        >
          {problemNote(problem)}
        </p>
      )}
    </div>
  );
}
