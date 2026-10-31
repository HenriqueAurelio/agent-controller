import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import type { SessionUsage } from '@shared/session';
import { asRecord } from './adapter';

/**
 * Reads the conversation file an agent writes (one JSON object per line) and keeps what it says
 * about tokens and context. Fed line by line, from the start of the file or from where the last
 * read stopped; never holds the lines themselves.
 */
export interface UsageReader {
  line(text: string): void;
  /** What is known so far; null until the first line with usage. */
  snapshot(): SessionUsage | null;
}

const num = (value: unknown): number => (typeof value === 'number' && value >= 0 ? value : 0);

function parse(text: string): Record<string, unknown> | null {
  // Cheap filter first: most lines are messages and tool output with no usage at all.
  if (!text.includes('usage') && !text.includes('token_count')) return null;
  return safeParse(text);
}

/**
 * The context window of a Claude model. Current models take 1M tokens; older ones, 200K. A
 * model name not recognised gives null, and the context share is not shown.
 */
export function claudeContextWindow(model: string): number | null {
  const id = model.toLowerCase();
  if (/\[1m\]/.test(id)) return 1_000_000;
  if (!id.startsWith('claude-')) return null;
  if (/^claude-(fable|mythos)-/.test(id)) return 1_000_000;
  if (/^claude-(opus|sonnet|haiku)-5/.test(id)) return 1_000_000;
  if (/^claude-(opus|sonnet)-4-[6-9]/.test(id)) return 1_000_000;
  if (/^claude-(opus|sonnet|haiku)-[34]/.test(id)) return 200_000;
  return null;
}

/**
 * Claude Code's transcript (`~/.claude/projects/<folder>/<session>.jsonl`). Each content block of
 * an answer is a line of its own, all carrying the same `message.id` and the same `usage`, so a
 * message counts once. Lines of subagents (`isSidechain`) do not fill this context.
 */
export function claudeUsageReader(): UsageReader {
  const seen = new Set<string>();
  let usage: SessionUsage | null = null;
  return {
    line(text) {
      const record = parse(text);
      if (!record || record.type !== 'assistant' || record.isSidechain === true) return;
      const message = asRecord(record.message);
      const raw = asRecord(message.usage);
      if (!('input_tokens' in raw)) return;
      const id = typeof message.id === 'string' ? message.id : null;
      if (id && seen.has(id)) return;
      if (id) seen.add(id);
      const fresh = num(raw.input_tokens) + num(raw.cache_creation_input_tokens);
      const cached = num(raw.cache_read_input_tokens);
      const output = num(raw.output_tokens);
      const model = typeof message.model === 'string' ? message.model : (usage?.model ?? null);
      usage = {
        inputTokens: (usage?.inputTokens ?? 0) + fresh,
        cacheReadTokens: (usage?.cacheReadTokens ?? 0) + cached,
        outputTokens: (usage?.outputTokens ?? 0) + output,
        // What the model read to write this answer is what the conversation takes up now.
        contextTokens: fresh + cached + output,
        contextWindow: model ? claudeContextWindow(model) : null,
        model,
        planUsedPct: null,
      };
    },
    snapshot: () => usage,
  };
}

/**
 * Codex's rollout (`~/.codex/sessions/<y>/<m>/<d>/rollout-…-<id>.jsonl`). Its `token_count`
 * events carry running totals, the last request, the context window and the plan's limits.
 */
export function codexUsageReader(): UsageReader {
  let usage: SessionUsage | null = null;
  let model: string | null = null;
  return {
    line(text) {
      if (text.includes('"turn_context"')) {
        const payload = asRecord(safeParse(text)?.payload);
        if (typeof payload.model === 'string') model = payload.model;
        return;
      }
      const record = parse(text);
      const payload = asRecord(record?.payload);
      if (payload.type !== 'token_count') return;
      const info = asRecord(payload.info);
      const total = asRecord(info.total_token_usage);
      if (!('input_tokens' in total)) return;
      const last = asRecord(info.last_token_usage);
      const cached = num(total.cached_input_tokens);
      const primary = asRecord(asRecord(payload.rate_limits).primary);
      const window = num(info.model_context_window);
      usage = {
        inputTokens: Math.max(0, num(total.input_tokens) - cached),
        cacheReadTokens: cached,
        outputTokens: num(total.output_tokens),
        contextTokens: num(last.total_tokens),
        contextWindow: window || null,
        model,
        planUsedPct: typeof primary.used_percent === 'number' ? primary.used_percent : null,
      };
    },
    snapshot: () => usage,
  };
}

/** Day folders searched for a rollout, newest first: a session open for days is still found. */
const ROLLOUT_DAYS = 7;

/**
 * The rollout file of a Codex thread: `<CODEX_HOME>/sessions/<y>/<m>/<d>/rollout-…-<id>.jsonl`,
 * searched in the most recent day folders. Null when it is not there (yet).
 */
export async function findCodexRollout(
  threadId: string,
  home = process.env.CODEX_HOME || path.join(os.homedir(), '.codex'),
): Promise<string | null> {
  if (!/^[0-9a-f-]{8,64}$/i.test(threadId)) return null;
  const root = path.join(home, 'sessions');
  const newest = async (dir: string) =>
    (await fs.readdir(dir).catch(() => [] as string[]))
      .filter((n) => /^\d+$/.test(n))
      .sort()
      .reverse();
  const days: string[] = [];
  for (const year of await newest(root)) {
    for (const month of await newest(path.join(root, year))) {
      for (const day of await newest(path.join(root, year, month))) {
        days.push(path.join(root, year, month, day));
        if (days.length >= ROLLOUT_DAYS) break;
      }
      if (days.length >= ROLLOUT_DAYS) break;
    }
    if (days.length >= ROLLOUT_DAYS) break;
  }
  const suffix = `-${threadId.toLowerCase()}.jsonl`;
  for (const dir of days) {
    const names = await fs.readdir(dir).catch(() => [] as string[]);
    const found = names.find((n) => n.startsWith('rollout-') && n.toLowerCase().endsWith(suffix));
    if (found) return path.join(dir, found);
  }
  return null;
}

function safeParse(text: string): Record<string, unknown> | null {
  try {
    return asRecord(JSON.parse(text));
  } catch {
    // A line cut by a write in progress, or not JSON: skipped.
    return null;
  }
}
