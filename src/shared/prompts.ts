// Saved prompts: text the user sends to an agent again and again, with variables filled in at the
// moment of sending. They are only text, so they travel with the exported preferences.
import { translate, type Language, type MessageKey } from './i18n';
import { FIX_PROMPT_ID } from './checks';
import { REVIEW_PROMPT_ID } from './reviewer';
import { normalizeBinding } from './shortcuts';

export interface PromptTemplate {
  id: string;
  name: string;
  text: string;
  /** A key binding that opens this prompt, as in `src/shared/shortcuts.ts`. */
  shortcut?: string;
}

export const PROMPTS_LIMIT = 100;
export const PROMPT_NAME_LIMIT = 80;
export const PROMPT_TEXT_LIMIT = 20_000;
/** `{selecao}` is cut here: a whole file selected by mistake must not flood the agent. */
export const SELECTION_LIMIT = 20_000;
/** The same for `{problemas}`: a few hundred lines of errors. */
export const PROBLEMS_TEXT_LIMIT = 20_000;
/** What one send may put in the terminal, after the variables are filled in. */
export const SEND_TEXT_LIMIT = 60_000;
/** How many sessions one send may go to. */
export const SEND_TARGETS_LIMIT = 50;

const ID = /^[\w-]{1,40}$/;

/** The prompts that come with the app, worded in the language of the moment they are restored. */
const FACTORY: { id: string; name: MessageKey; text: MessageKey }[] = [
  { id: 'review-diff', name: 'prompts.factory.review.name', text: 'prompts.factory.review.text' },
  { id: 'write-tests', name: 'prompts.factory.tests.name', text: 'prompts.factory.tests.text' },
  { id: 'update-readme', name: 'prompts.factory.readme.name', text: 'prompts.factory.readme.text' },
  {
    id: REVIEW_PROMPT_ID,
    name: 'prompts.factory.reviewTurn.name',
    text: 'prompts.factory.reviewTurn.text',
  },
  {
    id: FIX_PROMPT_ID,
    name: 'prompts.factory.fixProblems.name',
    text: 'prompts.factory.fixProblems.text',
  },
];

export function factoryPrompts(language: Language): PromptTemplate[] {
  return FACTORY.map(({ id, name, text }) => ({
    id,
    name: translate(language, name),
    text: translate(language, text),
  }));
}

export const isFactoryPrompts = (prompts: readonly PromptTemplate[], language: Language) =>
  JSON.stringify(prompts) === JSON.stringify(factoryPrompts(language));

/**
 * A complete, valid list. Anything that is not a list (a file from before prompts existed) gives
 * the factory ones; a list, even an empty one, is what the user left.
 */
export function sanitizePrompts(
  value: unknown,
  language: Language,
  takenBindings: ReadonlySet<string> = new Set(),
): PromptTemplate[] {
  if (!Array.isArray(value)) return factoryPrompts(language);
  const prompts: PromptTemplate[] = [];
  const ids = new Set<string>();
  const bindings = new Set(takenBindings);
  for (const item of value) {
    if (prompts.length >= PROMPTS_LIMIT) break;
    const p = (item && typeof item === 'object' ? item : {}) as Record<string, unknown>;
    if (typeof p.id !== 'string' || !ID.test(p.id) || ids.has(p.id)) continue;
    if (typeof p.name !== 'string' || typeof p.text !== 'string') continue;
    const name = p.name.trim().slice(0, PROMPT_NAME_LIMIT);
    if (!name || p.text.length > PROMPT_TEXT_LIMIT) continue;
    const binding = normalizeBinding(p.shortcut);
    const shortcut = binding && !bindings.has(binding) ? binding : undefined;
    if (shortcut) bindings.add(shortcut);
    ids.add(p.id);
    prompts.push({ id: p.id, name, text: p.text, ...(shortcut && { shortcut }) });
  }
  return prompts;
}

/** An id that no prompt in the list has. */
export function newPromptId(prompts: readonly PromptTemplate[]): string {
  const ids = new Set(prompts.map((p) => p.id));
  let n = prompts.length + 1;
  while (ids.has(`prompt-${n}`)) n++;
  return `prompt-${n}`;
}

// `{name}` or `{?a question for the user}`. A brace with anything else inside is left alone, so
// code with braces in a prompt survives.
export const PROMPT_VARIABLE = /\{(\?[^{}\r\n]{1,200}|[\p{L}_][\p{L}\p{N}_]{0,40})\}/gu;

/** The `{?question}` fields of a prompt, in order of appearance and without repetition. */
export function promptQuestions(text: string): string[] {
  const questions: string[] = [];
  for (const match of text.matchAll(PROMPT_VARIABLE)) {
    const name = match[1]!;
    if (!name.startsWith('?')) continue;
    const question = name.slice(1).trim();
    if (question && !questions.includes(question)) questions.push(question);
  }
  return questions;
}

/** What the renderer knows of the moment a prompt is sent: the file open in the panel. */
export interface PromptValues {
  /** Path of the file open in the changes panel. */
  file?: string;
  /** Text selected in the editor of the panel. */
  selection?: string;
  /** The problems picked in the problems list, one per line; `{problemas}` in a prompt. */
  problems?: string;
  /** Answers to the `{?question}` fields, by the question's text. */
  answers?: Record<string, string>;
}

export interface SendTextOptions {
  /** Press Enter after the text. Off by default: the user reads it in the terminal and sends. */
  submit: boolean;
  /** Send even while the agent works, instead of waiting for the end of the turn. */
  now?: boolean;
}

/** How a send went for one session. */
export type SendOutcome = 'sent' | 'queued';

// ---- the queue of a session ------------------------------------------------------------------

/** When an item of the queue goes: at the end of the turn, or once the checks of it passed. */
export type QueueCondition = 'turnEnd' | 'checksPassed';

export const QUEUE_CONDITIONS: readonly QueueCondition[] = ['turnEnd', 'checksPassed'];

/** A prompt waiting in the queue of a session. Its variables are filled in when it goes. */
export interface QueueItem {
  id: string;
  text: string;
  values: PromptValues;
  condition: QueueCondition;
}

/**
 * Why the queue does not move by itself. With `paused`, the user has to resume it: `restored`
 * (the app was reopened), `checksFailed`, `noChecks` (an item asks for checks the folder does not
 * have), `sendFailed`, `exited` (the agent left). Without it, `agentAsks`: the agent asks
 * something, and the queue waits for the next end of turn.
 */
export type QueueBlock =
  'restored' | 'checksFailed' | 'noChecks' | 'sendFailed' | 'exited' | 'agentAsks';

export interface QueueState {
  items: QueueItem[];
  paused: boolean;
  blockedBy?: QueueBlock;
  /** The checks of the first item are running. */
  checking?: boolean;
  /** What went wrong with `sendFailed`, as the user reads it. */
  error?: string;
}

/** What the list of sessions shows of a queue. */
export interface QueueSummary {
  items: number;
  paused: boolean;
  blockedBy?: QueueBlock;
}

/** Items one queue may hold: a queue that runs by itself must not spend credits without end. */
export const QUEUE_LIMIT = 20;

/** What may change in an item of the queue. */
export interface QueueItemUpdate {
  text?: string;
  condition?: QueueCondition;
}
