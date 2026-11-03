import { describe, expect, it } from 'vitest';
import { GitHubClient, parsePullFiles, parsePullThreads } from '@core/forges/github';
import {
  GitLabClient,
  parseDiscussions,
  parseMergeRequestDiffs,
  type GitLabTransport,
} from '@core/forges/gitlab';
import { parsePatch } from '@core/forges/patch';

const PATCH = [
  '@@ -1,4 +1,5 @@',
  ' a',
  '-b',
  '+B',
  '+novo',
  ' c',
  ' d',
  '@@ -20,2 +21,2 @@ function f() {',
  ' x',
  '-y',
  '+Y',
  '\\ No newline at end of file',
].join('\n');

describe('parsePatch', () => {
  it('reads the blocks with the line of each side', () => {
    const hunks = parsePatch('a.ts', PATCH);
    expect(hunks).toHaveLength(2);
    expect(hunks[0]).toMatchObject({ oldStart: 1, oldLines: 4, newStart: 1, newLines: 5 });
    expect(hunks[0]!.lines).toEqual([
      { kind: 'ctx', text: 'a', oldNo: 1, newNo: 1 },
      { kind: 'del', text: 'b', oldNo: 2 },
      { kind: 'add', text: 'B', newNo: 2 },
      { kind: 'add', text: 'novo', newNo: 3 },
      { kind: 'ctx', text: 'c', oldNo: 3, newNo: 4 },
      { kind: 'ctx', text: 'd', oldNo: 4, newNo: 5 },
    ]);
    expect(hunks[1]!.lines.map((l) => `${l.kind}${l.oldNo ?? ''}/${l.newNo ?? ''}`)).toEqual([
      'ctx20/21',
      'del21/',
      'add/22',
    ]);
  });

  it('takes a block header without counts, and CRLF', () => {
    const [hunk] = parsePatch('a.ts', '@@ -3 +3 @@\r\n-x\r\n+y\r\n');
    expect(hunk).toMatchObject({ oldLines: 1, newLines: 1 });
    expect(hunk!.lines.map((l) => l.text)).toEqual(['x', 'y']);
  });
});

