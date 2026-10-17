import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  CHANGE_LETTER,
  type ChangeKind,
  type FileEntry,
  type FileListing,
  type RepoInfo,
} from '@shared/git';
import { errorMessage } from '../lib/format';
import { useT } from '../lib/i18n';

interface Props {
  sessionId: string;
  /** Also list dotfiles and what .gitignore covers. */
  showHidden: boolean;
  /** The file open in the editor. */
  selected: string | null;
  /** Bumped when the folder changed on disk, to list the open folders again. */
  revision: number;
  /** What git says changed, to mark those files in the tree. */
  changes: ReadonlyMap<string, ChangeKind>;
  /**
   * The repositories of the session by their path, when there is more than one: their folders
   * stand out in the tree, so it is clear where one ends and the next begins.
   */
  repos: ReadonlyMap<string, RepoInfo>;
  onSelect(path: string): void;
}

interface Row {
  entry: FileEntry;
  depth: number;
}

const parentOf = (path: string) => path.slice(0, Math.max(0, path.lastIndexOf('/')));

/** Every file of the session folder, one level at a time: a folder is only read when opened. */
export function FileTree({
  sessionId,
  showHidden,
  selected,
  revision,
  changes,
  repos,
  onSelect,
}: Props) {
  const t = useT();
  const [listings, setListings] = useState<Record<string, FileListing>>({});
  const [expanded, setExpanded] = useState<ReadonlySet<string>>(new Set());
  const [active, setActive] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const treeRef = useRef<HTMLUListElement>(null);
  const expandedRef = useRef(expanded);
  expandedRef.current = expanded;

  const load = useCallback(
    async (dir: string) => {
      try {
        const listing = await window.api.invoke('files:list', sessionId, dir, showHidden);
        setListings((current) => ({ ...current, [dir]: listing }));
        if (dir === '') setError(null);
      } catch (err) {
        if (dir === '') setError(errorMessage(err));
        else {
          // The folder is gone, or is hidden now: it leaves the tree.
          setExpanded((current) => new Set([...current].filter((d) => d !== dir)));
          setListings((current) =>
            Object.fromEntries(Object.entries(current).filter(([d]) => d !== dir)),
          );
        }
      }
    },
    [sessionId, showHidden],
  );

  useEffect(() => {
    void load('');
    for (const dir of expandedRef.current) void load(dir);
  }, [load, revision]);

  // A file opened from outside the tree (a link in the terminal) shows where it is.
  useEffect(() => {
    if (!selected) return;
    const parts = selected.split('/').slice(0, -1);
    const dirs = parts.map((_, i) => parts.slice(0, i + 1).join('/'));
    const missing = dirs.filter((dir) => !expandedRef.current.has(dir));
    if (missing.length === 0) return;
    setExpanded((current) => new Set([...current, ...dirs]));
    for (const dir of missing) void load(dir);
  }, [selected, load]);

  useEffect(() => treeRef.current?.focus(), []);

  const rows = useMemo(() => {
    const out: Row[] = [];
    const walk = (dir: string, depth: number) => {
      for (const entry of listings[dir]?.entries ?? []) {
        out.push({ entry, depth });
        if (entry.kind === 'dir' && expanded.has(entry.path)) walk(entry.path, depth + 1);
      }
    };
    walk('', 0);
    return out;
  }, [listings, expanded]);

  const toggle = (dir: string) => {
    const next = new Set(expanded);
    if (next.delete(dir)) {
      // Whatever was open below closes with it.
      for (const other of next) if (other.startsWith(`${dir}/`)) next.delete(other);
    } else {
      next.add(dir);
      void load(dir);
    }
    setExpanded(next);
  };

  const open = (entry: FileEntry) => {
    setActive(entry.path);
    if (entry.kind === 'dir') toggle(entry.path);
    else onSelect(entry.path);
  };

  const index = rows.findIndex((r) => r.entry.path === (active ?? selected));
  const moveTo = (target: number) => {
    const row = rows[Math.max(0, Math.min(rows.length - 1, target))];
    if (!row) return;
    setActive(row.entry.path);
    document.getElementById(`file-${rows.indexOf(row)}`)?.scrollIntoView({ block: 'nearest' });
  };

  const onKeyDown = (event: React.KeyboardEvent) => {
    const current = rows[index]?.entry;
    const moves: Record<string, number> = {
      ArrowDown: index + 1,
      ArrowUp: Math.max(0, index - 1),
      Home: 0,
      End: rows.length - 1,
    };
    if (event.key in moves) {
      event.preventDefault();
      moveTo(moves[event.key]!);
    } else if (!current) {
      return;
    } else if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault();
      open(current);
    } else if (event.key === 'ArrowRight' && current.kind === 'dir') {
      event.preventDefault();
      if (expanded.has(current.path)) moveTo(index + 1);
      else toggle(current.path);
    } else if (event.key === 'ArrowLeft') {
      event.preventDefault();
      if (current.kind === 'dir' && expanded.has(current.path)) toggle(current.path);
      else {
        const parent = parentOf(current.path);
        if (parent) moveTo(rows.findIndex((r) => r.entry.path === parent));
      }
    }
  };

  /** The repository folder a row is in or is, among the ones that stand out in the tree. */
  const ownerOf = (file: string): string => {
    let best = '';
    for (const repo of repos.keys()) {
      if (repo.length > best.length && (file === repo || file.startsWith(`${repo}/`))) best = repo;
    }
    return best;
  };

  const root = listings[''];
  const outer = repos.get('');
  const truncated = Object.values(listings).some((l) => l.truncated);

  return (
    <ul
      ref={treeRef}
      className="changes-list file-tree"
      role="tree"
      tabIndex={0}
      aria-label={t('changes.allFiles')}
      aria-activedescendant={index >= 0 ? `file-${index}` : undefined}
      onKeyDown={onKeyDown}
    >
      {error && <li className="file-tree-note error">{t('tree.error', { error })}</li>}
      {outer && (
        // The repository the tree starts at has no row of its own to mark.
        <li role="presentation" className="changes-repo" data-repo="">
          <span className="changes-repo-name">{outer.name}</span>
          {outer.branch && <span className="muted">{outer.branch}</span>}
          <span className="spacer" />
          {outer.count > 0 && <span className="count">{outer.count}</span>}
        </li>
      )}
      {!error && root && rows.length === 0 && (
        <li className="file-tree-note">
          {showHidden ? t('tree.empty') : t('tree.emptyWithoutHidden')}
        </li>
      )}
      {rows.map(({ entry, depth }, i) => {
        const change = changes.get(entry.path);
        const repo = entry.kind === 'dir' ? repos.get(entry.path) : undefined;
        // The first row after the files of a repository: the tree is back in the outer one.
        const leaves =
          !repo &&
          i > 0 &&
          repos.size > 0 &&
          ownerOf(rows[i - 1]!.entry.path) !== ownerOf(entry.path);
        const isOpen = entry.kind === 'dir' && expanded.has(entry.path);
        return (
          <li
            key={entry.path}
            id={`file-${i}`}
            role="treeitem"
            aria-level={depth + 1}
            aria-expanded={entry.kind === 'dir' ? isOpen : undefined}
            aria-selected={entry.path === selected}
            data-path={entry.path}
            data-kind={entry.kind}
            data-hidden={entry.hidden}
            className={[
              'change-item',
              'file-item',
              entry.path === selected ? 'selected' : '',
              i === index ? 'active' : '',
              entry.hidden ? 'hidden-entry' : '',
              repo ? 'repo-row' : '',
              leaves ? 'after-repo' : '',
            ].join(' ')}
            style={{ paddingLeft: 10 + depth * 14 }}
            title={change ? `${t(`change.${change}`)}: ${entry.path}` : entry.path}
            onClick={() => open(entry)}
          >
            <span className="file-twist" aria-hidden="true">
              {entry.kind === 'dir' ? (isOpen ? '▾' : '▸') : ''}
            </span>
            <span className="change-name">{entry.name}</span>
            {repo?.branch && <span className="repo-branch muted">{repo.branch}</span>}
            {repo && <span className="spacer" />}
            {repo && repo.count > 0 && <span className="count">{repo.count}</span>}
            {change && (
              <span className={`change-kind kind-${change}`}>{CHANGE_LETTER[change]}</span>
            )}
          </li>
        );
      })}
      {truncated && <li className="file-tree-note">{t('tree.truncated')}</li>}
    </ul>
  );
}
