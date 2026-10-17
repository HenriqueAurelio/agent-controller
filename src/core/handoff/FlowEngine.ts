import { randomUUID } from 'node:crypto';
import { EventEmitter } from 'node:events';
import {
  FLOW_HISTORY_LIMIT,
  FLOW_PENDING_LIMIT,
  closesCycle,
  parseFlowRules,
  type FlowHistoryEntry,
  type FlowMark,
  type FlowPending,
  type FlowRule,
  type FlowState,
  type FlowStopReason,
  type FlowWhen,
} from '@shared/flows';
import { UserError } from '@shared/i18n';
import type { Session } from '@shared/session';
import type { CheckpointService } from '../git/CheckpointService';
import type { PromptQueue } from '../prompts/PromptQueue';
import type { SessionManager } from '../sessions/SessionManager';
import type { HandoffService } from './HandoffService';
import { turnDiff } from './ReviewerService';

// Rules that chain the sessions of a group (ADR 0024): when A does X, send this to B. The engine
// listens to what already exists (the end of a turn, the checks, the file a session writes back)
// and hands the text to the queue of the destination, which sends it only when the agent is free
// and not asking anything (ADR 0015). By default a rule only prepares the send: the user approves.

interface Run {
  pending: FlowPending[];
  history: FlowHistoryEntry[];
  /** Times each rule that closes a cycle went off since the flow last started over. */
  rounds: Record<string, number>;
  reason?: FlowStopReason;
}

interface FlowEvents {
  changed: [groupId: string];
}

export interface FlowEngineOptions {
  manager: SessionManager;
  handoff: HandoffService;
  checkpoints: Pick<CheckpointService, 'latestPair' | 'idle'>;
  queue: Pick<PromptQueue, 'add'>;
  /** Fills in the variables of the prompts for the session that receives the text. */
  expand(sessionId: string, text: string): Promise<string>;
  describeError?(error: unknown): string;
  now?: () => number;
  /** How long the file of a session is waited for before the wait starts over. */
  watchMs?: number;
}

const WATCH_MS = 15 * 60 * 1000;

/** Each variable of a rule under its Portuguese name, as the prompts are written, and in English. */
const NAMES: Record<string, 'diff' | 'out' | 'targetOut' | 'source'> = {
  diff_do_turno: 'diff',
  turn_diff: 'diff',
  saida: 'out',
  saída: 'out',
  output: 'out',
  saida_destino: 'targetOut',
  saída_destino: 'targetOut',
  target_output: 'targetOut',
  sessao_origem: 'source',
  sessão_origem: 'source',
  source_session: 'source',
};
const VARIABLE =
  /\{(diff_do_turno|turn_diff|sa[ií]da_destino|target_output|sa[ií]da|output|sess[aã]o_origem|source_session)\}/gi;

export class FlowEngine extends EventEmitter<FlowEvents> {
  private readonly runs = new Map<string, Run>();
  private readonly watchers = new Map<string, AbortController>();
  private readonly now: () => number;

  constructor(private readonly options: FlowEngineOptions) {
    super();
    this.now = options.now ?? Date.now;
    options.manager.on('removed', (id) => this.onRemoved(id));
  }

  /** Marks the sessions of the groups that already have rules and starts waiting for files. */
  start(): void {
    for (const group of this.options.manager.listGroups()) this.publish(group.id);
    this.rearm();
  }

  dispose(): void {
    for (const control of this.watchers.values()) control.abort();
    this.watchers.clear();
  }

  // ---- reading --------------------------------------------------------------------------------

  private run(groupId: string): Run {
    let run = this.runs.get(groupId);
    if (!run) {
      run = { pending: [], history: [], rounds: {} };
      this.runs.set(groupId, run);
    }
    return run;
  }

  private group(groupId: string) {
    const group = this.options.manager.listGroups().find((g) => g.id === groupId);
    if (!group) throw new UserError('error.group.notFound');
    return group;
  }

