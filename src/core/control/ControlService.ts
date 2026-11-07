// The commands of `aurelium` turned into actions on the sessions (ADR 0034). Every argument comes
// from another process: checked here, never trusted.
import { UserError, type MessageKey } from '@shared/i18n';
import { AGENT_PROFILE_IDS, type AgentProfileId, type SessionView } from '@shared/session';
import type { SessionManager } from '../sessions/SessionManager';
import type { ControlRequest } from './protocol';

type ArgumentName = Extract<MessageKey, `arg.${string}`> extends `arg.${infer Name}` ? Name : never;

/** A session as the command line shows it. */
export interface ControlSession {
  id: string;
  name: string;
  cwd: string;
  agent: AgentProfileId;
  state: string;
  running: boolean;
  /** Texts waiting for the end of the turn. */
  pending: number;
}

export interface WaitResult {
  session: ControlSession;
  timedOut: boolean;
}

export type ControlSessions = Pick<
  SessionManager,
  'list' | 'start' | 'sendText' | 'screenText' | 'on' | 'off'
>;

export interface ControlServiceOptions {
  sessions: ControlSessions;
  /** Creates a session in a folder that exists; throws a UserError when it does not. */
  create(input: { name: string; cwd: string; profile: AgentProfileId }): Promise<SessionView>;
  now?: () => number;
  /** How often `wait` looks again; tests make it short. */
  pollMs?: number;
}

const TEXT_LIMIT = 100_000;
const DEFAULT_WAIT_S = 600;
const MAX_WAIT_S = 3600;
const DEFAULT_LINES = 40;
const MAX_LINES = 500;
/**
 * After a text is sent, how long the session counts as busy before the agent says it started:
 * without it, `wait` right after `send` would see the idle state of before the text.
 */
const START_GRACE_MS = 20_000;

const str = (value: unknown, name: ArgumentName, max = 4096): string => {
  if (typeof value !== 'string' || !value.trim() || value.length > max) {
    throw new UserError('error.invalidArgument', { name: { key: `arg.${name}` } });
  }
  return value;
};

const count = (value: unknown, fallback: number, max: number): number => {
  if (value === undefined || value === null) return fallback;
  const n = typeof value === 'string' ? Number(value) : value;
  if (typeof n !== 'number' || !Number.isFinite(n) || n <= 0) {
    throw new UserError('error.invalidArgument', { name: { key: 'arg.number' } });
  }
  return Math.min(Math.floor(n), max);
};

export function controlView(session: SessionView): ControlSession {
  return {
    id: session.id,
    name: session.name,
    cwd: session.cwd,
    agent: session.profile,
    state: session.status.state,
    running: session.running,
    pending: session.pendingSends ?? 0,
  };
}

export class ControlService {
  /** When a text last went to each session the agent has not started on yet. */
  private readonly sentAt = new Map<string, number>();
  private readonly now: () => number;

  constructor(private readonly options: ControlServiceOptions) {
    this.now = options.now ?? Date.now;
    options.sessions.on('transition', ({ session }) => {
      if (session.status.state === 'trabalhando') this.sentAt.delete(session.id);
    });
    options.sessions.on('removed', (id) => this.sentAt.delete(id));
  }

  async handle(request: ControlRequest, signal?: AbortSignal): Promise<unknown> {
    const { args } = request;
    switch (request.op) {
      case 'list':
        return this.options.sessions.list().map(controlView);
      case 'status':
        return controlView(this.find(args.session));
      case 'new':
        return this.create(args);
      case 'send':
        return this.send(this.find(args.session).id, str(args.text, 'text', TEXT_LIMIT));
      case 'wait':
        return this.wait(
          this.find(args.session).id,
          count(args.timeout, DEFAULT_WAIT_S, MAX_WAIT_S) * 1000,
          signal,
        );
      case 'read':
        return this.read(this.find(args.session).id, count(args.lines, DEFAULT_LINES, MAX_LINES));
    }
  }

  /** By id, or by a name only one session has (letter case aside). */
  private find(ref: unknown): SessionView {
    const wanted = str(ref, 'session', 200).trim();
    const all = this.options.sessions.list();
    const byId = all.find((s) => s.id === wanted);
    if (byId) return byId;
    const named = all.filter((s) => s.name.toLowerCase() === wanted.toLowerCase());
    if (named.length > 1) throw new UserError('error.control.ambiguous', { name: wanted });
    if (!named[0]) throw new UserError('error.session.notFound');
    return named[0];
  }

  private async create(args: Record<string, unknown>): Promise<ControlSession> {
    const cwd = str(args.cwd, 'folder').trim();
    const agent = args.agent ?? 'claude-code';
    if (!AGENT_PROFILE_IDS.includes(agent as AgentProfileId)) {
      throw new UserError('error.unknownProfile');
    }
    const prompt = args.prompt === undefined ? undefined : str(args.prompt, 'text', TEXT_LIMIT);
    const name =
      args.name === undefined
        ? (cwd.split(/[\\/]/).filter(Boolean).pop() ?? cwd)
        : str(args.name, 'name', 200).trim();
    const created = await this.options.create({ name, cwd, profile: agent as AgentProfileId });
    this.options.sessions.start(created.id);
    // The agent is starting: the text waits for it to be ready, like any text sent mid-turn.
    if (prompt) this.send(created.id, prompt);
    return controlView(this.view(created.id));
  }

  private send(id: string, text: string): { outcome: string; session: ControlSession } {
    if (!this.view(id).running) this.options.sessions.start(id);
    const outcome = this.options.sessions.sendText(id, text, { submit: true, now: false });
    this.sentAt.set(id, this.now());
    return { outcome, session: controlView(this.view(id)) };
  }

  /** Whether the agent is done with what it was given: idle, finished, or no longer running. */
  settled(session: SessionView): boolean {
    if (!session.running) return true;
    if ((session.pendingSends ?? 0) > 0) return false;
    const sent = this.sentAt.get(session.id);
    if (sent !== undefined && this.now() - sent < START_GRACE_MS) return false;
    const { state, confirmed } = session.status;
    if (state === 'terminou' || state === 'erro' || state === 'parada') return true;
    return state === 'aguardando' && confirmed;
  }

  private wait(id: string, timeoutMs: number, signal?: AbortSignal): Promise<WaitResult> {
    const deadline = this.now() + timeoutMs;
    return new Promise((resolve, reject) => {
      const check = () => {
        const session = this.options.sessions.list().find((s) => s.id === id);
        if (!session) {
          stop();
          reject(new UserError('error.session.notFound'));
          return;
        }
        const settled = this.settled(session);
        if (settled || this.now() >= deadline || signal?.aborted) {
          stop();
          resolve({ session: controlView(session), timedOut: !settled });
        }
      };
      const timer = setInterval(check, this.options.pollMs ?? 300);
      const stop = () => {
        clearInterval(timer);
        signal?.removeEventListener('abort', check);
      };
      signal?.addEventListener('abort', check);
      check();
    });
  }

  private async read(id: string, lines: number): Promise<{ text: string }> {
    const screen = await this.options.sessions.screenText(id);
    const all = screen.replace(/\s+$/, '').split(/\r?\n/);
    return { text: all.slice(-lines).join('\n') };
  }

  private view(id: string): SessionView {
    const session = this.options.sessions.list().find((s) => s.id === id);
    if (!session) throw new UserError('error.session.notFound');
    return session;
  }
}
