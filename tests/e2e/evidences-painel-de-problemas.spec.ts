// The screens of the problems panel, to attach to the pull request, as in `evidences.spec.ts`:
//
//   EVIDENCES=1 npx playwright test --config tests/e2e/playwright.config.ts evidences-painel-de-problemas.spec.ts
//
// `EVIDENCES_PHASE=antes`, run on a build of the code as it was, takes the "before" of each pair:
// the same project and the same failing checks, seen through the dialog of the checks, which was
// the only way to read them.
import fs from 'node:fs';
import path from 'node:path';
import { expect, test } from '@playwright/test';
import { createSession, git, launch, makeRepo, removeDir, ROOT, tempDir } from './harness';

const PHASE = process.env.EVIDENCES_PHASE === 'antes' ? 'antes' : 'depois';
const OUT = process.env.EVIDENCES_DIR || path.join(ROOT, 'evidences', 'images');
const FOLDER = 'painel-de-problemas';

test.skip(process.env.EVIDENCES !== '1', 'só com EVIDENCES=1');

const FILES: Record<string, string[]> = {
  'src/core/sessions/SessionManager.ts': [
    "12,7@@error@@TS2322@@Type 'string' is not assignable to type 'number'.",
    "48,3@@error@@TS2304@@Cannot find name 'closeAll'.",
    "73,15@@error@@TS2551@@Property 'sesion' does not exist on type 'Session'. Did you mean 'session'?",
  ],
  'src/core/git/ChangesService.ts': [
    "9,1@@error@@TS6133@@'path' is declared but its value is never read.",
    "31,22@@error@@TS2345@@Argument of type 'string | undefined' is not assignable to parameter of type 'string'.",
  ],
  'src/main/ipc.ts': [
    "55,10@@error@@TS2339@@Property 'problems' does not exist on type 'CheckResult'.",
  ],
  'src/renderer/src/App.tsx': [
    "20,5@@error@@TS2322@@Type 'number' is not assignable to type 'string'.",
    "64,12@@error@@TS7006@@Parameter 'problem' implicitly has an 'any' type.",
  ],
};

const body = (name: string) =>
  [
    `// ${name}`,
    ...Array.from(
      { length: 90 },
      (_, i) => `export const valor${i + 1} = ${i + 1}; // linha ${i + 1}`,
    ),
    '',
  ].join('\n');

/** A project whose typecheck prints what tsc prints, for several files, and whose lint warns. */
function makeProject(): string {
  const repo = makeRepo();
  const out: string[] = [];
  for (const [file, problems] of Object.entries(FILES)) {
    fs.mkdirSync(path.dirname(path.join(repo, file)), { recursive: true });
    fs.writeFileSync(path.join(repo, file), body(file));
    for (const problem of problems) {
      const [position, severity, code, message] = problem.split('@@');
      out.push(`${file}(${position}): ${severity} ${code}: ${message}`);
    }
  }
  out.push('', `Found ${out.length - 1} errors in ${Object.keys(FILES).length} files.`);
  fs.writeFileSync(
    path.join(repo, 'typecheck.cjs'),
    `console.log(${JSON.stringify(out.join('\n'))});\nprocess.exit(2);\n`,
  );
  fs.writeFileSync(
    path.join(repo, 'lint.cjs'),
    "console.log('src/main/ipc.ts:80:1: warning: função sem uso');\nprocess.exit(1);\n",
  );
  git(repo, 'add', '-A');
  git(repo, 'commit', '-q', '-m', 'projeto');
  return repo;
}

test('evidences: problems panel', async () => {
  test.setTimeout(180_000);
  const userData = tempDir('ac-evid-data-');
  const repo = makeProject();
  const running = await launch(userData);
  const { page } = running;
  const shot = async (name: string) => {
    fs.mkdirSync(path.join(OUT, FOLDER), { recursive: true });
    await page.waitForTimeout(800);
    await page.screenshot({ path: path.join(OUT, FOLDER, `${name}-${PHASE}.png`) });
  };

  try {
    const id = await createSession(page, 'agent-controller', repo);
    await page.evaluate(
      (sid) =>
        window.api.invoke('checks:configure', sid, [
          {
            id: 'typecheck',
            label: 'typecheck',
            command: 'node typecheck.cjs',
            timeoutSec: 60,
            onTurnEnd: false,
          },
          { id: 'lint', label: 'lint', command: 'node lint.cjs', timeoutSec: 60, onTurnEnd: false },
        ]),
      id,
    );
    await page.evaluate((sid) => window.api.invoke('checks:run', sid), id);
    await expect(page.getByTestId('checks-badge').first()).toHaveAttribute(
      'data-checks',
      'failed',
      {
        timeout: 60_000,
      },
    );

    // 1. The errors of the run: a block of output in a dialog, or a list by file with the
    // editor open on the line of the first one.
    if (PHASE === 'depois') {
      await page.keyboard.press('Control+Shift+P');
      await page
        .getByRole('dialog', { name: 'Paleta de comandos' })
        .getByRole('option', { name: /^Problemas: ver os erros/ })
        .click();
      const rows = page.getByTestId('problem-row');
      await expect(rows).toHaveCount(9);
      await rows.nth(0).getByTestId('problem-open').click();
      const frame = page.frameLocator('[data-testid="diff-frame"]');
      await frame.locator('body[data-reveal-line="12"]').waitFor({ timeout: 20_000 });
      await frame.locator('.squiggly-error').first().waitFor();
    } else {
      await page
        .locator('.session-header')
        .getByRole('button', { name: /^Verificações/ })
        .click();
      await expect(page.getByTestId('checks-run')).toContainText('typecheck');
    }
    await shot('01-lista-de-erros');

    // 2. Sending only two of them to the agent: the whole block of output, or the two ticked.
    if (PHASE === 'depois') {
      const rows = page.getByTestId('problem-row');
      await rows.nth(0).getByTestId('problem-mark').check();
      await rows.nth(3).getByTestId('problem-mark').check();
      await page.getByTestId('problems-send-marked').click();
      await expect(page.getByTestId('prompt-preview')).toContainText('ChangesService.ts');
    } else {
      await page.getByRole('button', { name: 'Mandar o erro ao agente' }).click();
      await page.waitForTimeout(500);
    }
    await shot('02-mandar-ao-agente');
  } finally {
    await running.close();
    removeDir(userData);
    removeDir(repo);
  }
});
