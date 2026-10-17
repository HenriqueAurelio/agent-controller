// The screens of the overview, to attach to the pull request, as in `evidences.spec.ts`:
//
//   EVIDENCES=1 npx playwright test --config tests/e2e/playwright.config.ts evidences-painel-geral.spec.ts
//
// `EVIDENCES_PHASE=antes`, run on a build of the code as it was, takes the "before" of each pair:
// there was no overview, so each "before" is what the user had instead, the list and one terminal.
// The fake agent that asks permission is `tests/fixtures/permission-menu.cjs`: copy it along.
import fs from 'node:fs';
import path from 'node:path';
import { expect, test, type Page } from '@playwright/test';
import {
  createSession,
  git,
  launch,
  removeDir,
  ROOT,
  screenText,
  setTitle,
  tempDir,
} from './harness';

const PHASE = process.env.EVIDENCES_PHASE === 'antes' ? 'antes' : 'depois';
const AFTER = PHASE === 'depois';
const OUT = process.env.EVIDENCES_DIR || path.join(ROOT, 'evidences', 'images');
const FOLDER = 'painel-geral';
const MENU = path.join(ROOT, 'tests', 'fixtures', 'permission-menu.cjs');

test.skip(process.env.EVIDENCES !== '1', 'só com EVIDENCES=1');

const row = (page: Page, id: string) => page.locator(`.session-item[data-session-id="${id}"]`);

interface Plan {
  name: string;
  branch: string;
  /** What the "agent" printed, one line each. */
  lines: string[];
  /** Files changed in its folder. */
  changed: number;
  end: 'working' | 'done' | 'asks';
  ask?: string;
}

const API: Plan[] = [
  {
    name: 'refatorar-ipc',
    branch: 'refatorar-ipc',
    lines: [
      'Lendo src/main/ipc.ts',
      'Extraindo os validadores para shared',
      'Rodando npm run typecheck',
    ],
    changed: 3,
    end: 'working',
  },
  {
    name: 'migracao-db',
    branch: 'migracao-db',
    lines: ['Criei a migration 0042 com a tabela pedidos', 'Falta rodar contra o banco local'],
    changed: 2,
    end: 'asks',
    ask: 'Bash npm run db:migrate',
  },
  {
    name: 'testes-e2e',
    branch: 'testes-e2e',
    lines: ['12 testes passaram', 'Cobri o fluxo de login e o de logout', 'Pronto para revisar'],
    changed: 4,
    end: 'done',
  },
  {
    name: 'docs-api',
    branch: 'main',
    lines: ['Atualizei o README com os endpoints novos'],
    changed: 1,
    end: 'done',
  },
];
const WEB: Plan[] = [
  {
    name: 'carrinho',
    branch: 'carrinho-persistente',
    lines: ['Editando src/cart/store.ts', 'Guardando o carrinho no localStorage'],
    changed: 2,
    end: 'working',
  },
  {
    name: 'checkout',
    branch: 'checkout-pix',
    lines: ['Vou instalar a biblioteca do Pix', 'Isso muda o package.json'],
    changed: 1,
    end: 'asks',
    ask: 'Bash npm install pix-utils',
  },
  {
    name: 'tema-escuro',
    branch: 'tema-escuro',
    lines: ['Troquei as cores fixas por variaveis CSS', 'Conferi o contraste das 14 telas'],
    changed: 6,
    end: 'done',
  },
  {
    name: 'acessibilidade',
    branch: 'a11y',
    lines: ['Revisando os rotulos dos botoes'],
    changed: 0,
    end: 'working',
  },
];