  get(groupId: string): FlowState {
    const group = this.group(groupId);
    const run = this.run(groupId);
    return {
      groupId,
      rules: (group.flow?.rules ?? []).map((r) => ({ ...r })),
      paused: group.flow?.paused ?? false,
      ...(run.reason && { reason: run.reason }),
      pending: run.pending.map((p) => ({ ...p })),
      history: run.history.map((h) => ({ ...h })),
      rounds: { ...run.rounds },
      files: Object.fromEntries(
        this.options.manager
          .list()
          .filter((s) => s.groupId === groupId)
          .map((s) => [s.id, this.options.handoff.files(s.id).reviewFile]),
      ),
    };
  }

  // ---- changing -------------------------------------------------------------------------------

  /** Replaces the rules of the group. Both ends of each rule must be sessions of the group. */
  set(groupId: string, value: unknown): FlowState {
    const group = this.group(groupId);
    const members = new Set(
      this.options.manager
        .list()
        .filter((s) => s.groupId === group.id)
        .map((s) => s.id),
    );
    const rules = parseFlowRules(value, members);
    const run = this.run(groupId);
    run.pending = run.pending.filter((p) => rules.some((r) => r.id === p.ruleId));
    run.rounds = {};
    delete run.reason;
    this.options.manager.setGroupFlow(groupId, {
      rules,
      paused: rules.length ? (group.flow?.paused ?? false) : false,
    });
    this.changed(groupId);
    return this.get(groupId);
  }

  /** Suspends every rule of the group, or lets them go again from a clean start. */
  pause(groupId: string, paused: boolean): FlowState {
    const group = this.group(groupId);
    if (!group.flow) return this.get(groupId);
    const run = this.run(groupId);
    if (!paused) {
      run.rounds = {};
      delete run.reason;
    }
    this.options.manager.setGroupFlow(groupId, { rules: group.flow.rules, paused });
    this.changed(groupId);
    return this.get(groupId);
  }

  /** The user approved a prepared send. */
  async approve(groupId: string, pendingId: string): Promise<FlowState> {
    const run = this.run(groupId);
    const pending = run.pending.find((p) => p.id === pendingId);
    if (!pending) throw new UserError('error.flow.pendingGone');
    const rule = this.group(groupId).flow?.rules.find((r) => r.id === pending.ruleId);
    run.pending = run.pending.filter((p) => p !== pending);
    if (rule) {
      await this.send(groupId, rule, pending.text, pending.fromId, pending.toId);
    } else {
      this.changed(groupId);
    }
    return this.get(groupId);
  }

  discard(groupId: string, pendingId: string): FlowState {
    const run = this.run(groupId);
    const pending = run.pending.find((p) => p.id === pendingId);
    if (!pending) throw new UserError('error.flow.pendingGone');
    run.pending = run.pending.filter((p) => p !== pending);
    this.record(groupId, {
      kind: 'discarded',
      ruleId: pending.ruleId,
      ...this.names(pending.fromId, pending.toId),
    });
    this.changed(groupId);
    return this.get(groupId);
  }

  private onRemoved(id: string): void {
    for (const group of this.options.manager.listGroups()) {
      const flow = group.flow;
      if (!flow) continue;
      const rules = flow.rules.filter((r) => r.from !== id && r.to !== id);
      const run = this.run(group.id);
      run.pending = run.pending.filter((p) => p.fromId !== id && p.toId !== id);
      if (rules.length !== flow.rules.length) {
        this.options.manager.setGroupFlow(group.id, { rules, paused: flow.paused });
      }
      this.changed(group.id);
    }
  }

  // ---- events from the sessions ---------------------------------------------------------------

  /** The agent ended a turn. A state that was only guessed from silence does not count. */
  turnEnded(sessionId: string): void {
    const status = this.options.manager.statusOf(sessionId);
    if (!status.confirmed || status.origin === 'silencio') return;
    void this.fire(sessionId, 'turnEnded');
  }

  /** The checks of the end of a turn are over. */
  checksFinished(sessionId: string, outcome: 'passed' | 'failed'): void {
    void this.fire(sessionId, outcome === 'passed' ? 'checksPassed' : 'checksFailed');
  }

