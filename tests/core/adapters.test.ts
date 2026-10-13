import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createAdapter } from '@core/agents';
import { HOOKS_PROBE_MS, NOTIFY_HOLD_MS } from '@core/agents/codexAdapter';
import { CLAUDE_CODE, CODEX, type AgentProfile } from '@core/agents/profiles';
import { SignalAggregator } from '@core/sessions/SignalAggregator';
import { STATUS_DETAIL, type HooksMode, type SessionState } from '@shared/session';

beforeEach(() => vi.useFakeTimers({ now: 1_000_000 }));
afterEach(() => vi.useRealTimers());

/** An adapter wired to an aggregator, as the SessionManager does. */
function harness(profile: AgentProfile) {
  const aggregator = new SignalAggregator({ priorities: profile.priorities });
  const states: SessionState[] = [];
  const hooks: HooksMode[] = [];
  aggregator.apply({ sessionId: 's', kind: 'started', origin: 'processo', at: Date.now() });
  const adapter = createAdapter(profile, {
    sessionId: 's',
    now: () => Date.now(),
    setHooks: (mode) => hooks.push(mode),
    emit: (signal) => {
      const next = aggregator.apply(signal);
      if (next) states.push(next.state);
    },
  });
  const hook = (source: string, payload: object) =>
    adapter.onHook({ sessionId: 's', source, payload });
  /** The spinner of a turn: the user sent a prompt first. */
  const spin = (frames: string[], ms: number) => {
    adapter.onUserInput('faça alguma coisa\r');
    spinOnly(frames, ms);
  };
  const spinOnly = (frames: string[], ms: number) => {
    for (let t = 0, i = 0; t < ms; t += 100, i++) {
      adapter.onTitle(`${frames[i % frames.length]} tarefa`);
      vi.advanceTimersByTime(100);
    }
  };
  return {
    adapter,
    aggregator,
    states,
    hooks,
    hook,
    spin,
    spinOnly,
    state: () => aggregator.status,
  };
}

describe('ClaudeAdapter', () => {
  const claude = () => {
    const h = harness(CLAUDE_CODE);
    return {
      ...h,
      hook: (payload: object) => h.hook('claude-hook', payload),
      work: (ms = 1000) => h.spin(['◐', '◑'], ms),
      idle: () => h.adapter.onTitle('✳ tarefa'),
    };
  };

  it('is ready when the first title shows the idle marker', () => {
    const c = claude();
    c.hook({ hook_event_name: 'SessionStart' });
    c.idle();
    expect(c.state()).toMatchObject({ state: 'aguardando', detail: STATUS_DETAIL.ready });
    expect(c.hooks).toEqual(['active']);
  });

  it('end of turn: Stop hook', () => {
    const c = claude();
    c.idle();
    c.work();
    c.hook({ hook_event_name: 'Stop' });
    c.idle();
    vi.advanceTimersByTime(10000);
    expect(c.states).toEqual(['aguardando', 'trabalhando', 'terminou']);
    expect(c.state()).toMatchObject({ origin: 'hook', confirmed: true });
  });

  it('permission request becomes "aguardando" at once, whichever arrives first', () => {
    for (const hookFirst of [true, false]) {
      const c = claude();
      c.idle();
      c.work();
      const permission = () => c.hook({ hook_event_name: 'PermissionRequest', tool_name: 'Bash' });
      if (hookFirst) {
        permission();
        c.idle();
      } else {
        c.idle();
        vi.advanceTimersByTime(300);
        permission();
      }
      expect(c.state()).toMatchObject({ state: 'aguardando', origin: 'hook', detail: 'Bash' });
      // The title stays on the idle marker during the prompt: it must not end the turn.
      vi.advanceTimersByTime(30000);
      expect(c.state().state).toBe('aguardando');
    }
  });

  it('after the permission is granted the spinner brings back "trabalhando"', () => {
    const c = claude();
    c.idle();
    c.work();
    c.hook({ hook_event_name: 'PermissionRequest', tool_name: 'Edit' });
    c.idle();
    vi.advanceTimersByTime(3000);
    c.work(1500);
    expect(c.state().state).toBe('trabalhando');
  });

  it('the late Notification(permission_prompt) changes nothing', () => {
    const c = claude();
    c.idle();
    c.work();
    c.hook({ hook_event_name: 'PermissionRequest', tool_name: 'Bash' });
    c.idle();
    vi.advanceTimersByTime(6000);
    c.hook({ hook_event_name: 'Notification', notification_type: 'permission_prompt' });
    expect(c.states).toEqual(['aguardando', 'trabalhando', 'aguardando']);
  });

  it('idle_prompt, 60 s after stopping, means "waiting for you"', () => {
    const c = claude();
    c.idle();
    c.work();
    c.hook({ hook_event_name: 'Stop' });
    c.idle();
    vi.advanceTimersByTime(60000);
    c.hook({ hook_event_name: 'Notification', notification_type: 'idle_prompt' });
    expect(c.state()).toMatchObject({ state: 'aguardando', origin: 'hook' });
  });

  it('unrelated notifications are ignored', () => {
    const c = claude();
    c.idle();
    c.work();
    c.hook({ hook_event_name: 'Notification', notification_type: 'auth_success' });
    expect(c.state().state).toBe('trabalhando');
  });

  it('a turn cancelled with Esc fires no hook: the title settling on idle ends it', () => {
    const c = claude();
    c.idle();
    c.work();
    c.idle();
    vi.advanceTimersByTime(CLAUDE_CODE.idleSettleMs - 100);
    expect(c.state().state).toBe('trabalhando');
    vi.advanceTimersByTime(200);
    expect(c.state()).toMatchObject({ state: 'terminou', origin: 'titulo', confirmed: true });
  });

  it('a brief idle title between two spinner runs does not end the turn', () => {
    const c = claude();
    c.idle();
    c.work(500);
    c.idle();
    vi.advanceTimersByTime(500);
    c.work(3000);
    expect(c.states).toEqual(['aguardando', 'trabalhando']);
  });

  it('ignores messages from another integration', () => {
    const c = claude();
    c.idle();
    c.work();
    c.adapter.onHook({
      sessionId: 's',
      source: 'codex-notify',
      payload: { type: 'agent-turn-complete' },
    });
    expect(c.state().state).toBe('trabalhando');
  });
});