describe('reading a pull request of GitHub', () => {
  it('turns the files and the review comments into the review', () => {
    const files = parsePullFiles([
      { filename: 'src/a.ts', status: 'modified', patch: PATCH },
      { filename: 'img.png', status: 'added' },
      { filename: 'novo.ts', previous_filename: 'velho.ts', status: 'renamed', patch: '' },
    ]);
    expect(files.map((f) => [f.path, f.status, f.hunks.length, f.noPatch === true])).toEqual([
      ['src/a.ts', 'modified', 2, false],
      ['img.png', 'added', 0, true],
      ['novo.ts', 'renamed', 0, true],
    ]);
    expect(files[2]!.oldPath).toBe('velho.ts');

    const threads = parsePullThreads([
      {
        id: 1,
        path: 'src/a.ts',
        line: 3,
        side: 'RIGHT',
        body: 'Por quê?',
        user: { login: 'bruno' },
      },
      {
        id: 2,
        in_reply_to_id: 1,
        path: 'src/a.ts',
        line: 3,
        body: 'Porque sim.',
        user: { login: 'ana' },
      },
      {
        id: 3,
        path: 'src/a.ts',
        line: null,
        original_line: 9,
        body: 'Velho',
        user: { login: 'c' },
      },
      { id: 4, path: 'src/a.ts', line: 2, side: 'LEFT', body: 'Removida', user: { login: 'c' } },
    ]);
    expect(threads).toHaveLength(3);
    expect(threads[0]).toMatchObject({ path: 'src/a.ts', line: 3, resolved: false });
    expect(threads[0]!.comments.map((c) => c.author)).toEqual(['bruno', 'ana']);
    expect(threads[1]!.line).toBeNull();
    expect(threads[2]!.oldSide).toBe(true);
  });

  it('publishes one review against the commit read, merges and deletes the branch', async () => {
    const calls: { method: string; url: string; body: unknown }[] = [];
    const fetch = async (url: string, init: RequestInit = {}) => {
      calls.push({
        method: init.method ?? 'GET',
        url,
        body: init.body ? JSON.parse(init.body as string) : null,
      });
      if (url.endsWith('/pulls/7')) {
        return new Response(
          JSON.stringify({
            title: 'Paginar',
            html_url: 'https://github.com/acme/api/pull/7',
            user: { login: 'bruno' },
            head: { ref: 'paginar', sha: 'abc' },
            base: { ref: 'main' },
            mergeable_state: 'clean',
            changed_files: 1,
          }),
        );
      }
      if (url.includes('/files')) {
        return new Response(
          JSON.stringify([{ filename: 'a.ts', status: 'modified', patch: PATCH }]),
        );
      }
      if (url.includes('/comments')) return new Response('[]');
      if (url.endsWith('/merge') && init.method === 'PUT') {
        return new Response(JSON.stringify({ merged: true }));
      }
      if (url.endsWith('/reviews')) return new Response('{}');
      return new Response('', { status: 204 });
    };
    const client = new GitHubClient({ token: 't', fetch: fetch as typeof globalThis.fetch });
    const review = await client.review('acme/api', 7);
    expect(review).toMatchObject({ headSha: 'abc', merge: 'ready', branch: 'paginar' });
    expect(review.files[0]!.hunks).toHaveLength(2);

    await client.submitReview('acme/api', 7, {
      verdict: 'REQUEST_CHANGES',
      body: 'Veja os comentários.',
      headSha: 'abc',
      comments: [
        { path: 'a.ts', line: 3, body: 'Isto não.' },
        { path: 'a.ts', line: 2, oldSide: true, body: 'Volte esta.' },
      ],
    });
    const posted = calls.find((c) => c.url.endsWith('/reviews'))!;
    expect(posted.method).toBe('POST');
    expect(posted.body).toEqual({
      commit_id: 'abc',
      event: 'REQUEST_CHANGES',
      body: 'Veja os comentários.',
      comments: [
        { path: 'a.ts', line: 3, side: 'RIGHT', body: 'Isto não.' },
        { path: 'a.ts', line: 2, side: 'LEFT', body: 'Volte esta.' },
      ],
    });

    await client.merge('acme/api', 7, 'paginar', { squash: true, deleteBranch: true });
    expect(calls.find((c) => c.url.endsWith('/merge'))!.body).toEqual({ merge_method: 'squash' });
    expect(calls.at(-1)).toMatchObject({ method: 'DELETE' });
    expect(calls.at(-1)!.url).toMatch(/\/git\/refs\/heads\/paginar$/);
  });

  it('says what GitHub refused', async () => {
    const fetch = async () =>
      new Response(
        JSON.stringify({
          message: 'Unprocessable Entity',
          errors: ['Can not approve your own pull request'],
        }),
        { status: 422 },
      );
    const client = new GitHubClient({ token: 't', fetch: fetch as typeof globalThis.fetch });
    await expect(
      client.submitReview('acme/api', 7, {
        verdict: 'APPROVE',
        body: '',
        comments: [],
        headSha: 'x',
      }),
    ).rejects.toThrow('GitHub 422: Unprocessable Entity: Can not approve your own pull request');
  });
});

class WritingTransport implements GitLabTransport {
  sent: { method: string; path: string; body: Record<string, unknown> }[] = [];
  constructor(private readonly answers: Record<string, unknown>) {}
  async graphql(): Promise<unknown> {
    return {};
  }
  async rest(_host: string, path: string) {
    const key = Object.keys(this.answers).find((k) => path.startsWith(k));
    if (!key) throw new Error(`no answer for ${path}`);
    const answer = this.answers[key];
    return JSON.stringify(Array.isArray(answer) && path.includes('page=2') ? [] : answer);
  }
  async defaultHost() {
    return 'gitlab.com';
  }
  async send(_host: string, method: 'POST' | 'PUT', path: string, body: Record<string, unknown>) {
    this.sent.push({ method, path, body });
    return '{}';
  }
}

