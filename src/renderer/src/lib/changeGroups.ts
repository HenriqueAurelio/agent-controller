import type { FileChange, RepoInfo } from '@shared/git';

/** A folder of the list of changes, with what heads it (a section, a repository). */
export interface Group {
  key: string;
  /** Set on the first group of a section of the list (staged, not staged), when there are two. */
  section?: 'staged' | 'unstaged';
  /** Set on the first group of a repository, when the session has more than one. */
  repo?: RepoInfo;
  /** Folder of the files, relative to their repository. */
  folder: string;
  files: FileChange[];
}

export function groupByFolder(changes: FileChange[], repos: RepoInfo[]): Group[] {
  // With a single repository the list is by folder only, as it always was.
  const sections = repos.length > 1 ? repos.filter((r) => r.count > 0) : [undefined];
  return sections.flatMap((repo) => {
    const skip = repo?.path ? repo.path.length + 1 : 0;
    const folders = new Map<string, FileChange[]>();
    for (const change of changes) {
      if (repo && (change.repo ?? '') !== repo.path) continue;
      const slash = change.path.lastIndexOf('/');
      const folder = slash < skip ? '' : change.path.slice(skip, slash);
      const list = folders.get(folder);
      if (list) list.push(change);
      else folders.set(folder, [change]);
    }
    return [...folders.entries()]
      .sort(([x], [y]) => x.localeCompare(y))
      .map(([folder, files], index) => ({
        key: `${repo?.path ?? ''}:${folder}`,
        repo: index === 0 ? repo : undefined,
        folder,
        files,
      }));
  });
}

/** What is staged first, the rest after: what goes into the commit is the reviewed part. */
export function groupChanges(
  changes: FileChange[],
  stagedChanges: FileChange[],
  repos: RepoInfo[],
): Group[] {
  if (stagedChanges.length === 0) return groupByFolder(changes, repos);
  const mark = (list: Group[], section: Group['section']) =>
    list.map((group, index) => ({
      ...group,
      key: `${section}:${group.key}`,
      ...(index === 0 && { section }),
    }));
  return [
    ...mark(groupByFolder(stagedChanges, repos), 'staged'),
    ...mark(
      groupByFolder(
        changes.filter((c) => !c.staged),
        repos,
      ),
      'unstaged',
    ),
  ];
}

export const fileName = (path: string) => path.slice(path.lastIndexOf('/') + 1);