test('evidences: overview', async () => {
  test.setTimeout(300_000);
  const userData = tempDir('ac-evid-data-');
  // A short, stable path: it is in the pictures.
  const base = tempDir('ac-');
  const running = await launch(userData);
  const { page } = running;
  const shot = async (name: string) => {
    fs.mkdirSync(path.join(OUT, FOLDER), { recursive: true });
    await page.waitForTimeout(1500);
    await page.screenshot({ path: path.join(OUT, FOLDER, `${name}-${PHASE}.png`) });
  };

  const repo = (plan: Plan) => {
    const dir = path.join(base, plan.name);
    fs.mkdirSync(dir);
    git(dir, 'init', '-q', '-b', plan.branch);
    git(dir, 'config', 'user.email', 'e2e@example.com');
    git(dir, 'config', 'user.name', 'E2E');
    git(dir, 'config', 'commit.gpgsign', 'false');
    fs.writeFileSync(path.join(dir, 'README.md'), `# ${plan.name}\n`);
    git(dir, 'add', '-A');
    git(dir, 'commit', '-q', '-m', 'inicio');
    for (let i = 1; i <= plan.changed; i++)
      fs.writeFileSync(path.join(dir, `mudanca-${i}.ts`), '1\n');
    return dir;
  };

  const ids = new Map<string, string>();
  const run = async (plan: Plan) => {
    const id = await createSession(page, plan.name, repo(plan));
    ids.set(plan.name, id);
    await page.waitForTimeout(800);
    await page.locator('.terminal-host.visible').click();
    // A short prompt, and a clean screen: the cards show what the "agent" said, not the shell.
    if (process.platform === 'win32') {
      await page.keyboard.type('prompt $G$S');
      await page.keyboard.press('Enter');
    }
    // The state first: the command that sets it is then wiped off the screen.
    if (plan.end === 'working' || plan.end === 'done') {
      await setTitle(page, `◐ ${plan.name}`);
      await expect(row(page, id)).toHaveAttribute('data-state', 'trabalhando', { timeout: 15_000 });
    }
    if (plan.end === 'done') {
      await setTitle(page, '✳ pronto');
      await expect(row(page, id)).toHaveAttribute('data-state', 'terminou', { timeout: 15_000 });
    }
    const clear = process.platform === 'win32' ? 'cls' : 'clear';
    await page.keyboard.type([clear, ...plan.lines.map((line) => `echo ${line}`)].join(' && '));
    await page.keyboard.press('Enter');
    await expect
      .poll(() => screenText(page, id), { timeout: 20_000 })
      .toContain(plan.lines.at(-1)!);
    if (plan.end === 'asks') {
      await page.keyboard.type(`node "${MENU}" ${plan.ask}`);
      await page.keyboard.press('Enter');
      await expect
        .poll(() => screenText(page, id), { timeout: 20_000 })
        .toContain('Do you want to proceed?');
      await expect(row(page, id)).toHaveAttribute('data-state', 'aguardando');
    }
    return id;
  };

  try {
    // A real agent at work keeps writing; this one goes quiet, which would read as "possibly
    // waiting" before the pictures are taken.
    await page.evaluate(() => window.api.invoke('prefs:set', { silenceSeconds: 600 }));
    const apiIds = [];
    for (const plan of API) apiIds.push(await run(plan));
    const webIds = [];
    for (const plan of WEB) webIds.push(await run(plan));
    await page.evaluate((list) => window.api.invoke('groups:create', 'loja-api', list), apiIds);
    await page.evaluate((list) => window.api.invoke('groups:create', 'loja-web', list), webIds);
    await row(page, ids.get('docs-api')!).click();

    // 1. Eight sessions in two groups. Before: the list says who needs the user, but to see what
    // each one is doing a session has to be opened. After: every one in a card, with the state,
    // how long, the last lines, the branch, the changes and the permission asked.
    if (AFTER) {
      await page.keyboard.press('Control+Shift+O');
      await expect(page.getByTestId('overview').locator('.overview-card')).toHaveCount(8);
      await expect(page.getByTestId('overview').getByTestId('permission-ask')).toHaveCount(2);
    }
    await shot('01-oito-sessoes');

    // 2. Only the ones waiting for the user. Before: one of them opened, the other still unseen.
    // After: the filter "Aguardando você", both with what they ask and ✓/✕.
    if (AFTER) {
      await page
        .getByTestId('overview')
        .getByRole('radio', { name: /Aguardando você/ })
        .click();
      await expect(page.getByTestId('overview').locator('.overview-card')).toHaveCount(2);
    } else {
      await row(page, ids.get('migracao-db')!).click();
    }
    await shot('02-so-aguardando');
  } finally {
    await running.close();
    removeDir(userData);
    removeDir(base);
  }
});
