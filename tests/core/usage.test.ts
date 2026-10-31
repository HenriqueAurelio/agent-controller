import fs from 'node:fs';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  claudeContextWindow,
  claudeUsageReader,
  codexUsageReader,
  findCodexRollout,
} from '@core/agents/usage';
import { TranscriptTail } from '@core/sessions/TranscriptTail';
import { UsageTracker } from '@core/sessions/UsageTracker';
import { removeDir, tempDir, waitFor } from './helpers';

// The shapes below were copied from files written by Claude Code 2.1 and Codex 0.163.
const claudeLine = (
  id: string,
  usage: Record<string, number>,
  extra: Record<string, unknown> = {},
) =>
  JSON.stringify({
    type: 'assistant',
    isSidechain: false,
    message: { model: 'claude-opus-5-5', id, role: 'assistant', content: [], usage },
    ...extra,
  });

const codexTokens = (total: Record<string, number>, last: Record<string, number>, used = 10) =>
  JSON.stringify({
    type: 'event_msg',
    payload: {
      type: 'token_count',
      info: { total_token_usage: total, last_token_usage: last, model_context_window: 258400 },
      rate_limits: { primary: { used_percent: used, window_minutes: 10080 } },
    },
  });

describe('claudeUsageReader', () => {
  it('counts each answer once, and takes the context from the last one', () => {
    const reader = claudeUsageReader();
    const first = {
      input_tokens: 2,
      cache_creation_input_tokens: 19720,
      cache_read_input_tokens: 23673,
      output_tokens: 318,
    };
    // One line per content block, all with the same message and usage.
    reader.line(claudeLine('msg_1', first));
    reader.line(claudeLine('msg_1', first));
    reader.line(JSON.stringify({ type: 'user', message: { role: 'user', content: 'oi' } }));
    reader.line(
      claudeLine('msg_2', {
        input_tokens: 5,
        cache_creation_input_tokens: 100,
        cache_read_input_tokens: 43393,
        output_tokens: 50,
      }),
    );
    expect(reader.snapshot()).toEqual({
      inputTokens: 2 + 19720 + 5 + 100,
      cacheReadTokens: 23673 + 43393,
      outputTokens: 318 + 50,
      contextTokens: 5 + 100 + 43393 + 50,
      contextWindow: 1_000_000,
      model: 'claude-opus-5-5',
      planUsedPct: null,
    });
  });

  it('leaves out subagents and lines it cannot read', () => {
    const reader = claudeUsageReader();
    reader.line(
      claudeLine('msg_9', { input_tokens: 10, output_tokens: 10 }, { isSidechain: true }),
    );
    reader.line('{"type":"assistant","message":{"usage":');
    expect(reader.snapshot()).toBeNull();
  });

  it('knows the context window of current and older models', () => {
    expect(claudeContextWindow('claude-sonnet-5-5')).toBe(1_000_000);
    expect(claudeContextWindow('claude-opus-4-6')).toBe(1_000_000);
    expect(claudeContextWindow('claude-haiku-4-5')).toBe(200_000);
    expect(claudeContextWindow('claude-sonnet-4-5[1m]')).toBe(1_000_000);
    expect(claudeContextWindow('gpt-5')).toBeNull();
  });
});

describe('codexUsageReader', () => {
  it('reads running totals, the last request, the window and the plan', () => {
    const reader = codexUsageReader();
    reader.line(JSON.stringify({ type: 'turn_context', payload: { model: 'gpt-5.6-terra' } }));
    reader.line(
      codexTokens(
        {
          input_tokens: 41441,
          cached_input_tokens: 30208,
          output_tokens: 327,
          total_tokens: 41768,
        },
        {
          input_tokens: 21490,
          cached_input_tokens: 19200,
          output_tokens: 130,
          total_tokens: 21620,
        },
        12,
      ),
    );
    expect(reader.snapshot()).toEqual({
      inputTokens: 41441 - 30208,
      cacheReadTokens: 30208,
      outputTokens: 327,
      contextTokens: 21620,
      contextWindow: 258400,
      model: 'gpt-5.6-terra',
      planUsedPct: 12,
    });
  });
});

describe('TranscriptTail', () => {
  let dir: string;
  beforeEach(() => (dir = tempDir()));
  afterEach(() => removeDir(dir));

  it('hands over whole lines only, from where it stopped', async () => {
    const file = path.join(dir, 'conversa.jsonl');
    const lines: string[] = [];
    const tail = new TranscriptTail(file, (line) => lines.push(line));
    expect(await tail.read()).toBe(false); // Not there yet.

    fs.writeFileSync(file, 'um\ndo');
    await tail.read();
    expect(lines).toEqual(['um']);
    fs.appendFileSync(file, 'is\ntrês\n');
    await tail.read();
    expect(lines).toEqual(['um', 'dois', 'três']);
  });

  it('keeps a character split between two writes whole', async () => {
    const file = path.join(dir, 'conversa.jsonl');
    const lines: string[] = [];
    const tail = new TranscriptTail(file, (line) => lines.push(line));
    const bytes = Buffer.from('ação\n');
    fs.writeFileSync(file, bytes.subarray(0, 2)); // Cuts the "ç" in half.
    await tail.read();
    fs.appendFileSync(file, bytes.subarray(2));
    await tail.read();
    expect(lines).toEqual(['ação']);
  });

  it('starts over when the file is replaced by a shorter one', async () => {
    const file = path.join(dir, 'conversa.jsonl');
    const lines: string[] = [];
    const tail = new TranscriptTail(file, (line) => lines.push(line));
    fs.writeFileSync(file, 'uma linha longa\n');
    await tail.read();
    fs.writeFileSync(file, 'nova\n');
    await tail.read();
    expect(lines).toEqual(['uma linha longa', 'nova']);
  });
});

describe('UsageTracker', () => {
  let dir: string;
  beforeEach(() => (dir = tempDir()));
  afterEach(() => removeDir(dir));

  it('reports usage when the file grows, and not again when nothing changed', async () => {
    const file = path.join(dir, 'conversa.jsonl');
    fs.writeFileSync(file, claudeLine('msg_1', { input_tokens: 10, output_tokens: 5 }) + '\n');
    const tracker = new UsageTracker();
    const reports: number[] = [];
    tracker.on('usage', (_id, usage) => reports.push(usage.outputTokens));
    tracker.track('s1', file, claudeUsageReader());
    await waitFor(() => reports.length === 1);
    await tracker.poke('s1');
    expect(reports).toEqual([5]);

    fs.appendFileSync(file, claudeLine('msg_2', { input_tokens: 10, output_tokens: 7 }) + '\n');
    await tracker.poke('s1');
    expect(reports).toEqual([5, 12]);
    expect(tracker.usageOf('s1')?.outputTokens).toBe(12);
    tracker.dispose();
  });
});

describe('findCodexRollout', () => {
  let home: string;
  beforeEach(() => (home = tempDir()));
  afterEach(() => removeDir(home));

  it('finds the rollout of a thread in the recent day folders', async () => {
    const id = '01a1542c-d9cd-75a2-b961-f4ade0a63cdc';
    const day = path.join(home, 'sessions', '2026', '10', '19');
    fs.mkdirSync(day, { recursive: true });
    const file = path.join(day, `rollout-2026-10-19T09-39-48-${id}.jsonl`);
    fs.writeFileSync(file, '');
    expect(await findCodexRollout(id, home)).toBe(file);
    expect(await findCodexRollout('01a1542c-0000-0000-0000-000000000000', home)).toBeNull();
    expect(await findCodexRollout('../../etc', home)).toBeNull();
  });
});
