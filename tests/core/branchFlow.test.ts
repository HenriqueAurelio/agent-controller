import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { branchState, pushBranch, updateFromBase } from '@core/git/BranchFlow';
import { GitHubClient } from '@core/forges/github';
import { GitLabClient, type GitLabTransport } from '@core/forges/gitlab';
import { pullBody } from '@shared/branch';
import { removeDir, tempDir } from './helpers';

const git = (cwd: string, ...args: string[]) =>
  execFileSync('git', args, { cwd, stdio: 'pipe' }).toString().trim();

/** A repository with a remote of its own (a bare one), and a copy of it on a branch. */
function setup(dir: string) {
  const remote = path.join(dir, 'remote.git');
  const repo = path.join(dir, 'repo');
  const copy = path.join(dir, 'copia');
  fs.mkdirSync(repo);
  git(dir, 'init', '-q', '--bare', remote);
  git(repo, 'init', '-q', '-b', 'main');
  git(repo, 'config', 'user.email', 't@t');
  git(repo, 'config', 'user.name', 't');
  fs.writeFileSync(path.join(repo, 'a.txt'), 'um\ndois\ntrês\n');
  git(repo, 'add', '-A');
  git(repo, 'commit', '-q', '-m', 'base');
  git(repo, 'remote', 'add', 'origin', remote);
  git(repo, 'push', '-q', 'origin', 'main');
  git(repo, 'worktree', 'add', '-q', '-b', 'ac/12-login', copy, 'main');
  return { remote, repo, copy };
}

describe('the branch of a copy', () => {
  let dir = '';
  afterEach(() => dir && removeDir(dir));

  it('says how it stands, and pushes only itself to its remote', async () => {
    dir = tempDir();
    const { remote, copy } = setup(dir);
    fs.writeFileSync(path.join(copy, 'b.txt'), 'novo\n');
    git(copy, 'add', '-A');
    git(copy, 'commit', '-q', '-m', 'Arruma o login');
    fs.writeFileSync(path.join(copy, 'solto.txt'), 'sem commit\n');

    const state = await branchState(copy, 'main');
    expect(state).toMatchObject({
      branch: 'ac/12-login',
      remote: 'origin',
      ahead: 1,
      subjects: ['Arruma o login'],
      dirty: 1,
    });
    expect(path.resolve(state.remoteUrl!)).toBe(path.resolve(remote));

    await pushBranch(copy, 'origin', 'ac/12-login');
    expect(git(remote, 'branch', '--list', 'ac/*')).toContain('ac/12-login');
    expect(git(copy, 'rev-parse', '--abbrev-ref', '@{u}')).toBe('origin/ac/12-login');
    await expect(pushBranch(copy, '--force', 'ac/12-login')).rejects.toThrow();
  });

  it('brings the base in with a merge, and leaves a conflict in the copy', async () => {
    dir = tempDir();
    const { repo, copy } = setup(dir);
    expect((await updateFromBase(copy, 'main', 'origin')).status).toBe('current');

    // The base moves on the remote: a line the copy does not touch.
    fs.writeFileSync(path.join(repo, 'a.txt'), 'um\ndois\ntrês\nquatro\n');
    git(repo, 'commit', '-q', '-am', 'quatro');
    git(repo, 'push', '-q', 'origin', 'main');
    git(copy, 'fetch', '-q', 'origin');
    expect((await branchState(copy, 'main')).behind).toBe(1);
    const merged = await updateFromBase(copy, 'main', 'origin');
    expect(merged).toEqual({ status: 'merged', from: 'origin/main', conflicts: [] });
    expect(fs.readFileSync(path.join(copy, 'a.txt'), 'utf8')).toContain('quatro');
    expect((await branchState(copy, 'main')).behind).toBe(0);

    // Both change the same line: the merge stops, and the conflict stays for the agent.
    fs.writeFileSync(path.join(copy, 'a.txt'), 'UM\ndois\ntrês\nquatro\n');
    git(copy, 'commit', '-q', '-am', 'maiúscula');
    fs.writeFileSync(path.join(repo, 'a.txt'), 'Um!\ndois\ntrês\nquatro\n');
    git(repo, 'commit', '-q', '-am', 'exclamação');
    git(repo, 'push', '-q', 'origin', 'main');
    const conflict = await updateFromBase(copy, 'main', 'origin');
    expect(conflict).toEqual({ status: 'conflict', from: 'origin/main', conflicts: ['a.txt'] });
    expect(fs.readFileSync(path.join(copy, 'a.txt'), 'utf8')).toContain('<<<<<<<');
  });

  it('refuses to bring the base into a copy with uncommitted changes', async () => {
    dir = tempDir();
    const { copy } = setup(dir);
    fs.writeFileSync(path.join(copy, 'a.txt'), 'mudado\n');
    await expect(updateFromBase(copy, 'main', 'origin')).rejects.toThrow();
  });
});

describe('the pull request of the copy', () => {
  it('starts with the commits and closes the issue of the card', () => {
    expect(pullBody(['Arruma o login', 'Testes'], { ref: '#12', url: 'u' })).toBe(
      '- Arruma o login\n- Testes\n\nCloses #12',
    );
    expect(pullBody([], null)).toBe('');
  });

  it('is opened on GitHub from the pushed branch', async () => {
    let sent: unknown = null;
    const fetch = async (_url: string, init: RequestInit = {}) => {
      sent = JSON.parse(init.body as string);
      return new Response(
        JSON.stringify({ number: 31, html_url: 'https://github.com/a/b/pull/31' }),
      );
    };
    const client = new GitHubClient({ token: 't', fetch: fetch as typeof globalThis.fetch });
    const opened = await client.createPull('a/b', {
      title: 'Login',
      body: 'Closes #12',
      head: 'ac/12-login',
      base: 'main',
      draft: true,
    });
    expect(opened).toEqual({ number: 31, url: 'https://github.com/a/b/pull/31' });
    expect(sent).toEqual({
      title: 'Login',
      body: 'Closes #12',
      head: 'ac/12-login',
      base: 'main',
      draft: true,
    });
  });

  it('is opened on GitLab as a draft by the title', async () => {
    const sent: Record<string, unknown>[] = [];
    const transport: GitLabTransport = {
      graphql: async () => ({}),
      rest: async () => '{}',
      defaultHost: async () => 'gitlab.com',
      send: async (_h, _m, _p, body) => {
        sent.push(body);
        return JSON.stringify({ iid: 7, web_url: 'https://gitlab.com/g/p/-/merge_requests/7' });
      },
    };
    const opened = await new GitLabClient(transport).createPull('gitlab.com/g/p', {
      title: 'Login',
      body: '',
      head: 'ac/login',
      base: 'main',
      draft: true,
    });
    expect(opened.number).toBe(7);
    expect(sent[0]).toMatchObject({
      source_branch: 'ac/login',
      target_branch: 'main',
      title: 'Draft: Login',
    });
  });
});