describe('reviewing a merge request of GitLab', () => {
  const MR = 'projects/acme%2Fweb/merge_requests/3';

  it('reads the changes and the discussions, without the notes of the system', () => {
    const files = parseMergeRequestDiffs([
      { old_path: 'a.ts', new_path: 'a.ts', diff: PATCH },
      { old_path: 'v.ts', new_path: 'n.ts', renamed_file: true, diff: '' },
      { old_path: 'x.ts', new_path: 'x.ts', deleted_file: true, diff: '@@ -1 +0,0 @@\n-x\n' },
    ]);
    expect(files.map((f) => f.status)).toEqual(['modified', 'renamed', 'removed']);
    expect(files[1]).toMatchObject({ oldPath: 'v.ts', noPatch: true });

    const threads = parseDiscussions([
      { id: 'd1', notes: [{ system: true, body: 'added 1 commit' }] },
      {
        id: 'd2',
        notes: [
          {
            body: 'Aqui',
            author: { username: 'bruno' },
            position: { new_path: 'a.ts', new_line: 3 },
            resolvable: true,
            resolved: true,
          },
        ],
      },
      {
        id: 'd3',
        notes: [{ body: 'Geral', author: { username: 'ana' }, resolvable: false }],
      },
    ]);
    expect(threads.map((t) => [t.id, t.path, t.line, t.resolved])).toEqual([
      ['d2', 'a.ts', 3, true],
      ['d3', null, null, false],
    ]);
  });

  it('comments on lines with the refs of the diff, approves and merges', async () => {
    const transport = new WritingTransport({
      [`${MR}/diffs`]: [{ old_path: 'a.ts', new_path: 'a.ts', diff: PATCH }],
      [`${MR}/discussions`]: [],
      [MR]: {
        title: 'Estoque',
        web_url: 'https://gitlab.com/acme/web/-/merge_requests/3',
        author: { username: 'bruno' },
        source_branch: 'estoque',
        target_branch: 'main',
        sha: 'h1',
        detailed_merge_status: 'mergeable',
        diff_refs: { base_sha: 'b0', start_sha: 's0', head_sha: 'h1' },
      },
    });
    const client = new GitLabClient(transport);
    const review = await client.review('gitlab.com/acme/web', 3);
    expect(review).toMatchObject({ headSha: 'h1', merge: 'ready', branch: 'estoque' });
    expect(review.files[0]!.hunks).toHaveLength(2);

    await client.submitReview('gitlab.com/acme/web', 3, {
      verdict: 'APPROVE',
      body: 'Bom.',
      headSha: 'h1',
      comments: [{ path: 'a.ts', line: 2, oldSide: true, body: 'Esta saiu?' }],
    });
    expect(transport.sent.map((s) => `${s.method} ${s.path.replace(MR, 'MR')}`)).toEqual([
      'POST MR/discussions',
      'POST MR/notes',
      'POST MR/approve',
    ]);
    expect(transport.sent[0]!.body.position).toEqual({
      position_type: 'text',
      base_sha: 'b0',
      start_sha: 's0',
      head_sha: 'h1',
      new_path: 'a.ts',
      old_path: 'a.ts',
      old_line: 2,
    });

    await client.merge('gitlab.com/acme/web', 3, 'estoque', { squash: true, deleteBranch: true });
    expect(transport.sent.at(-1)).toEqual({
      method: 'PUT',
      path: `${MR}/merge`,
      body: { squash: true, should_remove_source_branch: true },
    });
  });

  it('refuses to comment on a merge request that moved since it was read', async () => {
    const transport = new WritingTransport({ [MR]: { sha: 'novo', diff_refs: {} } });
    await expect(
      new GitLabClient(transport).submitReview('gitlab.com/acme/web', 3, {
        verdict: 'COMMENT',
        body: '',
        headSha: 'velho',
        comments: [{ path: 'a.ts', line: 1, body: 'x' }],
      }),
    ).rejects.toThrow(/moved/);
    expect(transport.sent).toEqual([]);
  });
});