  /** The agent asks something of the user: nothing goes on until they answer and resume. */
  asking(sessionId: string): void {
    const session = this.options.manager.get(sessionId);
    const flow = session?.groupId && this.groupFlow(session.groupId);
    if (!session?.groupId || !flow || flow.paused) return;
    if (!flow.rules.some((r) => r.from === sessionId || r.to === sessionId)) return;
    this.stop(session.groupId, 'question');
  }

  private groupFlow(groupId: string) {
    return this.options.manager.listGroups().find((g) => g.id === groupId)?.flow;
  }

  // ---- firing ---------------------------------------------------------------------------------

  private async fire(sessionId: string, when: FlowWhen): Promise<void> {
    const from = this.options.manager.get(sessionId);
    if (!from?.groupId) return;
    const groupId = from.groupId;
    const rules = (this.groupFlow(groupId)?.rules ?? []).filter(
      (r) => r.from === sessionId && r.when === when,
    );
    for (const rule of rules) {
      // Re-read: an earlier rule may have stopped the flow, or a rule may have been changed.
      const flow = this.groupFlow(groupId);
      if (!flow || flow.paused || !flow.rules.some((r) => r.id === rule.id)) return;
      try {
        await this.handle(groupId, flow.rules, rule);
      } catch (error) {
        this.record(groupId, {
          kind: 'failed',
          ruleId: rule.id,
          ...this.names(rule.from, rule.to),
          error: this.options.describeError?.(error) ?? (error as Error).message,
        });
        this.changed(groupId);
      }
    }
  }

  private async handle(groupId: string, rules: FlowRule[], rule: FlowRule): Promise<void> {
    const { manager } = this.options;
    const from = manager.get(rule.from);
    const to = manager.get(rule.to);
    if (!from || !to || from.groupId !== groupId || to.groupId !== groupId) return;
    const run = this.run(groupId);
    if (closesCycle(rules, rule) && (run.rounds[rule.id] ?? 0) >= rule.maxRounds) {
      this.stop(groupId, 'limit', rule);
      return;
    }
    const text = await this.build(rule, from, to);
    // The flow may have been stopped while the diff was being written.
    const flow = this.groupFlow(groupId);
    if (!flow || flow.paused || !flow.rules.some((r) => r.id === rule.id)) return;
    if (!rule.confirm) {
      await this.send(groupId, rule, text, from.id, to.id);
      return;
    }
    // A newer send of the same rule replaces the one that was waiting: it has the latest work.
    run.pending = run.pending.filter((p) => p.ruleId !== rule.id);
    run.pending.push({
      id: randomUUID(),
      ruleId: rule.id,
      fromId: from.id,
      toId: to.id,
      text,
      at: this.now(),
    });
    run.pending = run.pending.slice(-FLOW_PENDING_LIMIT);
    this.record(groupId, {
      kind: 'prepared',
      ruleId: rule.id,
      fromName: from.name,
      toName: to.name,
    });
    this.changed(groupId);
  }

  /** The text of the rule with its variables filled in, and the files they point to written. */
  private async build(rule: FlowRule, from: Session, to: Session): Promise<string> {
    const { handoff, checkpoints } = this.options;
    const fromFiles = handoff.files(from.id);
    const toFiles = handoff.files(to.id);
    let diffFile = '';
    if (rule.prompt.match(VARIABLE)?.some((m) => NAMES[m.slice(1, -1).toLowerCase()] === 'diff')) {
      await checkpoints.idle(from.id);
      const pair = await checkpoints.latestPair(from.id);
      const diff = pair
        ? await turnDiff(pair.root, pair.from.tree, pair.to.tree)
        : { text: '# The latest turn changed no files.\n' };
      diffFile = (await handoff.writeDiff(from.id, diff.text)).diffFile;
    }
    const values = {
      diff: diffFile,
      out: fromFiles.reviewFile,
      targetOut: toFiles.reviewFile,
      source: from.name,
    };
    const filled = rule.prompt.replace(
      VARIABLE,
      (_whole, name: string) => values[NAMES[name.toLowerCase()]!],
    );
    return this.options.expand(to.id, filled);
  }

