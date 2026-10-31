import fs from 'node:fs';
import path from 'node:path';
import { expect, test } from '@playwright/test';
import { createSession, launch, removeDir, ROOT, runInTerminal, tempDir } from './harness';

const SEND_HOOK = path.join(ROOT, 'tests', 'fixtures', 'send-hook.cjs');

/** One answer of Claude Code as its conversation file records it. */
const answer = (id: string, context: number, output: number) =>
  JSON.stringify({
    type: 'assistant',
    isSidechain: false,
    message: {
      model: 'claude-opus-5-5',
      id,
      role: 'assistant',
      content: [{ type: 'text', text: 'ok' }],
      usage: {
        input_tokens: 10,
        cache_creation_input_tokens: 0,
        cache_read_input_tokens: context - 10 - output,
        output_tokens: output,
      },
    },
  }) + '\n';

test('the share of the context each session takes shows in the list, amber when nearly full', async () => {
  test.setTimeout(120_000);
  const userData = tempDir('ac-e2e-uso-');
  const folder = tempDir('ac-e2e-uso-pasta-');
  const transcript = path.join(folder, 'conversa.jsonl');
  const running = await launch(userData);
  const { page } = running;
  try {
    const id = await createSession(page, 'Com uso', folder);
    const badge = page.locator(
      `.session-item[data-session-id="${id}"] [data-testid="usage-badge"]`,
    );
    await expect(badge).toHaveCount(0);

    fs.writeFileSync(transcript, answer('msg_1', 380_000, 1200));
    await runInTerminal(page, id, `node "${SEND_HOOK}" Stop "${transcript}"`, 'hook Stop enviado');
    await expect(badge).toHaveText('38%');
    await expect(badge).not.toHaveClass(/high/);
    await expect(badge).toHaveAttribute('title', /380\s?mil|380K|380k/);

    fs.appendFileSync(transcript, answer('msg_2', 850_000, 800));
    await runInTerminal(page, id, `node "${SEND_HOOK}" Stop "${transcript}"`, 'hook Stop enviado');
    await expect(badge).toHaveText('85%');
    await expect(badge).toHaveClass(/high/);
  } finally {
    await running.close();
    removeDir(userData);
    removeDir(folder);
  }
});
