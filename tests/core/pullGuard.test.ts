import { describe, expect, it } from 'vitest';
import { PullGuard } from '@core/forges/PullGuard';
import {
  EMPTY_PULLS_STATE,
  sanitizePullsSettings,
  type PullRequestView,
  type PullsState,
} from '@shared/pulls';

const pull = (
  sha: string,
  state: 'success' | 'failure' | 'pending' = 'failure',
): PullRequestView => ({
  key: 'acme/api#7',
  forge: 'github',
  repo: 'acme/api',
  number: 7,
  title: 'Paginar',
  url: 'https://github.com/acme/api/pull/7',
  author: 'ana',
  mine: true,
  draft: false,
  branch: 'paginar',
  base: 'main',
  createdAt: '2026-11-01T00:00:00Z',
  updatedAt: '2026-11-01T00:00:00Z',
  review: null,
  reviewers: [],
  reviewRequested: false,
  comments: 0,
  lastCommentBy: null,
  pipeline: { state, sha, jobs: [] },
});

const look = (p: PullRequestView): PullsState => ({
  ...EMPTY_PULLS_STATE,
  status: 'ok',
  pulls: [p],
});

function watch(guard: PullGuard) {
  const events: string[] = [];
  guard.on('fix', (p) => events.push(`fix:${p.pipeline.sha}`));
  guard.on('gaveUp', (p) => events.push(`gaveUp:${p.pipeline.sha}`));
  return events;
}

describe('PullGuard', () => {
  it('sends each failure once, and stops after the limit', () => {
    const guard = new PullGuard(3);
    const events = watch(guard);
    guard.configure(['acme/api#7']);
    for (const sha of ['a', 'a', 'b', 'c']) {
      guard.notice({ kind: 'failed', pull: pull(sha) });
      guard.sent('acme/api#7', 'sessao');
    }
    expect(events).toEqual(['fix:a', 'fix:b', 'fix:c']);
    expect(guard.get()['acme/api#7']).toMatchObject({ attempts: 3, status: 'sent' });
    guard.notice({ kind: 'failed', pull: pull('d') });
    guard.notice({ kind: 'failed', pull: pull('e') });
    expect(events).toEqual(['fix:a', 'fix:b', 'fix:c', 'gaveUp:d']);
    expect(guard.get()['acme/api#7']!.status).toBe('gaveUp');
  });

  it('gives the attempts back when the pipeline passes', () => {
    const guard = new PullGuard(2);
    const events = watch(guard);
    guard.configure(['acme/api#7']);
    guard.notice({ kind: 'failed', pull: pull('a') });
    guard.notice({ kind: 'failed', pull: pull('b') });
    guard.update(look(pull('c', 'success')));
    expect(guard.get()['acme/api#7']).toEqual({ attempts: 0, status: 'watching' });
    guard.notice({ kind: 'failed', pull: pull('d') });
    expect(events).toEqual(['fix:a', 'fix:b', 'fix:d']);
  });

  it('does not count a failure that no session got', () => {
    const guard = new PullGuard(3);
    guard.configure(['acme/api#7']);
    guard.notice({ kind: 'failed', pull: pull('a') });
    guard.sent('acme/api#7', null);
    expect(guard.get()['acme/api#7']).toEqual({ attempts: 0, status: 'noSession' });
  });

  it('ignores what it does not guard, and acts at once on a pipeline already broken', () => {
    const guard = new PullGuard();
    const events = watch(guard);
    guard.notice({ kind: 'failed', pull: pull('a') });
    guard.notice({ kind: 'comment', pull: pull('a') });
    expect(events).toEqual([]);
    guard.configure(['acme/api#7']);
    guard.started(pull('a'));
    guard.started(pull('a', 'success'));
    expect(events).toEqual(['fix:a']);
    // Turned off and on again: the count it had is gone.
    guard.configure([]);
    expect(guard.get()).toEqual({});
  });
});

describe('the guarded list in the preferences', () => {
  it('keeps keys of pull requests only, without repetition', () => {
    const settings = sanitizePullsSettings({
      repos: ['acme/api'],
      guarded: ['acme/api#7', 'acme/api#7', 'gitlab.com/g/p!3', 'nada', 42],
    });
    expect(settings.guarded).toEqual(['acme/api#7', 'gitlab.com/g/p!3']);
    expect(sanitizePullsSettings({}).guarded).toEqual([]);
  });
});
