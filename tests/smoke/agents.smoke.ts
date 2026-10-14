// Smoke test per agent profile, with the real agent: normal end of turn, permission request,
// cancelled turn. Run with `npm run test:smoke`. Environment:
//   SMOKE_PROFILES=claude-code,codex   which profiles to run (default: both)
//   SMOKE_CWD=<folder>                 run in this folder instead of a temporary one
//   SMOKE_TRUST_HOOKS=1                Codex: choose "Trust all" in "Hooks need review"
import fs from 'node:fs';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { saveWorkingTreeFile } from '@core/git/GitService';
import type { AgentProfileId, SessionState } from '@shared/session';
import { AgentDriver, ENTER, ESC, sleep } from './driver';

const selected = (process.env.SMOKE_PROFILES ?? 'claude-code,codex')
  .split(',')
  .map((s) => s.trim());

interface ProfilePlan {
  id: AgentProfileId;
  /** Makes the agent ask before writing, whatever the user's own configuration says. */
  args: string[];
  /** Origin expected for "aguardando você" when the agent asks for permission. */
  waitingOrigins: string[];
}

const PLANS: ProfilePlan[] = [
  { id: 'claude-code', args: ['--permission-mode', 'default'], waitingOrigins: ['hook'] },
  { id: 'codex', args: ['-s', 'read-only'], waitingOrigins: ['titulo', 'hook'] },
];

for (const plan of PLANS) {
  describe.skipIf(!selected.includes(plan.id))(`perfil ${plan.id}`, () => {
    const driver = new AgentDriver(plan.id, plan.args);
    let available = false;
    const states = (from: number): SessionState[] => driver.events.slice(from).map((e) => e.state);

    beforeAll(async () => {
      available = await driver.start();
      if (available) await driver.passStartupScreens();
    });

    afterAll(async () => {
      if (!available) return;
      const { orphans } = await driver.stop();
      const file = driver.writeReport({ orphans });
      console.log(`resultado registrado em ${file}`);
      expect(orphans, 'processos órfãos depois de fechar a sessão').toEqual([]);
    });

    it('abre e fica pronto no prompt', ({ skip }) => {
      skip(!available, 'agente não instalado');
      expect(driver.state).toBe('aguardando');
      expect(driver.events[0]).toMatchObject({ state: 'iniciando', origin: 'processo' });
    });

    it('fim de turno normal: trabalhando → terminou, sem aviso falso', async ({ skip }) => {
      skip(!available, 'agente não instalado');
      const result = await driver.scenario('fim de turno normal', async (mark) => {
        await driver.prompt('Responda apenas com a palavra ok. Não use nenhuma ferramenta.');
        await driver.waitFor('trabalhando', 30_000, mark);
        const done = await driver.waitFor('terminou', 120_000, mark);
        expect(done.confirmed).toBe(true);
        // A false "terminou" (the Codex title turn) would be followed by more work.
        await sleep(6000);
        expect(states(mark)).toEqual(['trabalhando', 'terminou']);
      });
      expect(result.error).toBeUndefined();
    });

    it('pedido de permissão: aguardando você, e depois de aprovado termina', async ({ skip }) => {
      skip(!available, 'agente não instalado');
      const file = `smoke-${Date.now()}.txt`;
      const result = await driver.scenario('pedido de permissão', async (mark) => {
        await driver.prompt(
          `Crie o arquivo ${file} nesta pasta com o conteúdo "ok". Não faça mais nada.`,
        );
        await driver.waitFor('trabalhando', 30_000, mark);
        const waiting = await driver.waitFor('aguardando', 120_000, mark);
        expect(waiting.confirmed).toBe(true);
        expect(plan.waitingOrigins).toContain(waiting.origin);
        // The state must hold while the question is on screen.
        await sleep(4000);
        expect(driver.state).toBe('aguardando');

        const approved = driver.events.length;
        driver.send(ENTER);
        await driver.waitFor('terminou', 120_000, approved);
        expect(fs.existsSync(path.join(driver.cwd, file))).toBe(true);
      });
      fs.rmSync(path.join(driver.cwd, file), { force: true, maxRetries: 20, retryDelay: 250 });
      expect(result.error).toBeUndefined();
    });

    it('cancelamento com Esc: volta a parado sem hook', async ({ skip }) => {
      skip(!available, 'agente não instalado');
      const result = await driver.scenario('cancelamento', async (mark) => {
        await driver.prompt(
          'Escreva os números de 1 a 400 por extenso, um por linha. Não use nenhuma ferramenta.',
        );
        await driver.waitFor('trabalhando', 30_000, mark);
        await sleep(3000);
        const cancelled = driver.events.length;
        driver.send(ESC);
        const done = await driver.waitFor('terminou', 15_000, cancelled);
        expect(done.t - driver.events[cancelled - 1]!.t).toBeGreaterThan(0);
        await sleep(3000);
        expect(driver.state).toBe('terminou');
      });
      expect(result.error).toBeUndefined();
    });

    // ADR 0012: the user edits, in the changes panel, a file the agent has already read. The
    // agent's next change to that file must not throw the user's edit away.
    it('edição do usuário em um arquivo que o agente já leu não é perdida', async ({ skip }) => {
      skip(!available, 'agente não instalado');
      const file = `nota-${Date.now()}.txt`;
      const absolute = path.join(driver.cwd, file);
      const original = 'cor: azul\ntamanho: pequeno\n';
      fs.writeFileSync(absolute, original);
      const result = await driver.scenario(
        'edição do usuário e do agente no mesmo arquivo',
        async (mark) => {
          // The agent reads the file and stops.
          await driver.prompt(
            `Leia o arquivo ${file} e responda apenas com a primeira linha dele. Não altere nada.`,
          );
          await driver.waitFor('trabalhando', 30_000, mark);
          await driver.waitFor('terminou', 120_000, mark);

          // The user edits and saves, exactly as the panel does.
          const edited = original + 'revisado: sim\n';
          expect(await saveWorkingTreeFile(driver.cwd, file, edited, original)).toEqual({
            saved: true,
          });

          // The agent now changes the same file, from what it remembers of it.
          const second = driver.events.length;
          await driver.prompt(
            `No arquivo ${file}, troque a palavra azul por verde. Não mude mais nada no arquivo.`,
          );
          await driver.waitFor('trabalhando', 30_000, second);
          // It asks before writing; approve as many times as it asks.
          const deadline = Date.now() + 150_000;
          while (driver.state !== 'terminou' && Date.now() < deadline) {
            if (driver.state === 'aguardando') {
              await sleep(1500);
              driver.send(ENTER);
              await sleep(2500);
            }
            await sleep(300);
          }
          expect(driver.state).toBe('terminou');
          await sleep(1000);

          const final = fs.readFileSync(absolute, 'utf8');
          expect(final, 'a mudança do agente').toContain('cor: verde');
          expect(final, 'a edição do usuário').toContain('revisado: sim');
          expect(final).toContain('tamanho: pequeno');
        },
      );
      fs.rmSync(absolute, { force: true, maxRetries: 20, retryDelay: 250 });
      expect(result.error).toBeUndefined();
    });
  });
}
