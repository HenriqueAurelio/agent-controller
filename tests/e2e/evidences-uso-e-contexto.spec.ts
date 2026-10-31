// The share of the context each session takes, in the list, photographed before and after. It
// only runs when asked:
//
//   EVIDENCES=1 npx playwright test --config tests/e2e/playwright.config.ts evidences-uso-e-contexto.spec.ts
//
// `EVIDENCES_PHASE=antes`, run on a build of the code as it was, takes the "before".
import fs from 'node:fs';
import path from 'node:path';
import { expect, test } from '@playwright/test';
import { createSession, launch, removeDir, ROOT, runInTerminal, tempDir } from './harness';

const PHASE = process.env.EVIDENCES_PHASE === 'antes' ? 'antes' : 'depois';
const OUT = path.join(
  process.env.EVIDENCES_DIR || path.join(ROOT, 'evidences', 'images'),
  'uso-e-contexto',
);
const SEND_HOOK = path.join(ROOT, 'tests', 'fixtures', 'send-hook.cjs');

test.skip(process.env.EVIDENCES !== '1', 'só com EVIDENCES=1');

/** A conversation file whose last answer takes `context` tokens of a 1M window. */
function transcript(dir: string, context: number, output: number): string {
  const file = path.join(dir, 'conversa.jsonl');
  const usage = {
    input_tokens: 10,
    cache_creation_input_tokens: 0,
    cache_read_input_tokens: context - 10 - output,
    output_tokens: output,
  };
  fs.writeFileSync(
    file,
    JSON.stringify({
      type: 'assistant',
      message: { id: 'msg_1', model: 'claude-opus-5-5', role: 'assistant', content: [], usage },
    }) + '\n',
  );
  return file;
}

test('evidences: context and tokens of each session', async () => {
  test.setTimeout(180_000);
  const userData = tempDir('ac-evid-data-');
  const folders = ['api', 'web', 'docs'].map((name) => tempDir(`ac-${name}-`));
  const running = await launch(userData);
  const { page } = running;
  try {
    const sessions = [
      { name: 'API', context: 124_000, output: 3_400 },
      { name: 'Web', context: 630_000, output: 18_200 },
      { name: 'Docs', context: 912_000, output: 41_700 },
    ];
    for (const [i, s] of sessions.entries()) {
      const folder = folders[i]!;
      const id = await createSession(page, s.name, folder);
      const file = transcript(folder, s.context, s.output);
      await runInTerminal(page, id, `node "${SEND_HOOK}" Stop "${file}"`, 'hook Stop enviado');
    }
    if (PHASE === 'depois') {
      await expect(page.getByTestId('usage-badge')).toHaveCount(3);
      await expect(page.locator('.usage-badge.high')).toHaveText('91%');
    }
    fs.mkdirSync(OUT, { recursive: true });
    await page
      .locator('.sidebar')
      .screenshot({ path: path.join(OUT, `01-contexto-na-lista-${PHASE}.png`) });
  } finally {
    await running.close();
    removeDir(userData);
    for (const folder of folders) removeDir(folder);
  }
});
