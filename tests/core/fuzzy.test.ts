import { describe, expect, it } from 'vitest';
import { fuzzyMatch, parseFileQuery, rankFiles } from '../../src/renderer/src/lib/fuzzy';

const FILES = [
  'src/core/sessions/SessionManager.ts',
  'src/core/sessions/SessionStore.ts',
  'src/main/ipc.ts',
  'src/shared/ipc.ts',
  'src/renderer/src/lib/pictures.ts',
  'src/core/git/GitService.ts',
  'src/shared/cgit.ts',
  'README.md',
];

const best = (query: string) => rankFiles(FILES, query, 5).map((r) => r.path);

describe('fuzzyMatch', () => {
  it('needs the letters in order, whatever the case', () => {
    expect(fuzzyMatch('rdm', 'README.md')).not.toBeNull();
    expect(fuzzyMatch('mdr', 'README.md')).toBeNull();
    expect(fuzzyMatch('xyz', 'README.md')).toBeNull();
  });

  it('everything matches an empty query', () => {
    expect(fuzzyMatch('', 'a/b.ts')).toEqual({ score: 0, positions: [] });
  });

  it('reports where the letters matched, for the highlight', () => {
    // S of "Session", e, s, M of "Manager", g, r.
    const match = fuzzyMatch('sesmgr', 'src/core/sessions/SessionManager.ts')!;
    expect(match.positions).toHaveLength(6);
    const text = 'src/core/sessions/SessionManager.ts';
    expect(match.positions.map((i) => text[i]!.toLowerCase()).join('')).toBe('sesmgr');
    // In the name of the file, not in the folders.
    expect(match.positions.every((i) => i >= text.lastIndexOf('/') + 1)).toBe(true);
  });
});

describe('rankFiles, with the cases of the editors', () => {
  it('sesmgr finds SessionManager.ts first', () => {
    expect(best('sesmgr')[0]).toBe('src/core/sessions/SessionManager.ts');
  });

  it('ipcts finds the ipc.ts files and not the files that only share the letters', () => {
    const found = best('ipcts');
    expect(found.slice(0, 2).sort()).toEqual(['src/main/ipc.ts', 'src/shared/ipc.ts']);
    expect(found).not.toContain('README.md');
  });

  it('s/c/git follows the folders', () => {
    expect(best('s/c/git')[0]).toBe('src/core/git/GitService.ts');
  });

  it('a camelCase initial beats a letter in the middle of a word', () => {
    expect(best('sm')[0]).toBe('src/core/sessions/SessionManager.ts');
  });

  it('the start of a word in snake_case counts too', () => {
    const files = ['docs/semaphore_main.md', 'docs/session_manager_notes.md', 'docs/summary.md'];
    expect(rankFiles(files, 'smn', 3)[0]!.path).toBe('docs/session_manager_notes.md');
  });

  it('a name match beats the same letters in the folders', () => {
    expect(best('git')[0]).toBe('src/core/git/GitService.ts');
    expect(best('cgit')[0]).toBe('src/shared/cgit.ts');
  });

  it('respects the limit and the order of the scores', () => {
    const ranked = rankFiles(FILES, 's', 3);
    expect(ranked).toHaveLength(3);
    expect(ranked[0]!.score).toBeGreaterThanOrEqual(ranked[2]!.score);
  });
});

describe('parseFileQuery', () => {
  it('reads name, line and column', () => {
    expect(parseFileQuery('main')).toEqual({ name: 'main' });
    expect(parseFileQuery('main.ts:42')).toEqual({ name: 'main.ts', line: 42 });
    expect(parseFileQuery('main.ts:42:7')).toEqual({ name: 'main.ts', line: 42, column: 7 });
  });

  it('drops a colon with nothing after it, and a line of zero', () => {
    expect(parseFileQuery('main:')).toEqual({ name: 'main' });
    expect(parseFileQuery('main:0')).toEqual({ name: 'main' });
  });

  it('with only a line, there is nothing to look for', () => {
    expect(parseFileQuery(':12')).toEqual({ name: '', line: 12 });
  });
});
