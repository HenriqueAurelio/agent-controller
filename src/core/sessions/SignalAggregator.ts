import type {
  SessionState,
  SessionStatus,
  Signal,
  SignalKind,
  SignalOrigin,
} from '@shared/session';
import { initialStatus } from '@shared/session';

export type SignalPriorities = Record<SignalOrigin, number>;

export interface AggregatorOptions {
  /** Higher wins. Set per agent profile. */
  priorities: SignalPriorities;
  /**
   * For this long after a state is set, a signal from a lower-priority origin cannot change it.
   * It absorbs stale frames, such as a spinner title delivered just after the `Stop` hook.
   */
  graceMs?: number;
  /** Silence only decides the state when no confirmed signal arrived within this window. */
  confirmedRecentMs?: number;
}

const RUNNING: readonly SessionState[] = ['iniciando', 'trabalhando', 'aguardando', 'terminou'];

/** Which state a signal leads to, from each state. Missing entries mean "ignore". */
const TRANSITIONS: Record<
  Exclude<SignalKind, 'exited' | 'stopped'>,
  Partial<Record<SessionState, SessionState>>
> = {
  started: { parada: 'iniciando', terminou: 'iniciando', erro: 'iniciando' },
  working: {
    iniciando: 'trabalhando',
    trabalhando: 'trabalhando',
    aguardando: 'trabalhando',
    terminou: 'trabalhando',
  },
  waiting: {
    iniciando: 'aguardando',
    trabalhando: 'aguardando',
    aguardando: 'aguardando',
    terminou: 'aguardando',
  },
  done: { iniciando: 'terminou', trabalhando: 'terminou', aguardando: 'terminou' },
};

/**
 * Decides the state of one session from signals of several origins, which may conflict and
 * arrive out of order.
 */
export class SignalAggregator {
  private current: SessionStatus;
  private lastConfirmedAt = Number.NEGATIVE_INFINITY;
  private readonly graceMs: number;
  private readonly confirmedRecentMs: number;

  constructor(private readonly options: AggregatorOptions) {
    this.current = initialStatus();
    this.graceMs = options.graceMs ?? 300;
    this.confirmedRecentMs = options.confirmedRecentMs ?? 5000;
  }

  get status(): SessionStatus {
    return this.current;
  }

  /** Returns the new status when the signal changed something, otherwise null. */
  apply(signal: Signal): SessionStatus | null {
    const from = this.current;
    const confirmed = signal.origin !== 'silencio';

    if (signal.origin === 'processo') {
      // The process is the ground truth about being alive: these are never stale or outranked.
      const next = this.processTarget(signal, from.state);
      return next ? this.set(next, signal, true) : null;
    }

    if (signal.at < from.since) return null; // Older than what already decided the state.

    if (!confirmed) {
      if (from.state !== 'trabalhando') return null;
      if (signal.at - this.lastConfirmedAt < this.confirmedRecentMs) return null;
    } else {
      this.lastConfirmedAt = Math.max(this.lastConfirmedAt, signal.at);
    }

    const kind = signal.kind as Exclude<SignalKind, 'exited' | 'stopped'>;
    const next = TRANSITIONS[kind]?.[from.state];
    if (!next) return null;

    if (next === from.state) {
      // Same state: the only news is an inferred state being confirmed by the agent.
      return confirmed && !from.confirmed ? this.set(next, signal, true) : null;
    }

    // A state set by the process itself (started, exited) is not an opinion to be outranked.
    const outranked =
      from.origin !== 'processo' &&
      this.options.priorities[signal.origin] < this.options.priorities[from.origin] &&
      signal.at - from.since < this.graceMs;
    if (outranked) return null;

    // "Working" seen by one origin right after another origin said the agent stopped is a
    // frame that was already on its way, whatever the priorities: the hook of a permission
    // request overtakes the last spinner title.
    const staleWork =
      next === 'trabalhando' &&
      (from.state === 'aguardando' || from.state === 'terminou') &&
      from.confirmed &&
      signal.origin !== from.origin &&
      signal.at - from.since < this.graceMs;
    if (staleWork) return null;

    return this.set(next, signal, confirmed);
  }

  private processTarget(signal: Signal, from: SessionState): SessionState | null {
    switch (signal.kind) {
      case 'started':
        return TRANSITIONS.started[from] ?? null;
      case 'stopped':
        return from === 'parada' ? null : 'parada';
      case 'exited':
        if (!RUNNING.includes(from)) return null;
        return signal.exitCode === 0 ? 'terminou' : 'erro';
      default:
        return null;
    }
  }

  private set(state: SessionState, signal: Signal, confirmed: boolean): SessionStatus | null {
    const same =
      state === this.current.state &&
      confirmed === this.current.confirmed &&
      signal.origin === this.current.origin;
    if (same) return null;
    this.current = {
      state,
      origin: signal.origin,
      confirmed,
      since: Math.max(signal.at, this.current.since),
      detail: signal.detail,
    };
    if (confirmed) this.lastConfirmedAt = Math.max(this.lastConfirmedAt, signal.at);
    return this.current;
  }
}
