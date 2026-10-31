import type { HookMessage } from '../signals/HookServer';
import type { TitleActivity } from '../signals/title';
import { asRecord, BaseAdapter } from './adapter';
import { CODEX_HOOK_SOURCE, CODEX_NOTIFY_SOURCE } from './commandLine';
import { codexUsageReader, findCodexRollout, type UsageReader } from './usage';

/** After the first prompt, how long to wait for `SessionStart` before calling the hooks off. */
export const HOOKS_PROBE_MS = 4000;
/** A `notify` that arrives while the title still spins waits this long for the title to stop. */
export const NOTIFY_HOLD_MS = 1500;

// Codex runs a hidden turn that names the conversation, and reports it through `notify` as if
// it were the user's turn. Its input is this instruction followed by the user's own prompt
// (recorded with Codex 0.158.0). The match is strict on purpose: a user may well ask the agent
// to "generate a title".
const INTERNAL_PROMPT = /^Generate a concise, single-line task title\b[\s\S]*\n\s*User prompt:/;

function inputMessages(payload: Record<string, unknown>): string[] {
  const value = payload['input-messages'] ?? payload.input_messages;
  return Array.isArray(value) ? value.map((v) => String(v)) : [];
}

/**
 * Codex: the window title carries the three states with no setup. `notify` confirms the end of
 * a turn, after filtering the false one from the title-generation turn. Hooks are optional and
 * only run once the user trusted them in Codex's own "Hooks need review" screen.
 */
export class CodexAdapter extends BaseAdapter {
  private threadId: string | null = null;
  private pendingNotify: ReturnType<typeof setTimeout> | null = null;
  private hooksProbe: ReturnType<typeof setTimeout> | null = null;
  private prompted = false;

  protected override onWorking(_previous: TitleActivity | null): void {
    if (this.prompted) return;
    this.prompted = true;
    if (this.hooks !== 'unknown') return;
    // Untrusted hooks fail silently, so their absence is the only evidence.
    this.hooksProbe = setTimeout(() => {
      this.hooksProbe = null;
      if (this.hooks === 'unknown') this.markHooks('inactive');
    }, HOOKS_PROBE_MS);
  }

  protected override onIdleAfterActivity(): boolean {
    const pending = this.pendingNotify;
    if (!pending) return false;
    clearTimeout(pending);
    this.pendingNotify = null;
    this.acceptNotify();
    return true;
  }

  private acceptNotify(): void {
    this.resolved();
    this.emit('done', 'notify');
  }

  onHook(message: HookMessage): void {
    const payload = asRecord(message.payload);
    if (message.source === CODEX_NOTIFY_SOURCE) {
      this.onNotify(payload);
      return;
    }
    if (message.source !== CODEX_HOOK_SOURCE) return;

    this.markHooks('active');
    if (this.hooksProbe) clearTimeout(this.hooksProbe);
    this.hooksProbe = null;
    this.reportTranscript(payload.transcript_path);

    switch (payload.hook_event_name) {
      case 'SessionStart':
        if (typeof payload.session_id === 'string') {
          this.threadId = payload.session_id;
          this.locate(payload.session_id);
        }
        break;
      case 'PermissionRequest':
        this.permissionRequest(payload);
        break;
      case 'Stop':
        this.arm();
        this.resolved();
        this.emit('done', 'hook');
        break;
      default:
        break;
    }
  }

  private onNotify(payload: Record<string, unknown>): void {
    if (payload.type !== 'agent-turn-complete') return;
    const threadId = typeof payload['thread-id'] === 'string' ? payload['thread-id'] : null;

    // The false positive: another thread, or the internal prompt that asks for a title. The
    // thread is only known when trusted hooks reported it; guessing it from a notify could
    // lock onto the wrong one.
    if (this.threadId && threadId && threadId !== this.threadId) return;
    if (inputMessages(payload).some((m) => INTERNAL_PROMPT.test(m))) return;
    // Without trusted hooks, a real turn's notify is the only place the thread shows up.
    if (threadId) this.locate(threadId);

    if (this.activity === 'waiting') return; // A turn asking for permission is not complete.
    if (this.activity === 'working') {
      // The title says the agent is still going. Believe the notify only if the title agrees
      // shortly after; the title-generation turn ends while the real one keeps spinning.
      if (this.pendingNotify) clearTimeout(this.pendingNotify);
      this.pendingNotify = setTimeout(() => (this.pendingNotify = null), NOTIFY_HOLD_MS);
      return;
    }
    this.acceptNotify();
  }

  usageReader(): UsageReader {
    return codexUsageReader();
  }

  /** Finds the rollout file of a thread, unless a hook already named the conversation file. */
  private locate(threadId: string): void {
    if (this.knowsTranscript) return;
    void findCodexRollout(threadId).then((file) => {
      if (file) this.reportTranscript(file);
    });
  }

  override dispose(): void {
    super.dispose();
    if (this.hooksProbe) clearTimeout(this.hooksProbe);
    if (this.pendingNotify) clearTimeout(this.pendingNotify);
    this.hooksProbe = null;
    this.pendingNotify = null;
  }
}
