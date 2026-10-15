// Checks at the end of a turn, with the real agent: the agent ends a turn that changed a file, the
// checks of the project run and fail, the failure is pasted into the agent's prompt, the agent
// fixes it, and the checks pass. Run with `npm run test:smoke`. Environment, as in agents.smoke.ts,
// plus `SMOKE_COMMAND_CLAUDE_CODE` / `SMOKE_COMMAND_CODEX`: the command the agent runs through
// (an alias or function of the user's shell, such as `claude-personal`).
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { CheckService } from '@core/checks/CheckService';
import { failureReport } from '@core/checks/report';
import { sanitizeChecks, summarizeRun, type ChecksRun } from '@shared/checks';
import type { AgentProfileId } from '@shared/session';
import { AgentDriver, ENTER, sleep } from './driver';

const selected = (process.env.SMOKE_PROFILES ?? 'claude-code,codex')
  .split(',')
  .map((s) => s.trim());

const BUGGY = 'module.exports = (a, b) => a - b;\n';

/** A small project whose test fails until `soma.cjs` adds instead of subtracting. */
function prepare(cwd: string): void {
  const git = (...args: string[]) => execFileSync('git', args, { cwd, stdio: 'ignore' });
  fs.writeFileSync(
    path.join(cwd, 'package.json'),
    JSON.stringify({ name: 'smoke-checks', private: true, scripts: { test: 'node test.cjs' } }),
  );
  fs.writeFileSync(path.join(cwd, 'soma.cjs'), BUGGY);
  fs.writeFileSync(
    path.join(cwd, 'test.cjs'),
    [
      "const soma = require('./soma.cjs');",
      'const total = soma(2, 3);',
      "if (total !== 5) { console.error('soma(2, 3) deu ' + total + ', esperava 5'); process.exit(1); }",
      "console.log('teste: ok');",
      '',
    ].join('\n'),
  );
  if (!fs.existsSync(path.join(cwd, '.git'))) {
    git('init', '-q');
    git('config', 'user.email', 'smoke@example.com');
    git('config', 'user.name', 'Smoke');
    git('config', 'commit.gpgsign', 'false');
  }
  git('add', '-A');
  git('commit', '-q', '-m', 'projeto');
}

const PLANS: { id: AgentProfileId; args: string[] }[] = [
  // Edits in the folder without asking; anything else that asks is approved by the script.
  { id: 'claude-code', args: ['--permission-mode', 'acceptEdits'] },
  { id: 'codex', args: [] },
];

for (const plan of PLANS) {
  describe.skipIf(!selected.includes(plan.id))(`verificações com ${plan.id}`, () => {
    const driver = new AgentDriver(plan.id, plan.args, prepare);
    driver.reportSuffix = '-verificacoes';
    let available = false;
    let checks: CheckService;
    const runs: ChecksRun[] = [];

    /** Waits for the turn to end, approving whatever the agent asks permission for. */
    const finishTurn = async (from: number, timeoutMs = 420_000) => {
      // Codex may take an Enter that follows a burst of keys as part of them: a person who sees
      // the text still in the box presses Enter again.
      for (let attempt = 0; ; attempt++) {
        const started = await driver.waitFor('trabalhando', 6000, from).then(
          () => true,
          () => false,
        );
        if (started) break;
        if (attempt === 5) await driver.waitFor('trabalhando', 1, from);
        driver.send(ENTER);
      }
      const deadline = Date.now() + timeoutMs;
      let waitingSince = 0;
      while (Date.now() < deadline) {
        if (driver.events.slice(from).some((e) => e.state === 'terminou')) return;
        if (driver.state === 'aguardando') {
          waitingSince ||= Date.now();
          if (Date.now() - waitingSince > 2500) {
            driver.send(ENTER);
            waitingSince = 0;
          }
        } else waitingSince = 0;
        await sleep(500);
      }
      throw new Error(`o turno não terminou. Tela:\n${await driver.screen()}`);
    };
    /** The run that started after `since`, once it is over: the one before may still be shown. */
    const settled = async (since: number) => {
      const run = await (async () => {
        const deadline = Date.now() + 120_000;
        for (;;) {
          const current = checks.get(driver.id);
          const over = current?.state === 'done' || current?.state === 'cancelled';
          if (current && over && current.startedAt >= since) return current;
          if (Date.now() > deadline) throw new Error('as verificações não terminaram');
          await sleep(250);
        }
      })();
      runs.push(run);
      return run;
    };

    beforeAll(async () => {
      available = await driver.start();
      if (!available) return;
      checks = new CheckService({
        targetOf: () => ({
          cwd: driver.cwd,
          checks: sanitizeChecks([{ label: 'test', command: 'npm test' }]),
        }),
      });
      // The same wiring as the main process.
      driver.onTransition(({ session, previous }) => {
        const { state } = session.status;
        if (state === 'terminou' && previous.state !== 'terminou') {
          void checks.turnEnded(session.id);
        }
        if (state === 'trabalhando' && previous.state !== 'trabalhando') {
          checks.turnStarted(session.id);
        }
      });
      await driver.passStartupScreens();
    });

    afterAll(async () => {
      if (!available) return;
      checks.dispose();
      const { orphans } = await driver.stop();
      const file = driver.writeReport({
        command: driver.command || null,
        checks: runs.map((run) => ({
          ...summarizeRun(run),
          trigger: run.trigger,
          results: run.results,
        })),
        orphans,
      });
      console.log(`resultado registrado em ${file}`);
      expect(orphans, 'processos órfãos depois de fechar a sessão').toEqual([]);
    });

    it('o turno que muda um arquivo roda as verificações; o erro volta ao agente, que corrige', async ({
      skip,
    }) => {
      skip(!available, 'agente não instalado');
      const result = await driver.scenario('verificações ao fim do turno', async (mark) => {
        await driver.prompt(
          'Crie o arquivo NOTAS.md com uma única linha: "oi". Não altere nenhum outro arquivo e não rode nenhum comando.',
        );
        const firstTurn = Date.now();
        await finishTurn(mark);
        const failed = await settled(firstTurn);
        expect(failed.trigger).toBe('turnEnd');
        expect(summarizeRun(failed).state).toBe('failed');
        expect(failed.results[0]!.output).toContain('esperava 5');

        const report = failureReport(failed, 'pt-BR')!;
        // What the shell says about itself is text, not CLIXML in another code page.
        expect(report).not.toMatch(/CLIXML|<Objs|�/);

        // The paste waits at the prompt, as one message, until the user presses Enter.
        const fixing = driver.events.length;
        driver.paste(report);
        await sleep(2000);
        expect(driver.events.slice(fixing).map((e) => e.state)).not.toContain('trabalhando');
        expect(await driver.screen()).toContain('As verificações do projeto falharam');
        const secondTurn = Date.now();
        driver.send(ENTER);
        await finishTurn(fixing);
        const passed = await settled(secondTurn);
        expect(summarizeRun(passed).state).toBe('passed');
        expect(fs.readFileSync(path.join(driver.cwd, 'soma.cjs'), 'utf8')).not.toBe(BUGGY);
      });
      expect(result.error).toBeUndefined();
      // Two turns of a real agent: Codex took more than three minutes on the first one.
    }, 900_000);
  });
}
