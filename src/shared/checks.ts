import { sanitizeAgentCommand } from './agents';

/** A command that says whether the project is in a good state: lint, typecheck, tests. */
export interface CheckConfig {
  id: string;
  label: string;
  /** One line, run in the user's shell in the folder of the session. */
  command: string;
  timeoutSec: number;
  /** Runs by itself when the agent ends a turn that changed files; otherwise only when asked. */
  onTurnEnd: boolean;
}

/** One error or warning a check printed, with the place it points to. */
export interface Problem {
  /** Relative to the folder of the session, with forward slashes, when it is inside it. */
  file: string;
  /** 1-based. */
  line: number;
  column?: number;
  severity: 'error' | 'warning';
  message: string;
  /** The label of the check it came from. */
  source: string;
  checkId: string;
}

/** Id of the factory prompt that asks the agent to fix the problems of the list. */
export const FIX_PROMPT_ID = 'fix-problems';

/** The most problems kept for one check; the rest are only counted. */
export const PROBLEMS_LIMIT = 500;

export type CheckOutcome = 'passed' | 'failed' | 'timedOut' | 'cancelled' | 'error';

export interface CheckResult {
  id: string;
  label: string;
  command: string;
  outcome: CheckOutcome;
  exitCode: number | null;
  durationMs: number;
  /** The end of what the command printed, with the escape sequences of the terminal removed. */
  output: string;
  truncated: boolean;
  /** What the output said about files and lines, read while the command wrote it. */
  problems: Problem[];
  /** How many more there were beyond `PROBLEMS_LIMIT`. */
  moreProblems: number;
}

export type ChecksRunState = 'queued' | 'running' | 'done' | 'cancelled';

export interface ChecksRun {
  trigger: 'turnEnd' | 'manual';
  state: ChecksRunState;
  startedAt: number;
  finishedAt?: number;
  /** The checks of this run, in order. */
  checks: Pick<CheckConfig, 'id' | 'label' | 'command'>[];
  /** One per check already run. */
  results: CheckResult[];
  /** Id of the check running now. */
  current?: string;
}

/** What the list of sessions shows of the latest run. */
export interface ChecksSummary {
  state: 'queued' | 'running' | 'passed' | 'failed' | 'cancelled';
  failed: number;
  total: number;
}

export interface ChecksInfo {
  /** The folder the checks belong to: the one of the session. */
  folder: string;
  checks: CheckConfig[];
  /** Taken from the scripts of the project, not configured yet. */
  suggestions: CheckConfig[];
  run: ChecksRun | null;
}

export const CHECKS_LIMIT = 10;
export const CHECK_LABEL_LIMIT = 80;
export const CHECK_TIMEOUT = { min: 5, max: 3600, default: 300 } as const;

const idOf = (text: string) =>
  text
    .toLowerCase()
    .normalize('NFD')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 40) || 'check';

/** What a file or the renderer says about checks, as checks; anything else is dropped. */
export function sanitizeChecks(value: unknown): CheckConfig[] {
  const checks: CheckConfig[] = [];
  const ids = new Set<string>();
  for (const item of Array.isArray(value) ? value : []) {
    if (!item || typeof item !== 'object') continue;
    const given = item as Partial<CheckConfig>;
    const command = sanitizeAgentCommand(given.command);
    if (!command) continue;
    const label =
      (typeof given.label === 'string' ? given.label.trim().slice(0, CHECK_LABEL_LIMIT) : '') ||
      command.slice(0, CHECK_LABEL_LIMIT);
    let id = typeof given.id === 'string' && /^[a-z0-9-]{1,40}$/.test(given.id) ? given.id : '';
    if (!id || ids.has(id)) {
      const base = idOf(label);
      id = base;
      for (let n = 2; ids.has(id); n++) id = `${base}-${n}`;
    }
    ids.add(id);
    const timeout =
      typeof given.timeoutSec === 'number' && Number.isFinite(given.timeoutSec)
        ? Math.round(given.timeoutSec)
        : CHECK_TIMEOUT.default;
    checks.push({
      id,
      label,
      command,
      timeoutSec: Math.min(CHECK_TIMEOUT.max, Math.max(CHECK_TIMEOUT.min, timeout)),
      onTurnEnd: given.onTurnEnd !== false,
    });
    if (checks.length === CHECKS_LIMIT) break;
  }
  return checks;
}

const FAILED: readonly CheckOutcome[] = ['failed', 'timedOut', 'error'];

export const isFailure = (outcome: CheckOutcome) => FAILED.includes(outcome);

export function summarizeRun(run: ChecksRun): ChecksSummary {
  const failed = run.results.filter((r) => isFailure(r.outcome)).length;
  const total = run.checks.length;
  if (run.state === 'queued' || run.state === 'running') return { state: run.state, failed, total };
  if (run.state === 'cancelled') return { state: 'cancelled', failed, total };
  return { state: failed > 0 ? 'failed' : 'passed', failed, total };
}

// CSI (colors, cursor), OSC (titles, links) and the two-character escapes.
// eslint-disable-next-line no-control-regex
const ANSI = /\x1b\[[0-9;?]*[ -/]*[@-~]|\x1b\][^\x07\x1b]*(?:\x07|\x1b\\)|\x1b[@-_]/g;

/**
 * The text a terminal would show, without the sequences that color or move it. A carriage return
 * alone rewrites its line (progress bars), so only what was written last on it stays.
 */
export function stripAnsi(text: string): string {
  return text
    .replace(ANSI, '')
    .replace(/\r\n/g, '\n')
    .split('\n')
    .map((line) => line.split('\r').filter(Boolean).at(-1) ?? '')
    .join('\n');
}

/** The place of a problem, as a path:line:column that terminals and editors know. */
export const problemPlace = (problem: Pick<Problem, 'file' | 'line' | 'column'>): string =>
  `${problem.file}:${problem.line}${problem.column ? `:${problem.column}` : ''}`;

/** One problem as a line of text for the agent. */
export const formatProblem = (problem: Problem): string =>
  `${problemPlace(problem)} ${problem.severity} [${problem.source}]: ${problem.message}`;
