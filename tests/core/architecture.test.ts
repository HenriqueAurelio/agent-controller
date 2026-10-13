import path from 'node:path';
import { ESLint } from 'eslint';
import { describe, expect, it } from 'vitest';

const ROOT = path.resolve(__dirname, '../..');

async function lint(code: string, file: string): Promise<string[]> {
  const eslint = new ESLint({ cwd: ROOT });
  const [result] = await eslint.lintText(code, { filePath: path.join(ROOT, file) });
  return result!.messages.map((m) => `${m.ruleId}: ${m.message}`);
}

describe('architecture rules enforced by lint', { timeout: 120000 }, () => {
  it('src/core cannot import electron', async () => {
    const messages = await lint(
      "import { app } from 'electron';\nexport const x = app;\n",
      'src/core/pty/exemplo.ts',
    );
    expect(messages.join('\n')).toMatch(
      /no-restricted-imports: .*src\/core não pode importar electron/,
    );
  });

  it('src/core cannot reach into the Electron layers', async () => {
    const messages = await lint(
      "import { x } from '../../main/index';\nexport const y = x;\n",
      'src/core/pty/exemplo.ts',
    );
    expect(messages.join('\n')).toMatch(/no-restricted-imports/);
  });

  it('the renderer cannot import Node or the core', async () => {
    for (const source of ['node:fs', 'electron', '@core/pty/PtyManager']) {
      const messages = await lint(
        `import * as x from '${source}';\nexport const y = x;\n`,
        'src/renderer/src/exemplo.ts',
      );
      expect(messages.join('\n'), source).toMatch(/no-restricted-imports/);
    }
  });

  it('the same imports are fine where they belong', async () => {
    const messages = await lint(
      "import { app } from 'electron';\nexport const x = app;\n",
      'src/main/exemplo.ts',
    );
    expect(messages).toEqual([]);
  });
});
