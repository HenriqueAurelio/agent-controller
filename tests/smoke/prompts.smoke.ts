// Saved prompts, with the real agent: a prompt of three lines reaches it as one message, and a
// prompt sent while it works waits for the end of the turn. Run with `npm run test:smoke`, with
// the same environment as checks.smoke.ts (`SMOKE_PROFILES`, `SMOKE_COMMAND_CLAUDE_CODE`, ...).
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { AgentProfileId } from '@shared/session';
import { AgentDriver, sleep } from './driver';

const selected = (process.env.SMOKE_PROFILES ?? 'claude-code,codex')
  .split(',')
  .map((s) => s.trim());

const PLANS: { id: AgentProfileId; args: string[] }[] = [
  { id: 'claude-code', args: ['--permission-mode', 'acceptEdits'] },
  { id: 'codex', args: [] },
];

for (const plan of PLANS) {
  describe.skipIf(!selected.includes(plan.id))(`prompts com ${plan.id}`, () => {
    const driver = new AgentDriver(plan.id, plan.args);
    driver.reportSuffix = '-prompts';
    let available = false;

    const turnEnded = (from: number, timeoutMs = 300_000) =>
      driver.waitFor('terminou', timeoutMs, from);

    beforeAll(async () => {
      available = await driver.start();
      if (available) await driver.passStartupScreens();
    });

    afterAll(async () => {
      if (!available) return;
      const { orphans } = await driver.stop();
      const file = driver.writeReport({ command: driver.command || null, orphans });
      console.log(`resultado registrado em ${file}`);
      expect(orphans, 'processos órfãos depois de fechar a sessão').toEqual([]);
    });

    it('um prompt de três linhas chega como uma mensagem só', async ({ skip }) => {
      skip(!available, 'agente não instalado');
      const result = await driver.scenario('três linhas, uma mensagem', async (mark) => {
        const outcome = driver.sendText(
          'Responda só com a palavra PRONTO.\nNão rode nenhum comando.\nNão altere nenhum arquivo.',
          { submit: true },
        );
        expect(outcome).toBe('sent');
        await turnEnded(mark);
        // One turn: a second one would mean a line went as its own message.
        await sleep(3000);
        const turns = driver.events.slice(mark).filter((e) => e.state === 'trabalhando');
        expect(turns.length).toBeGreaterThan(0);
        expect(driver.events.slice(mark).filter((e) => e.state === 'terminou')).toHaveLength(1);
      });
      expect(result.error).toBeUndefined();
    }, 600_000);

    it('um prompt enviado com o agente trabalhando sai depois do turno', async ({ skip }) => {
      skip(!available, 'agente não instalado');
      const result = await driver.scenario('espera o turno', async (mark) => {
        driver.sendText('Conte devagar de 1 a 30, um número por linha. Não rode comandos.', {
          submit: true,
        });
        await driver.waitFor('trabalhando', 60_000, mark);
        const queuedAt = driver.events.length;
        expect(driver.sendText('Responda só com a palavra SEGUNDO.', { submit: true })).toBe(
          'queued',
        );
        await turnEnded(mark);
        // The second prompt starts a turn of its own after the first one ended.
        await driver.waitFor('trabalhando', 60_000, queuedAt);
        await turnEnded(queuedAt);
        expect(await driver.screen()).toContain('SEGUNDO');
      });
      expect(result.error).toBeUndefined();
    }, 900_000);
  });
}
