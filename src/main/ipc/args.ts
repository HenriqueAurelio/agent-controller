// The arguments of the channels, as they come from the renderer: checked here, never trusted.
import { SEARCH_TEXT_LIMIT, type SearchQuery } from '@shared/search';
import type { PreviewBounds } from '@shared/preview';
import { AGENT_COMMAND_LIMIT, sanitizeAgentCommand } from '@shared/agents';
import {
  ATTEMPTS_MAX,
  EXPERIMENT_NAME_LIMIT,
  EXPERIMENT_PROMPT_LIMIT,
  type AttemptSpec,
  type NewExperimentInput,
} from '@shared/experiments';
import {
  TASK_DESCRIPTION_LIMIT,
  TASK_TITLE_LIMIT,
  TASKS_PER_PASTE_LIMIT,
  type NewTasksInput,
} from '@shared/tasks';
import { UserError, type MessageKey } from '@shared/i18n';
import { parseCheckpointBase } from '@shared/checkpoints';
import type { DiffBase, HunkRevert } from '@shared/git';
import { PIPELINE_TEXT_LIMIT } from '@shared/pulls';
import {
  REVIEW_BODY_LIMIT,
  REVIEW_DRAFTS_LIMIT,
  type ReviewSubmission,
  type ReviewVerdict,
} from '@shared/pullReview';
import {
  REVIEW_COMMENT_TEXT_LIMIT,
  REVIEW_LINE_LIMIT,
  REVIEW_SNIPPET_LIMIT,
  REVIEW_TEXT_LIMIT,
  type NewReviewComment,
} from '@shared/review';
import {
  PROMPT_TEXT_LIMIT,
  QUEUE_CONDITIONS,
  PROBLEMS_TEXT_LIMIT,
  SELECTION_LIMIT,
  type PromptValues,
  type QueueCondition,
  type QueueItemUpdate,
} from '@shared/prompts';
import {
  AGENT_PROFILE_IDS,
  GROUP_NAME_LIMIT,
  type GroupUpdate,
  type TerminalSize,
} from '@shared/session';

export type ArgumentName =
  Extract<MessageKey, `arg.${string}`> extends `arg.${infer Name}` ? Name : never;

export const str = (value: unknown, name: ArgumentName, max = 4096): string => {
  if (typeof value !== 'string' || value.length > max) {
    throw new UserError('error.invalidArgument', { name: { key: `arg.${name}` } });
  }
  return value;
};
/**
 * Terminal input is a byte stream, not a saved prompt. The terminal and the agent decide how
 * much of a paste they accept; imposing a second, arbitrary cap here makes Ctrl+V differ from
 * using Claude Code in a regular terminal.
 */
