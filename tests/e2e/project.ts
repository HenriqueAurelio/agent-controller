// A project with checks to run, and a stand-in for an agent's turn: shared by the checks tests
// and the evidences.
import fs from 'node:fs';
import path from 'node:path';
import { expect, type Page } from '@playwright/test';
import { git, makeRepo } from './harness';

/**
 * A project with a lint that passes and a test that fails until `soma.cjs` is fixed, and a stand-in
 * for an agent's turn: the window titles Claude Code sets while it works and when it stops, with a
 * file written in between.
 */
export function makeProject(): string {
  const repo = makeRepo();
  fs.writeFileSync(
    path.join(repo, 'package.json'),
    JSON.stringify(
      {
        name: 'projeto',
        private: true,
        scripts: { lint: 'node lint.cjs', test: 'node test.cjs', build: 'node build.cjs' },
      },
      null,
      2,
    ),
  );
  fs.writeFileSync(path.join(repo, 'lint.cjs'), "console.log('lint: nenhum problema');\n");
  fs.writeFileSync(path.join(repo, 'soma.cjs'), 'module.exports = (a, b) => a - b;\n');
  fs.writeFileSync(
    path.join(repo, 'test.cjs'),
    [
      "const soma = require('./soma.cjs');",
      'const total = soma(2, 3);',
      "if (total !== 5) { console.error('soma(2, 3) deu ' + total + ', esperava 5'); process.exit(1); }",
      "console.log('teste: ok');",
      '',
    ].join('\n'),
  );
  fs.writeFileSync(
    path.join(repo, 'turno.cjs'),
    `const fs = require('fs');
     const title = (t) => process.stdout.write('\\x1b]0;' + t + '\\x07');
     const timer = setInterval(() => title('◐ tarefa'), 80);
     setTimeout(() => {
       fs.writeFileSync('nota.txt', 'turno ' + Date.now() + '\\n');
       clearInterval(timer);
       title('✳ tarefa');
     }, 2500);`,
  );
  git(repo, 'add', '-A');
  git(repo, 'commit', '-q', '-m', 'projeto');
  return repo;
}

export async function turn(page: Page, sessionId: string) {
  await page.locator('.terminal-host.visible').click();
  await page.keyboard.type('node turno.cjs');
  await page.keyboard.press('Enter');
  const item = page.locator(`.session-item[data-session-id="${sessionId}"]`);
  await expect(item).toHaveAttribute('data-state', 'trabalhando');
  await expect(item).toHaveAttribute('data-state', 'terminou', { timeout: 15_000 });
}

export async function configureSuggested(page: Page) {
  await page
    .locator('.session-header')
    .getByRole('button', { name: /^Verificações/ })
    .click();
  const dialog = page.getByRole('dialog', { name: 'Verificações' });
  await dialog.getByRole('button', { name: '+ npm run lint' }).click();
  await dialog.getByRole('button', { name: '+ npm test' }).click();
  await dialog.getByRole('button', { name: 'Salvar' }).click();
  await expect(dialog.getByRole('status')).toHaveText('Salvo.');
  return dialog;
}
