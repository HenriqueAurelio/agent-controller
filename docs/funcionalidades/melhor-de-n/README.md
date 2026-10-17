# Melhor de N

- **Estado:** proposta, leva 1.
- **ADR:** nova, "Experimentos: o mesmo pedido em várias cópias".

## O problema

O mesmo pedido, feito duas vezes, sai diferente: uma vez certo, outra vez pela metade. Claude Code e Codex também resolvem do seu jeito. Hoje, comparar é criar três sessões à mão, cada uma com a sua cópia, colar o mesmo prompt nas três, depois abrir os três painéis e decidir de cabeça.

## A ideia

Um **experimento**: um pedido, N tentativas. O app cria N cópias isoladas a partir da mesma base, abre um agente em cada uma (o mesmo agente N vezes, ou agentes diferentes) e manda o mesmo prompt a todas. Quando terminam, uma tela compara as tentativas e a pessoa fica com uma.

## Como fica para quem usa

1. **Novo experimento** (paleta, ou o menu do **+ Nova sessão**): pasta, prompt, base e as tentativas. Cada tentativa é uma linha com agente e comando: "Claude Code ×2, Codex ×1".
2. O app cria um **grupo** com o nome do experimento e uma sessão por tentativa (`ac/<nome>-1`, `-2`, `-3`), e manda o prompt quando cada agente estiver pronto.
3. As verificações da pasta rodam em cada tentativa ao fim do turno, como em qualquer sessão.
4. **Comparar** (no cabeçalho do grupo) abre uma tabela com uma linha por tentativa: estado, verificações, arquivos mudados, linhas `+/−`, tempo, e custo quando existir. Escolher um arquivo mostra o diff dele em cada tentativa, lado a lado, contra a mesma base.
5. **Ficar com esta:** a tentativa escolhida continua como uma sessão comum. As outras são fechadas com a cópia removida. As **branches ficam** (o app nunca apaga branch), e a pessoa pode apagá-las depois.

A pessoa pode continuar conversando com qualquer tentativa antes de escolher. A comparação acompanha o estado atual delas.

## Onde entra na arquitetura

- **Core:** `src/core/experiments/ExperimentService.ts`. Ele só junta peças que já existem: `WorktreeService` (N cópias, com o comando de preparo de cada uma), `SessionManager` (N sessões num grupo) e o envio do `terminal:sendText` para várias sessões, "quando estiver pronto". Guarda `{ id, prompt, base, attempts: sessionId[] }` junto das sessões.
- **Comparação:** `git diff --numstat <base>` em cada cópia, mais o `git:diff` com `DiffBase` "base da branch", que já existe.
- **IPC:** `experiments:create`, `experiments:compare`, `experiments:keep`.
- O comando de preparo da cópia (`npm ci`) roda N vezes, uma depois da outra, com o limite de execuções simultâneas do `ToolRunner`.

## Riscos

| Risco | Como fica |
|---|---|
| Custo multiplicado por N | O diálogo mostra "3 tentativas = 3× o uso"; N vai até 4 |
| Disco: N cópias com `node_modules` | O espaço aparece em Preferências → Sessões; "ficar com esta" remove o resto |
| Memória com N agentes ao mesmo tempo | Medido com 4 tentativas; os terminais seguem o `TerminalPool` |
| Diffs grandes demais para comparar lado a lado | Mesmo limite do painel; acima dele, só a tabela |