export const terminalData = (value: unknown): string => {
  if (typeof value !== 'string') {
    throw new UserError('error.invalidArgument', { name: { key: 'arg.data' } });
  }
  return value;
};
/** A command to run in place of the agent's own: one line, or it is refused. */
export const command = (value: unknown): string => {
  const text = str(value, 'command', AGENT_COMMAND_LIMIT);
  if (text.trim() && !sanitizeAgentCommand(text)) {
    throw new UserError('error.invalidArgument', { name: { key: 'arg.command' } });
  }
  return text;
};
export const size = (value: unknown): TerminalSize => {
  const v = value as Partial<TerminalSize> | null;
  const ok = (n: unknown): n is number => typeof n === 'number' && Number.isFinite(n);
  if (!v || !ok(v.cols) || !ok(v.rows)) throw new UserError('error.terminalSize');
  return {
    cols: Math.min(1000, Math.max(2, Math.floor(v.cols))),
    rows: Math.min(500, Math.max(1, Math.floor(v.rows))),
  };
};
export const promptValues = (value: unknown): PromptValues => {
  const v = (value && typeof value === 'object' ? value : {}) as Record<string, unknown>;
  const answers: Record<string, string> = {};
  const given = v.answers && typeof v.answers === 'object' ? Object.entries(v.answers) : [];
  if (given.length > 50)
    throw new UserError('error.invalidArgument', { name: { key: 'arg.text' } });
  for (const [question, answer] of given) answers[question] = str(answer, 'text', 8000);
  if (typeof v.selection === 'string' && v.selection.length > SELECTION_LIMIT) {
    throw new UserError('error.prompt.selectionTooLarge', { limit: SELECTION_LIMIT });
  }
  return {
    file: v.file === undefined ? undefined : str(v.file, 'file'),
    selection: v.selection === undefined ? undefined : str(v.selection, 'text', SELECTION_LIMIT),
    problems: v.problems === undefined ? undefined : str(v.problems, 'text', PROBLEMS_TEXT_LIMIT),
    pr: v.pr === undefined ? undefined : str(v.pr, 'text', 2000),
    pipeline: v.pipeline === undefined ? undefined : str(v.pipeline, 'text', PIPELINE_TEXT_LIMIT),
    review: v.review === undefined ? undefined : str(v.review, 'text', REVIEW_TEXT_LIMIT),
    answers,
  };
};
export const line = (value: unknown): number => {
  if (typeof value !== 'number' || !Number.isInteger(value) || value < 1) {
    throw new UserError('error.review.badLines');
  }
  return Math.min(value, REVIEW_LINE_LIMIT);
};
export const newComment = (value: unknown): NewReviewComment => {
  const v = (value && typeof value === 'object' ? value : {}) as Record<string, unknown>;
  const startLine = line(v.startLine);
  const endLine = line(v.endLine);
  if (endLine < startLine) throw new UserError('error.review.badLines');
  return {
    file: str(v.file, 'file'),
    startLine,
    endLine,
    // A longer snippet is cut, not refused: the lines still say where the comment is.
    snippet: str(v.snippet ?? '', 'text', 1024 * 1024).slice(0, REVIEW_SNIPPET_LIMIT),
    text: str(v.text, 'text', REVIEW_COMMENT_TEXT_LIMIT),
  };
};
/** Lines of a block, each one line of text. */
export const hunkLines = (value: unknown): string[] => {
  if (!Array.isArray(value) || value.length > 50_000) {
    throw new UserError('error.invalidArgument', { name: { key: 'arg.text' } });
  }
  return value.map((line) => {
    const text = str(line, 'text', 100_000);
    if (text.includes('\n')) {
      throw new UserError('error.invalidArgument', { name: { key: 'arg.text' } });
    }
    return text;
  });
};
export const hunkRevert = (value: unknown): HunkRevert => {
  const v = (value && typeof value === 'object' ? value : {}) as Record<string, unknown>;
  const start = v.newStart;
  if (typeof start !== 'number' || !Number.isInteger(start) || start < 1) {
    throw new UserError('error.invalidArgument', { name: { key: 'arg.line' } });
  }
  return {
    file: str(v.file, 'file'),
    newStart: start,
    before: hunkLines(v.before),
    after: hunkLines(v.after),
  };
};
const VERDICTS: readonly ReviewVerdict[] = ['COMMENT', 'APPROVE', 'REQUEST_CHANGES'];
export const submission = (value: unknown): ReviewSubmission => {
  const v = (value && typeof value === 'object' ? value : {}) as Record<string, unknown>;
  if (!VERDICTS.includes(v.verdict as ReviewVerdict)) {
    throw new UserError('error.invalidArgument', { name: { key: 'arg.choice' } });
  }
  const list = Array.isArray(v.comments) ? v.comments : [];
  if (list.length > REVIEW_DRAFTS_LIMIT) {
    throw new UserError('error.invalidArgument', { name: { key: 'arg.text' } });
  }
  const comments = list.map((item) => {
    const c = (item && typeof item === 'object' ? item : {}) as Record<string, unknown>;
    const at = c.line;
    if (typeof at !== 'number' || !Number.isInteger(at) || at < 1) {
      throw new UserError('error.invalidArgument', { name: { key: 'arg.line' } });
    }
    return {
      path: str(c.path, 'file'),
      line: at,
      ...(c.oldSide === true ? { oldSide: true } : {}),
      body: str(c.body, 'text', REVIEW_BODY_LIMIT),
    };
  });
  const body = str(v.body ?? '', 'text', REVIEW_BODY_LIMIT);
  if (comments.length === 0 && !body.trim() && v.verdict !== 'APPROVE') {
    throw new UserError('error.pullReview.empty');
  }
  return {
    verdict: v.verdict as ReviewVerdict,
    body,
    comments,
    headSha: str(v.headSha ?? '', 'text', 100),
  };
};
export const bounds = (value: unknown): PreviewBounds => {
  const v = (value && typeof value === 'object' ? value : {}) as Record<string, unknown>;
  const n = (x: unknown) => (typeof x === 'number' && Number.isFinite(x) ? x : 0);
  return { x: n(v.x), y: n(v.y), width: n(v.width), height: n(v.height) };
};
export const patterns = (value: unknown): string[] =>
  (Array.isArray(value) ? value : [])
    .slice(0, 20)
    .map((p) => str(p, 'text', 200).trim())
    .filter((p) => p && !p.split(/[\\/]/).includes('..'));