  private async send(
    groupId: string,
    rule: FlowRule,
    text: string,
    fromId: string,
    toId: string,
  ): Promise<void> {
    const run = this.run(groupId);
    const rules = this.groupFlow(groupId)?.rules ?? [rule];
    try {
      this.options.queue.add(toId, { text, condition: 'turnEnd' });
    } catch (error) {
      this.record(groupId, {
        kind: 'failed',
        ruleId: rule.id,
        ...this.names(fromId, toId),
        error: this.options.describeError?.(error) ?? (error as Error).message,
      });
      this.changed(groupId);
      return;
    }
    // A rule outside every cycle starts a new run of the flow: the counts begin again.
    if (closesCycle(rules, rule)) run.rounds[rule.id] = (run.rounds[rule.id] ?? 0) + 1;
    else run.rounds = {};
    this.record(groupId, { kind: 'sent', ruleId: rule.id, ...this.names(fromId, toId) });
    this.changed(groupId);
  }

  private stop(groupId: string, reason: FlowStopReason, rule?: FlowRule): void {
    const flow = this.groupFlow(groupId);
    if (!flow || flow.paused) return;
    this.run(groupId).reason = reason;
    this.options.manager.setGroupFlow(groupId, { rules: flow.rules, paused: true });
    this.record(groupId, {
      kind: 'stopped',
      reason,
      ...(rule && { ruleId: rule.id, ...this.names(rule.from, rule.to) }),
    });
    this.changed(groupId);
  }

  // ---- history and marks ----------------------------------------------------------------------

  private names(fromId: string, toId: string): { fromName?: string; toName?: string } {
    const { manager } = this.options;
    const fromName = manager.get(fromId)?.name;
    const toName = manager.get(toId)?.name;
    return { ...(fromName && { fromName }), ...(toName && { toName }) };
  }

  private record(groupId: string, entry: Omit<FlowHistoryEntry, 'at'>): void {
    const run = this.run(groupId);
    run.history.push({ at: this.now(), ...entry });
    if (run.history.length > FLOW_HISTORY_LIMIT) run.history.shift();
  }

  private changed(groupId: string): void {
    this.publish(groupId);
    this.rearm();
    this.emit('changed', groupId);
  }

  /** What each session of the group shows in the list. */
  private publish(groupId: string): void {
    const { manager } = this.options;
    const flow = this.groupFlow(groupId);
    const run = this.run(groupId);
    for (const session of manager.list()) {
      if (session.groupId !== groupId) continue;
      let mark: FlowMark | undefined;
      if (flow?.rules.some((r) => r.from === session.id || r.to === session.id)) {
        mark = {
          to: [...new Set(flow.rules.filter((r) => r.from === session.id).map((r) => r.to))],
          pending: run.pending
            .filter((p) => p.fromId === session.id)
            .map((p) => ({ id: p.id, toId: p.toId })),
          paused: flow.paused,
        };
      }
      manager.setFlowMark(session.id, mark);
    }
  }

  // ---- files that come back -------------------------------------------------------------------

  /** One wait per session that has a rule on `fileWritten`, while the flow of its group runs. */
  private rearm(): void {
    const wanted = new Set<string>();
    for (const group of this.options.manager.listGroups()) {
      if (!group.flow || group.flow.paused) continue;
      for (const rule of group.flow.rules) {
        if (rule.when === 'fileWritten' && this.options.manager.has(rule.from)) {
          wanted.add(rule.from);
        }
      }
    }
    for (const [id, control] of this.watchers) {
      if (wanted.has(id)) continue;
      control.abort();
      this.watchers.delete(id);
    }
    for (const id of wanted) if (!this.watchers.has(id)) this.watch(id);
  }

  private watch(sessionId: string): void {
    const control = new AbortController();
    this.watchers.set(sessionId, control);
    const { signal } = control;
    void (async () => {
      let since = this.now();
      while (!signal.aborted) {
        const outcome = await this.options.handoff.waitForReview(sessionId, {
          signal,
          since,
          timeoutMs: this.options.watchMs ?? WATCH_MS,
        });
        if (outcome === 'arrived') {
          since = this.now();
          await this.fire(sessionId, 'fileWritten');
        } else if (outcome === 'cancelled') {
          return;
        }
      }
    })();
  }
}
