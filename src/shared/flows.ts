// Rules that chain the sessions of a group: when A does X, send this to B (ADR 0024). They send
// by themselves, so the shape is deliberately small: four triggers, a destination in the same
// group, a limit on every round trip.
import { UserError } from './i18n';

/** What makes a rule go off. `fileWritten`: the session wrote its file back (`{saida}`). */
export type FlowWhen = 'turnEnded' | 'checksPassed' | 'checksFailed' | 'fileWritten';

export const FLOW_WHEN: readonly FlowWhen[] = [
  'turnEnded',
  'checksPassed',
  'checksFailed',
  'fileWritten',
];

export interface FlowRule {
  id: string;
  /** The session whose event is waited for. */
  from: string;
  when: FlowWhen;
  /** What is sent, with the variables of the prompts and the ones in `FLOW_VARIABLES`. */
  prompt: string;
  /** The session that receives it, in the same group. */
  to: string;
  /** True: the send is only prepared, and the user approves it. */
  confirm: boolean;
  /** How many times a rule that closes a cycle (A to B to A) may go off before the flow stops. */
  maxRounds: number;
}

/** What a group keeps: persisted with it in `sessions.json`, outside the preferences export. */
export interface GroupFlow {
  rules: FlowRule[];
  /** Every rule suspended, by the user or by the flow itself (`FlowState.reason`). */
  paused: boolean;
}

export const FLOW_RULES_LIMIT = 20;
export const FLOW_ROUNDS_MIN = 1;
export const FLOW_ROUNDS_MAX = 10;
export const FLOW_ROUNDS_DEFAULT = 3;
export const FLOW_PROMPT_LIMIT = 4000;
export const FLOW_HISTORY_LIMIT = 40;
export const FLOW_PENDING_LIMIT = 20;

/**
 * The variables only a rule has. `{saida_destino}` is where the receiver is asked to write its own
 * answer, which a rule that waits for `fileWritten` of it reads back.
 */
export const FLOW_VARIABLES = ['diff_do_turno', 'saida', 'saida_destino', 'sessao_origem'] as const;

/** Why the flow of a group stopped by itself. */
export type FlowStopReason = 'limit' | 'question';

/** A send prepared and waiting for the user. */
export interface FlowPending {
  id: string;
  ruleId: string;
  fromId: string;
  toId: string;
  /** The text as it will be sent: the variables are already filled in. */
  text: string;
  at: number;
}

export type FlowHistoryKind = 'prepared' | 'sent' | 'discarded' | 'stopped' | 'failed';

export interface FlowHistoryEntry {
  at: number;
  kind: FlowHistoryKind;
  ruleId?: string;
  /** The names are kept: the session may be gone when the history is read. */
  fromName?: string;
  toName?: string;
  reason?: FlowStopReason;
  /** Why it failed, as the user reads it. */
  error?: string;
}

export interface FlowState {
  groupId: string;
  rules: FlowRule[];
  paused: boolean;
  reason?: FlowStopReason;
  pending: FlowPending[];
  history: FlowHistoryEntry[];
  /** Rules that closed a cycle: how many times each has gone off in this run. */
  rounds: Record<string, number>;
  /** The file each session of the group writes its answer to (`{saida}`), by session id. */
  files: Record<string, string>;
}

/** What the list shows of a session in a flow. */
export interface FlowMark {
  /** The sessions its rules send to. */
  to: string[];
  /** Sends prepared for this session to receive, waiting for the user. */
  pending: { id: string; toId: string }[];
  paused: boolean;
}

/**
 * Whether the rule is part of a cycle: its destination can reach its source again through the
 * rules. Those are the ones the round limit applies to.
 */
export function closesCycle(rules: readonly FlowRule[], rule: FlowRule): boolean {
  const seen = new Set<string>();
  const stack = [rule.to];
  while (stack.length) {
    const id = stack.pop()!;
    if (id === rule.from) return true;
    if (seen.has(id)) continue;
    seen.add(id);
    for (const next of rules) if (next.from === id) stack.push(next.to);
  }
  return false;
}

function cleanRule(raw: unknown): FlowRule | null {
  if (!raw || typeof raw !== 'object') return null;
  const r = raw as Partial<FlowRule>;
  if (typeof r.id !== 'string' || !r.id || r.id.length > 64) return null;
  if (typeof r.from !== 'string' || !r.from || typeof r.to !== 'string' || !r.to) return null;
  if (r.from === r.to) return null;
  const when = FLOW_WHEN.find((w) => w === r.when);
  if (!when) return null;
  if (typeof r.prompt !== 'string' || !r.prompt.trim()) return null;
  const rounds = r.maxRounds;
  if (
    typeof rounds !== 'number' ||
    !Number.isInteger(rounds) ||
    rounds < FLOW_ROUNDS_MIN ||
    rounds > FLOW_ROUNDS_MAX
  ) {
    return null;
  }
  return {
    id: r.id,
    from: r.from,
    when,
    prompt: r.prompt.slice(0, FLOW_PROMPT_LIMIT),
    to: r.to,
    confirm: r.confirm !== false,
    maxRounds: rounds,
  };
}

/** What is read from `sessions.json`: what does not fit is left out, never an error. */
export function sanitizeFlow(value: unknown): GroupFlow | undefined {
  const v = value as Partial<GroupFlow> | null | undefined;
  if (!v || typeof v !== 'object' || !Array.isArray(v.rules)) return undefined;
  const rules: FlowRule[] = [];
  const ids = new Set<string>();
  for (const raw of v.rules) {
    const rule = cleanRule(raw);
    if (!rule || ids.has(rule.id)) continue;
    ids.add(rule.id);
    rules.push(rule);
    if (rules.length === FLOW_RULES_LIMIT) break;
  }
  if (!rules.length) return undefined;
  return { rules, paused: v.paused === true };
}

/**
 * What the user sends: the same rules, but anything wrong is an error, and both ends must be
 * sessions of the group.
 */
export function parseFlowRules(value: unknown, memberIds: ReadonlySet<string>): FlowRule[] {
  if (!Array.isArray(value)) throw new UserError('error.flow.invalid');
  if (value.length > FLOW_RULES_LIMIT) {
    throw new UserError('error.flow.tooMany', { limit: FLOW_RULES_LIMIT });
  }
  const rules: FlowRule[] = [];
  const ids = new Set<string>();
  for (const raw of value) {
    const rule = cleanRule(raw);
    if (!rule || ids.has(rule.id)) {
      const rounds = (raw as Partial<FlowRule> | null)?.maxRounds;
      throw new UserError(
        typeof rounds === 'number' && (rounds < FLOW_ROUNDS_MIN || rounds > FLOW_ROUNDS_MAX)
          ? 'error.flow.rounds'
          : 'error.flow.invalid',
        { min: FLOW_ROUNDS_MIN, max: FLOW_ROUNDS_MAX },
      );
    }
    if (!memberIds.has(rule.from) || !memberIds.has(rule.to)) {
      throw new UserError('error.flow.notInGroup');
    }
    ids.add(rule.id);
    rules.push(rule);
  }
  return rules;
}