export const searchQuery = (value: unknown): SearchQuery => {
  const v = (value && typeof value === 'object' ? value : {}) as Record<string, unknown>;
  return {
    text: str(v.text, 'text', SEARCH_TEXT_LIMIT),
    caseSensitive: v.caseSensitive === true,
    wholeWord: v.wholeWord === true,
    regex: v.regex === true,
    include: patterns(v.include),
    exclude: patterns(v.exclude),
    changedOnly: v.changedOnly === true,
  };
};
export const base = (value: unknown): DiffBase =>
  value === 'session' || value === 'branchBase' || value === 'previousTurn'
    ? value
    : typeof value === 'string' && parseCheckpointBase(value)
      ? (value as DiffBase)
      : 'head';
/** Ids of sessions or groups: whatever is not one is left out, and the manager skips unknown ones. */
export const ids = (value: unknown): string[] => {
  if (!Array.isArray(value) || value.length > 1000) throw new UserError('error.invalidOrder');
  return value.filter((id): id is string => typeof id === 'string' && id.length <= 64);
};
export const groupUpdate = (value: unknown): GroupUpdate => {
  const v = value as Record<string, unknown> | null;
  if (!v || typeof v !== 'object') {
    throw new UserError('error.invalidArgument', { name: { key: 'arg.group' } });
  }
  return {
    ...(v.name !== undefined && { name: str(v.name, 'name', GROUP_NAME_LIMIT * 4) }),
    ...(v.collapsed !== undefined && { collapsed: v.collapsed === true }),
    ...(v.sessionIds !== undefined && { sessionIds: ids(v.sessionIds) }),
  };
};

export const condition = (value: unknown): QueueCondition => {
  if (!QUEUE_CONDITIONS.includes(value as QueueCondition)) {
    throw new UserError('error.invalidArgument', { name: { key: 'arg.condition' } });
  }
  return value as QueueCondition;
};
export const queueUpdate = (value: unknown): QueueItemUpdate => {
  const v = value as Record<string, unknown> | null;
  if (!v || typeof v !== 'object') {
    throw new UserError('error.invalidArgument', { name: { key: 'arg.item' } });
  }
  return {
    ...(v.text !== undefined && { text: str(v.text, 'text', PROMPT_TEXT_LIMIT) }),
    ...(v.condition !== undefined && { condition: condition(v.condition) }),
  };
};

export function experimentInput(value: unknown): NewExperimentInput {
  const v = (value && typeof value === 'object' ? value : {}) as Record<string, unknown>;
  if (!Array.isArray(v.attempts) || v.attempts.length > ATTEMPTS_MAX) {
    throw new UserError('error.experiment.attempts', { min: 1, max: ATTEMPTS_MAX });
  }
  const attempts = v.attempts.map((raw: unknown): AttemptSpec => {
    const a = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>;
    if (!AGENT_PROFILE_IDS.includes(a.profile as never)) {
      throw new UserError('error.unknownProfile');
    }
    return {
      profile: a.profile as AttemptSpec['profile'],
      ...(typeof a.command === 'string' && a.command.trim() && { command: command(a.command) }),
    };
  });
  return {
    name: str(v.name, 'name', EXPERIMENT_NAME_LIMIT * 4),
    cwd: str(v.cwd, 'folder'),
    prompt: str(v.prompt, 'text', EXPERIMENT_PROMPT_LIMIT),
    base: str(v.base, 'branch', 200),
    attempts,
  };
}

export function taskInput(value: unknown): NewTasksInput {
  const v = (value && typeof value === 'object' ? value : {}) as Record<string, unknown>;
  if (!AGENT_PROFILE_IDS.includes(v.profile as never)) throw new UserError('error.unknownProfile');
  if (!Array.isArray(v.drafts) || v.drafts.length > TASKS_PER_PASTE_LIMIT) {
    throw new UserError('error.task.tooManyPaste', { max: TASKS_PER_PASTE_LIMIT });
  }
  const drafts = v.drafts.map((raw: unknown) => {
    const d = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>;
    const issue =
      d.issue && typeof d.issue === 'object' ? (d.issue as Record<string, unknown>) : null;
    const url = issue ? str(issue.url, 'url', 2000) : '';
    if (issue && !/^https?:\/\//.test(url)) {
      throw new UserError('error.invalidArgument', { name: { key: 'arg.url' } });
    }
    return {
      title: str(d.title, 'name', TASK_TITLE_LIMIT * 4),
      description: str(d.description ?? '', 'text', TASK_DESCRIPTION_LIMIT),
      ...(issue && { issue: { ref: str(issue.ref, 'name', 40), url } }),
    };
  });
  return {
    cwd: str(v.cwd, 'folder'),
    profile: v.profile as NewTasksInput['profile'],
    ...(typeof v.command === 'string' && v.command.trim() && { command: command(v.command) }),
    isolated: v.isolated !== false,
    base: str(v.base, 'branch', 200),
    ...(v.groupId != null && { groupId: str(v.groupId, 'group', 64) }),
    drafts,
  };
}
