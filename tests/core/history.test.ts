import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { blameLine, commitDiff, fileLog, parseBlame, parseLog } from '@core/git/history';
import { removeDir, tempDir } from './helpers';

const git = (cwd: string, ...args: string[]) =>
  execFileSync('git', args, { cwd, stdio: 'pipe' }).toString().trim();

describe('the history of a file', () => {
  let dir = '';
  afterEach(() => dir && removeDir(dir));

  it('lists its commits through a rename, shows what each changed, and who changed a line', async () => {
    dir = tempDir();
    git(dir, 'init', '-q');
    git(dir, 'config', 'user.email', 'ana@t');
    git(dir, 'config', 'user.name', 'Ana');
    fs.writeFileSync(path.join(dir, 'velho.ts'), 'um\ndois\n');
    git(dir, 'add', '-A');
    git(dir, 'commit', '-q', '-m', 'Começo');
    git(dir, 'mv', 'velho.ts', 'novo.ts');
    git(dir, 'commit', '-q', '-m', 'Renomeia');
    git(dir, 'config', 'user.name', 'Bruno');
    fs.writeFileSync(path.join(dir, 'novo.ts'), 'um\nDOIS\n');
    git(dir, 'commit', '-q', '-am', 'Muda a linha dois');

    const commits = await fileLog(dir, 'novo.ts');
    expect(commits.map((c) => c.subject)).toEqual(['Muda a linha dois', 'Renomeia', 'Começo']);
    expect(commits[0]!.author).toBe('Bruno');

    const hunks = await commitDiff(dir, 'novo.ts', commits[0]!.sha);
    expect(
      hunks[0]!.lines.filter((l) => l.kind !== 'ctx').map((l) => `${l.kind}:${l.text}`),
    ).toEqual(['del:dois', 'add:DOIS']);
    await expect(commitDiff(dir, 'novo.ts', 'zzz')).rejects.toThrow();

    const blamed = await blameLine(dir, 'novo.ts', 2, 'um\nDOIS\n');
    expect(blamed).toMatchObject({
      uncommitted: false,
      author: 'Bruno',
      subject: 'Muda a linha dois',
    });
    // An edit on disk not committed yet says so.
    expect(await blameLine(dir, 'novo.ts', 2, 'um\nTRÊS\n')).toEqual({ uncommitted: true });
  });

  it('reads the output of git log and git blame', () => {
    const sha = 'a'.repeat(40);
    expect(parseLog(`${sha}\x1fAna\x1f2026-11-01T10:00:00Z\x1fMensagem\x1e\n`)).toEqual([
      { sha, author: 'Ana', date: '2026-11-01T10:00:00Z', subject: 'Mensagem' },
    ]);
    expect(
      parseBlame(`${sha} 2 2 1\nauthor Ana\nauthor-time 1762000000\nsummary Mensagem\n\tlinha`),
    ).toMatchObject({ uncommitted: false, author: 'Ana', subject: 'Mensagem' });
    expect(parseBlame(`${'0'.repeat(40)} 1 1 1\nauthor Not Committed Yet\n`)).toEqual({
      uncommitted: true,
    });
    expect(parseBlame('')).toBeNull();
  });
});
