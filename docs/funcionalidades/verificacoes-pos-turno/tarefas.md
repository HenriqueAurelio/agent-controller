# Verificações ao fim do turno: tarefas

**Pronto quando:** num repositório com `lint` e `test`, o agente muda um arquivo e termina; as duas verificações rodam sozinhas, a sessão mostra ✓ ou ✗, o aviso diz o resultado, e a saída da que falhou chega ao agente com um clique.

**Depende de:** o envio ao terminal da [biblioteca de prompts](../biblioteca-de-prompts/tarefas.md) (6.2), só para a tarefa 4.5. O resto anda sozinho.

---

## [ ] 4.1 ToolRunner

- **Frente:** A · **Tamanho:** M · **Depende de:** nada

**O que fazer**

- `src/core/tools/ToolRunner.ts`: `run({ command, args, cwd, env, stdin, timeoutMs, maxOutputBytes, shell })` → `{ exitCode, stdout, stderr, timedOut, truncated }`.
- `shell: false`: sem shell, argumentos separados (o modo que o formatador vai usar).
- `shell: true`: a linha roda no shell do usuário, resolvido como o comando do agente hoje (PowerShell com perfil no Windows, `$SHELL` interativo no Linux); reaproveitar o que já existe em `src/core/agents/shellCommand.ts`, movendo para um lugar comum se preciso, sem que `tools/` saiba de agente.
- Sem PTY. Prazo com `killTree` (`src/core/pty/killTree.ts`). Saída guardada só no final, até o limite.
- Caminhos com `node:path`.

**Pronto quando:** `tests/core/toolRunner.test.ts` cobre os dois modos: stdin → stdout, código de saída, prazo estourado (processo e filhos encerrados), saída acima do limite, pasta com espaço e acento, alias do shell no modo `shell`. Roda no Windows e em `npm run test:core:docker`.

---

## [ ] 4.2 Configuração por repositório

- **Frente:** A · **Tamanho:** P · **Depende de:** nada

**O que fazer**

- `src/shared/checks.ts`: `CheckConfig { id, label, command, timeoutSec, when: 'turnEnd' | 'manual' }`.
- Preferência `checksByRepo: Record<string, CheckConfig[]>`, sanitizada; fora da exportação (é execução de comando: importar um arquivo não pode fazer o app rodar algo novo).
- `suggestChecks(repoRoot)`: lê os scripts do `package.json` e sugere `lint`, `typecheck`, `test`, `check`, com o gerenciador certo (`npm`, `pnpm`, `yarn`, pelo lockfile).

**Pronto quando:** testes da sugestão (com e sem `package.json`, monorepo, cada lockfile) e da sanitização.

---

## [ ] 4.3 CheckService

- **Frente:** A · **Tamanho:** M · **Depende de:** 4.1, 4.2

**O que fazer**

- Escuta as transições de estado da sessão; dispara só se o turno mudou arquivos.
- Fila global com paralelismo configurável (padrão 2); uma rodada por sessão.
- Roda pelo `ToolRunner` no modo `shell`, com `CI=1`; cancela se a sessão voltar a "trabalhando", se for fechada ou a pedido.
- Guarda o final da saída de cada verificação.

**Pronto quando:** `tests/core/checkService.test.ts` com comandos falsos: passa, falha, estoura o prazo, é cancelada pelo turno seguinte; duas sessões respeitando o limite. Windows e Docker.

---

## [ ] 4.4 Estado na sessão e IPC

- **Frente:** A · **Tamanho:** P · **Depende de:** 4.3

**O que fazer**

- `Session.checks` em `src/shared/session.ts`; o evento `sessions:changed` leva junto.
- Canais `checks:get`, `checks:run`, `checks:cancel`, `checks:configure`, validados no main.
- `NotificationPolicy`: o texto do aviso inclui o resultado quando ele sai em até alguns segundos depois do fim do turno; senão, um segundo aviso só se falhou.

**Pronto quando:** testes da política de aviso (passou, falhou, demorou).

---

## [ ] 4.5 Interface

- **Frente:** B · **Tamanho:** M · **Depende de:** 4.4; biblioteca de prompts 6.2 para "Mandar o erro ao agente"

**O que fazer**

- Barra lateral: ✓ / ✗ N / rodando, ao lado do estado, com dica.
- Aba **Verificações** na sessão: lista, tempo, saída (com cores ANSI), rodar e cancelar.
- Primeiro uso: diálogo com as sugestões, marcar quais rodar, confiança por repositório.
- **Mandar o erro ao agente**: as últimas linhas da saída, pelo envio ao terminal.
- Textos em pt-BR, en e es.

**Pronto quando:** e2e com o shell falso: configurar, ver ✗, abrir a saída, mandar ao agente.

---

## [ ] 4.6 Smoke com os agentes reais

- **Frente:** C · **Tamanho:** M · **Depende de:** 4.5
- **Autorizado** pelo dono do produto em 2026-10-14, para esta funcionalidade. O Claude Code roda pelo comando **`claude-personal`**.

**O que fazer**

- `tests/smoke/driver.ts`: aceitar um comando por agente (`SMOKE_COMMAND_CLAUDE_CODE`, `SMOKE_COMMAND_CODEX`), rodado pelo shell do usuário como o app faz com o comando da sessão ([ADR 0013](../../../adr/0013-comando-do-usuario-no-lugar-do-agente.md), `wrapInShell`). Sem a variável, continua abrindo o executável direto. Com comando, a detecção de versão é pulada, como no app.
- `tests/smoke/app.spec.ts`: o mesmo comando vai para `agentCommands` nas preferências do app de teste.
- Roteiro: num repositório temporário com `lint` e `test` no `package.json`, o agente altera um arquivo e quebra um teste; ao fim do turno, as verificações rodam, a sessão mostra ✗, e "Mandar o erro ao agente" faz o agente corrigir; na rodada seguinte, ✓.
- Rodar com `SMOKE_COMMAND_CLAUDE_CODE=claude-personal`, no Windows (e no WSL, se o `claude-personal` existir lá).

**Pronto quando:** resultado gravado em `tools/agent-probe/results/` para Claude Code (via `claude-personal`) e Codex, e a saída colada no PR.

---

## [ ] 4.7 ADR, README e medição

- **Frente:** C · **Tamanho:** P · **Depende de:** 4.5

**O que fazer**

- ADR "Verificações do projeto ao fim do turno"; README (seção "Verificações"); `DECISOES-E-RISCOS.md` 3.6 (o app passa a rodar comandos do projeto).
- `npm run measure` com uma verificação rodando.

**Pronto quando:** PR com tudo isso e as evidências.
