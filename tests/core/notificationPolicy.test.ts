import { describe, expect, it } from 'vitest';
import { NotificationPolicy } from '@core/sessions/NotificationPolicy';
import type { ChecksRun } from '@shared/checks';
import { DEFAULT_PREFERENCES, sanitizePreferences } from '@shared/prefs';
import {
  STATUS_DETAIL,
  type SessionState,
  type SessionStatus,
  type SessionView,
} from '@shared/session';

const status = (state: SessionState, extra: Partial<SessionStatus> = {}): SessionStatus => ({
  state,
  origin: 'hook',
  confirmed: true,
  since: 0,
  ...extra,
});
const session = (
  state: SessionState,
  extra: Partial<SessionStatus> = {},
  id = 's1',
): SessionView => ({
  id,
  name: 'API de pagamentos',
  cwd: '/x',
  profile: 'claude-code',
  order: 0,
  status: status(state, extra),
  running: true,
  hooks: 'active',
  unread: false,
});
const background = { focused: false, prefs: DEFAULT_PREFERENCES };

describe('NotificationPolicy', () => {
  it('notifies when the agent finishes or starts waiting, naming the session', () => {
    const policy = new NotificationPolicy();
    expect(policy.evaluate(session('terminou'), status('trabalhando'), background)).toEqual({
      sessionId: 's1',
      kind: 'done',
      title: 'API de pagamentos',
      body: 'O agente terminou.',
      silent: false,
    });
    expect(
      policy.evaluate(session('aguardando', { detail: 'Bash' }), status('trabalhando'), background),
    ).toMatchObject({ kind: 'waiting', body: 'Aguardando você: Bash' });
  });

  it('says "possivelmente" when the state was inferred from silence', () => {
    const policy = new NotificationPolicy();
    const request = policy.evaluate(
      session('aguardando', { origin: 'silencio', confirmed: false }),
      status('trabalhando'),
      background,
    );
    expect(request?.body).toBe('Possivelmente aguardando você.');
  });

  it('speaks the language of the preferences', () => {
    const english = { ...background, prefs: { ...DEFAULT_PREFERENCES, language: 'en' as const } };
    expect(
      new NotificationPolicy().evaluate(session('terminou'), status('trabalhando'), english)?.body,
    ).toBe('The agent finished.');
    expect(
      new NotificationPolicy().evaluate(
        session('aguardando', { detail: STATUS_DETAIL.idle }),
        status('trabalhando'),
        english,
      )?.body,
    ).toBe('Waiting for you: idle, waiting for you');
    expect(
      new NotificationPolicy().evaluate(
        session('aguardando', { origin: 'silencio', confirmed: false }),
        status('trabalhando'),
        english,
      )?.body,
    ).toBe('Possibly waiting for you.');
  });

  it('never notifies the session in focus', () => {
    const policy = new NotificationPolicy();
    const focused = { ...background, focused: true };
    expect(policy.evaluate(session('terminou'), status('trabalhando'), focused)).toBeNull();
  });

  it.each<[SessionState, SessionState]>([
    ['iniciando', 'aguardando'], // Ready at the prompt.
    ['terminou', 'aguardando'], // idle_prompt a minute after the end.
    ['aguardando', 'terminou'],
    ['aguardando', 'trabalhando'],
    ['trabalhando', 'erro'],
    ['trabalhando', 'parada'],
  ])('%s → %s is not news', (from, to) => {
    expect(new NotificationPolicy().evaluate(session(to), status(from), background)).toBeNull();
  });

  it('groups repeated notices of the same session', () => {
    let now = 0;
    const policy = new NotificationPolicy({ repeatWindowMs: 30000, now: () => now });
    const waiting = () => policy.evaluate(session('aguardando'), status('trabalhando'), background);
    expect(waiting()).not.toBeNull();
    now = 5000;
    expect(waiting()).toBeNull();
    // Another kind, or another session, is a different notice.
    expect(policy.evaluate(session('terminou'), status('trabalhando'), background)).not.toBeNull();
    expect(
      policy.evaluate(session('aguardando', {}, 's2'), status('trabalhando'), background),
    ).not.toBeNull();
    now = 60000;
    expect(waiting()).not.toBeNull();
  });

  it('honours the preferences per kind of notice and for sound', () => {
    const policy = new NotificationPolicy();
    const prefs = sanitizePreferences({ notifyDone: false, notifySound: false });
    expect(
      policy.evaluate(session('terminou'), status('trabalhando'), { focused: false, prefs }),
    ).toBeNull();
    expect(
      policy.evaluate(session('aguardando'), status('trabalhando'), { focused: false, prefs }),
    ).toMatchObject({ kind: 'waiting', silent: true });
  });
});

describe('NotificationPolicy for checks', () => {
  const run = (outcomes: ('passed' | 'failed')[], extra: Partial<ChecksRun> = {}): ChecksRun => ({
    trigger: 'turnEnd',
    state: 'done',
    startedAt: 0,
    checks: outcomes.map((_, i) => ({ id: `c${i}`, label: `c${i}`, command: 'x' })),
    results: outcomes.map((outcome, i) => ({
      id: `c${i}`,
      label: `c${i}`,
      command: 'x',
      outcome,
      exitCode: outcome === 'passed' ? 0 : 1,
      durationMs: 1,
      output: '',
      truncated: false,
    })),
    ...extra,
  });

  it('tells when the checks of a turn failed, and how many', () => {
    const policy = new NotificationPolicy();
    expect(
      policy.evaluateChecks(session('terminou'), run(['passed', 'failed', 'failed']), background),
    ).toEqual({
      sessionId: 's1',
      kind: 'checks',
      title: 'API de pagamentos',
      body: 'Verificações falharam: 2 de 3.',
      silent: false,
    });
  });

  it('stays quiet when they passed, ran by hand, are not over, or the session is in sight', () => {
    const policy = new NotificationPolicy();
    expect(policy.evaluateChecks(session('terminou'), run(['passed']), background)).toBeNull();
    expect(
      policy.evaluateChecks(
        session('terminou'),
        run(['failed'], { trigger: 'manual' }),
        background,
      ),
    ).toBeNull();
    expect(
      policy.evaluateChecks(session('terminou'), run(['failed'], { state: 'running' }), background),
    ).toBeNull();
    expect(
      policy.evaluateChecks(session('terminou'), run(['failed']), { ...background, focused: true }),
    ).toBeNull();
    const prefs = sanitizePreferences({ notifyDone: false });
    expect(
      policy.evaluateChecks(session('terminou'), run(['failed']), { focused: false, prefs }),
    ).toBeNull();
  });
});

describe('preferences', () => {
  it('fills in defaults and clamps out-of-range values', () => {
    expect(sanitizePreferences(undefined)).toEqual(DEFAULT_PREFERENCES);
    expect(
      sanitizePreferences({
        scrollback: 9e9,
        fontSize: 1,
        silenceSeconds: -5,
        theme: 'roxo' as never,
      }),
    ).toMatchObject({ scrollback: 20000, fontSize: 8, silenceSeconds: 0, theme: 'dark' });
  });
});
