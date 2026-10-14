import {
  STATUS_DETAIL,
  type HooksMode,
  type Signal,
  type SignalKind,
  type SignalOrigin,
} from '@shared/session';
import type { HookMessage } from '../signals/HookServer';
import { classifyTitle, type TitleActivity } from '../signals/title';
import type { AgentProfile } from './profiles';

export interface AdapterHost {
  sessionId: string;
  emit(signal: Signal): void;
  setHooks(mode: HooksMode): void;
  now(): number;
}

/** Translates what one agent emits (title, hooks, notify) into session signals. */
export interface AgentAdapter {
  onTitle(title: string): void;
  onHook(message: HookMessage): void;
  /** What the user typed into the terminal. */
  onUserInput(data: string): void;
  dispose(): void;
}

// CSI, SS3 and two-character escape sequences, as terminals send them for keys and pastes.
// eslint-disable-next-line no-control-regex
const ESCAPE_SEQUENCE = /\x1b\[[0-9;?]*[ -/]*[@-~]|\x1bO.|\x1b./g;

export function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' ? (value as Record<string, unknown>) : {};
}

/**
 * What the two adapters share: reading the title by the profile's rules, the "ready" signal on
 * the first idle title, and treating a title that settles on idle after working as the end of
 * the turn (how a cancelled turn, which fires no hook, is noticed).
 */
export abstract class BaseAdapter implements AgentAdapter {
  protected activity: TitleActivity | null = null;
  protected hooks: HooksMode = 'unknown';
  private readyEmitted = false;
  /**
   * Whether a turn can be under way. Codex spins its title for a second or two while it loads,
   * which looks exactly like a turn; until the user sends something, a spinner is just startup.
   */
  private armed = false;
  private typedSinceEnter = 0;
  private startupCycles = 0;
  private resolvedAt = Number.NEGATIVE_INFINITY;
  private idleTimer: ReturnType<typeof setTimeout> | null = null;

  constructor(
    protected readonly profile: AgentProfile,
    protected readonly host: AdapterHost,
  ) {}

  protected emit(kind: SignalKind, origin: SignalOrigin, detail?: string): void {
    this.host.emit({ sessionId: this.host.sessionId, kind, origin, at: this.host.now(), detail });
  }

  protected markHooks(mode: HooksMode): void {
    if (this.hooks === mode) return;
    this.hooks = mode;
    this.host.setHooks(mode);
  }

  protected cancelIdleTimer(): void {
    if (this.idleTimer) clearTimeout(this.idleTimer);
    this.idleTimer = null;
  }

  /**
   * The agent itself said how the turn stands (hook, notify). The title going idle around this
   * moment is the same event seen twice, whichever of the two arrives first.
   */
  protected resolved(): void {
    this.resolvedAt = this.host.now();
    this.cancelIdleTimer();
  }

  /** A hook or a notify about a turn proves that one exists. */
  protected arm(): void {
    this.armed = true;
  }

  onUserInput(data: string): void {
    if (this.armed) return;
    // Arrow keys and other escape sequences answer menus; they are not text.
    const text = data.replace(ESCAPE_SEQUENCE, '');
    for (const ch of text) {
      if (ch === '\r' || ch === '\n') {
        // A typed prompt, or Enter at a prompt that already finished loading once.
        const atPrompt = this.startupCycles > 0 && this.activity !== 'working';
        if (this.typedSinceEnter >= 2 || atPrompt) this.armed = true;
        this.typedSinceEnter = 0;
      } else if (ch >= ' ' && ch !== '\x7f') {
        this.typedSinceEnter++;
      }
    }
  }

  onTitle(title: string): void {
    const previous = this.activity;
    const activity = classifyTitle(this.profile.signals.title, title);
    this.activity = activity;

    if (!this.armed && activity !== 'waiting') {
      if (activity === 'idle') {
        if (previous === 'working') this.startupCycles++;
        if (!this.readyEmitted) {
          // The agent opened and is at its prompt (or at a trust question): it is your turn.
          this.readyEmitted = true;
          this.emit('waiting', 'titulo', STATUS_DETAIL.ready);
        }
      }
      return;
    }

    if (activity === 'working') {
      this.cancelIdleTimer();
      this.readyEmitted = true;
      this.emit('working', 'titulo');
      this.onWorking(previous);
      return;
    }
    if (activity === 'waiting') {
      this.cancelIdleTimer();
      this.armed = true;
      this.readyEmitted = true;
      this.emit('waiting', 'titulo');
      return;
    }
    // Idle.
    if (previous === 'working' || previous === 'waiting') {
      if (this.onIdleAfterActivity()) return;
      this.cancelIdleTimer();
      if (this.host.now() - this.resolvedAt < this.profile.idleSettleMs) return;
      this.idleTimer = setTimeout(() => {
        this.idleTimer = null;
        this.emit('done', 'titulo', STATUS_DETAIL.unconfirmed);
      }, this.profile.idleSettleMs);
    } else if (!this.readyEmitted) {
      this.readyEmitted = true;
      this.emit('waiting', 'titulo', STATUS_DETAIL.ready);
    }
  }

  /** Hook for subclasses; `previous` is the activity before this title. */
  protected onWorking(_previous: TitleActivity | null): void {}

  /** Return true when the subclass already resolved the end of the turn. */
  protected onIdleAfterActivity(): boolean {
    return false;
  }

  abstract onHook(message: HookMessage): void;

  dispose(): void {
    this.cancelIdleTimer();
  }
}
