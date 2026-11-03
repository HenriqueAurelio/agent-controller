import { describe, expect, it } from 'vitest';
import { parseIssues } from '@core/forges/github';
import { parseGitLabIssues } from '@core/forges/gitlab';
import { draftFromIssue, taskBranch } from '@shared/tasks';

describe('issues of the services', () => {
  it('leaves the pull requests out of the issues of GitHub', () => {
    const issues = parseIssues([
      {
        number: 12,
        title: 'Login quebra',
        body: 'Ao entrar…',
        html_url: 'https://github.com/acme/api/issues/12',
        user: { login: 'ana' },
        labels: [{ name: 'bug' }],
      },
      { number: 13, title: 'Um PR', pull_request: { url: 'x' } },
    ]);
    expect(issues).toEqual([
      {
        number: 12,
        title: 'Login quebra',
        body: 'Ao entrar…',
        url: 'https://github.com/acme/api/issues/12',
        author: 'ana',
        labels: ['bug'],
      },
    ]);
  });

  it('reads the issues of GitLab by their number in the project', () => {
    expect(
      parseGitLabIssues([
        {
          iid: 4,
          id: 9999,
          title: 'Estoque negativo',
          description: null,
          web_url: 'https://gitlab.com/acme/web/-/issues/4',
          author: { username: 'bruno' },
          labels: ['bug', 'p1'],
        },
      ]),
    ).toEqual([
      {
        number: 4,
        title: 'Estoque negativo',
        body: '',
        url: 'https://gitlab.com/acme/web/-/issues/4',
        author: 'bruno',
        labels: ['bug', 'p1'],
      },
    ]);
  });
});

describe('a card from an issue', () => {
  it('has the number in the title and the branch, and the text and link in the prompt', () => {
    const draft = draftFromIssue({
      number: 12,
      title: 'Login quebra no Safari',
      body: '  Passos: …  ',
      url: 'https://github.com/acme/api/issues/12',
    });
    expect(draft).toEqual({
      title: '#12 Login quebra no Safari',
      description: 'Passos: …\n\nhttps://github.com/acme/api/issues/12',
      issue: { ref: '#12', url: 'https://github.com/acme/api/issues/12' },
    });
    expect(taskBranch(draft.title)).toBe('ac/12-login-quebra-no-safari');
    expect(draftFromIssue({ number: 1, title: 't', body: '', url: 'u' }).description).toBe('u');
  });
});