// Input of the hidden title turn, as Codex 0.158.0 reported it through notify on 2026-10-12.
const TITLE_TURN_INPUT =
  "Generate a concise, single-line task title of at most 36 characters and under five words where possible. Start with an imperative verb. Capitalize only the first word unless the user's language, proper nouns, acronyms, or code terms require otherwise. Preserve ticket references exactly. Write in the user's language. Do not use quotes, markdown, or trailing punctuation. Do not answer the request.\n\nUser prompt:\nResponda apenas com a palavra ok. Não use nenhuma ferramenta.";

describe('CodexAdapter', () => {
  const codex = () => {
    const h = harness(CODEX);
    return {
      ...h,
      work: (ms = 1000) => h.spin(['⠋', '⠙', '⠹', '⠸'], ms),
      idle: () => h.adapter.onTitle('agent-controller'),
      actionRequired: () => {
        h.adapter.onTitle('[ ! ] Action Required');
        h.adapter.onTitle('[ . ] Action Required');
      },
      notify: (threadId: string, input = ['corrija o teste']) =>
        h.hook('codex-notify', {
          type: 'agent-turn-complete',
          'thread-id': threadId,
          'input-messages': input,
          'last-assistant-message': 'pronto',
        }),
    };
  };

  it('the loading spinner at startup is not a turn', () => {
    const c = codex();
    c.idle(); // The update or trust screen.
    c.adapter.onUserInput('\x1b'); // Esc
    c.adapter.onUserInput('3'); // A menu choice
    c.spinOnly(['⠴', '⠇', '⠏'], 1500);
    c.idle();
    vi.advanceTimersByTime(10000);
    expect(c.states).toEqual(['aguardando']);
    expect(c.hooks).toEqual([]);
    // The first real prompt is a turn.
    c.work();
    c.idle();
    vi.advanceTimersByTime(CODEX.idleSettleMs + 50);
    expect(c.states).toEqual(['aguardando', 'trabalhando', 'terminou']);
  });

  it('arrow keys and Enter on a startup menu do not count as a prompt', () => {
    const c = codex();
    c.idle();
    c.adapter.onUserInput('\x1b[B');
    c.adapter.onUserInput('\x1b[B\r');
    c.spinOnly(['⠴', '⠇'], 1000);
    c.idle();
    vi.advanceTimersByTime(5000);
    expect(c.states).toEqual(['aguardando']);
    // After loading once, Enter alone (a prompt recalled from history) does count.
    c.adapter.onUserInput('\x1b[A\r');
    c.spinOnly(['⠴', '⠇'], 1000);
    expect(c.state().state).toBe('trabalhando');
  });

  it('a pasted prompt counts', () => {
    const c = codex();
    c.idle();
    c.adapter.onUserInput('\x1b[200~corrija o teste\x1b[201~');
    c.adapter.onUserInput('\r');
    c.spinOnly(['⠴', '⠇'], 500);
    expect(c.state().state).toBe('trabalhando');
  });

  it('title alone: working, Action Required, working, stopped', () => {
    const c = codex();
    c.idle();
    c.work();
    c.actionRequired();
    expect(c.state()).toMatchObject({ state: 'aguardando', origin: 'titulo', confirmed: true });
    c.work();
    c.idle();
    vi.advanceTimersByTime(CODEX.idleSettleMs + 50);
    expect(c.states).toEqual([
      'aguardando',
      'trabalhando',
      'aguardando',
      'trabalhando',
      'terminou',
    ]);
  });

  it('notify confirms the end of the turn', () => {
    const c = codex();
    c.idle();
    c.work();
    c.idle();
    c.notify('thread-main');
    expect(c.state()).toMatchObject({ state: 'terminou', origin: 'notify' });
  });

  it('drops the false notify of the title-generation turn, about 3 s into the first prompt', () => {
    const c = codex();
    c.idle();
    c.work(3000);
    c.notify('thread-title', [TITLE_TURN_INPUT]);
    c.work(5000);
    expect(c.states).toEqual(['aguardando', 'trabalhando']);
  });

  it('drops it even when the prompt text is not recognised, because the title keeps spinning', () => {
    const c = codex();
    c.idle();
    c.work(3000);
    c.notify('thread-title', ['um prompt interno em outro formato']);
    c.work(NOTIFY_HOLD_MS + 2000);
    c.idle();
    // The real end of the turn, much later, is still reported.
    vi.advanceTimersByTime(CODEX.idleSettleMs + 50);
    expect(c.states).toEqual(['aguardando', 'trabalhando', 'terminou']);
    expect(c.state().origin).toBe('titulo');
  });

  it('the title turn is dropped even when it ends right at the end of the real turn', () => {
    const c = codex();
    c.idle();
    c.work(2000);
    c.notify('thread-title', [TITLE_TURN_INPUT]);
    c.idle();
    expect(c.state().state).toBe('trabalhando');
    c.notify('thread-main');
    expect(c.state()).toMatchObject({ state: 'terminou', origin: 'notify' });
  });

  it('a user prompt that merely talks about titles is not mistaken for it', () => {
    const c = codex();
    c.idle();
    c.work();
    c.idle();
    c.notify('thread-main', ['Generate a title for my blog post about terminals']);
    expect(c.state()).toMatchObject({ state: 'terminou', origin: 'notify' });
  });

  it('a notify that arrives just before the title stops is accepted', () => {
    const c = codex();
    c.idle();
    c.work(2000);
    c.notify('thread-main');
    vi.advanceTimersByTime(200);
    c.idle();
    expect(c.state()).toMatchObject({ state: 'terminou', origin: 'notify' });
  });

  it('once the thread is known, a notify from another thread is dropped', () => {
    const c = codex();
    c.hook('codex-hook', { hook_event_name: 'SessionStart', session_id: 'thread-main' });
    c.idle();
    c.work();
    c.idle();
    c.notify('thread-other');
    expect(c.state().state).toBe('trabalhando');
    c.notify('thread-main');
    expect(c.state().state).toBe('terminou');
  });

  it('never ends a turn that is asking for permission', () => {
    const c = codex();
    c.idle();
    c.work();
    c.actionRequired();
    c.notify('thread-main');
    vi.advanceTimersByTime(5000);
    expect(c.state().state).toBe('aguardando');
  });

  it('trusted hooks: PermissionRequest and hooks marked active', () => {
    const c = codex();
    c.hook('codex-hook', { hook_event_name: 'SessionStart', session_id: 't' });
    c.idle();
    c.work();
    c.hook('codex-hook', { hook_event_name: 'PermissionRequest', tool_name: 'shell' });
    expect(c.state()).toMatchObject({ state: 'aguardando', detail: 'shell' });
    expect(c.hooks).toEqual(['active']);
  });

  it('untrusted hooks: no SessionStart after the first prompt marks them inactive', () => {
    const c = codex();
    c.idle();
    expect(c.hooks).toEqual([]);
    c.work(HOOKS_PROBE_MS + 500);
    expect(c.hooks).toEqual(['inactive']);
    // Trusting later (next session start of the same process) flips it back.
    c.hook('codex-hook', { hook_event_name: 'SessionStart', session_id: 't' });
    expect(c.hooks).toEqual(['inactive', 'active']);
  });

  it('other notify types are ignored', () => {
    const c = codex();
    c.idle();
    c.work();
    c.idle();
    c.hook('codex-notify', { type: 'approval-requested' });
    expect(c.state().state).toBe('trabalhando');
  });
});
