// The history of one file: the commits that touched it, what each one changed in it, and who
// last changed a given line. Only reads git.
import type { DiffHunk } from '@shared/git';
import type { FileCommit, LineBlame } from '@shared/history';
import { UserError } from '@shared/i18n';
import { parsePatch } from '../forges/patch';
import { runGit } from './GitService';

export const LOG_LIMIT = 200;
const SHA = /^[0-9a-f]{7,64}$/i;

/** `git log --follow` of a file, newest first, at most `LOG_LIMIT`. */
export async function fileLog(root: string, file: string): Promise<FileCommit[]> {
  const result = await runGit(root, [
    'log',
    '--follow',
    `--max-count=${LOG_LIMIT}`,
    '--format=%H%x1f%an%x1f%aI%x1f%s%x1e',
    '--',
    file,
  ]);
  if (result.code !== 0) return [];
  return parseLog(result.stdout.toString('utf8'));
}

export function parseLog(output: string): FileCommit[] {
  return output
    .split('\x1e')
    .map((record) => record.trim())
    .filter(Boolean)
    .map((record) => {
      const [sha, author, date, subject] = record.split('\x1f');
      return { sha: sha!, author: author ?? '', date: date ?? '', subject: subject ?? '' };
    })
    .filter((c) => SHA.test(c.sha));
}

/** What one commit changed in the file (following a rename: the path it had then). */
export async function commitDiff(root: string, file: string, sha: string): Promise<DiffHunk[]> {
  if (!SHA.test(sha)) throw new UserError('error.history.badCommit');
  const result = await runGit(root, [
    'log',
    '--follow',
    '-p',
    '--format=',
    '-1',
    '--no-color',
    sha,
    '--',
    file,
  ]);
  if (result.code !== 0) throw new UserError('error.history.badCommit');
  return parsePatch(file, result.stdout.toString('utf8'));
}

/**
 * Who last changed a line, read against the file as it is on disk (`--contents`), so a line not
 * committed yet says so instead of pointing at an old commit.
 */
export async function blameLine(
  root: string,
  file: string,
  line: number,
  contents: string,
): Promise<LineBlame | null> {
  const result = await runGit(
    root,
    ['blame', '--porcelain', '-L', `${line},${line}`, '--contents', '-', '--', file],
    { input: contents },
  );
  if (result.code !== 0) return null;
  return parseBlame(result.stdout.toString('utf8'));
}

export function parseBlame(output: string): LineBlame | null {
  const lines = output.split('\n');
  const sha = /^([0-9a-f]{40,64}) /.exec(lines[0] ?? '')?.[1];
  if (!sha) return null;
  const field = (name: string) =>
    lines.find((l) => l.startsWith(`${name} `))?.slice(name.length + 1) ?? '';
  if (/^0+$/.test(sha)) return { uncommitted: true };
  const time = Number(field('author-time'));
  return {
    uncommitted: false,
    sha,
    author: field('author'),
    date: Number.isFinite(time) && time > 0 ? new Date(time * 1000).toISOString() : '',
    subject: field('summary'),
  };
}
