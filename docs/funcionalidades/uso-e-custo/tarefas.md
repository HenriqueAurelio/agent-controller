# Uso e custo: tarefas

**Pronto quando:** com uma sessão de cada agente, a barra lateral mostra tokens, custo (real ou estimado) e contexto ocupado, atualizados a cada turno, sem mexer na configuração do agente.

---

## [ ] 7.1 Sondagem (só com autorização: usa os agentes reais)

- **Frente:** A · **Tamanho:** P · **Depende de:** nada

**O que fazer**

- Em `tools/agent-probe`: rodar um turno de cada agente e registrar o JSON da status line do Claude Code e os eventos de tokens do Codex.
- Conferir se a `statusLine` do `--settings` substitui ou se soma à do usuário.
- Registrar em `tools/agent-probe/results/`, por agente e versão.

**Pronto quando:** os campos e o comportamento estão anotados e a ADR pode ser escrita. Se algum caminho não existir, esta pasta é revista antes de seguir.

---

## [ ] 7.2 Tipo comum e adaptador do Claude Code

- **Frente:** A · **Tamanho:** M · **Depende de:** 7.1

**O que fazer**

- `UsageSnapshot` em `src/shared/session.ts`.
- Status line no `claude-settings.json` do app, chamando o `agentctl` com um subcomando novo (`agentctl usage`), que repassa o JSON pelo `HookServer` e devolve a saída da status line do usuário, se houver.
- `claudeAdapter` converte para `UsageSnapshot`.

**Pronto quando:** testes do adaptador com JSON gravado na sondagem; teste do `agentctl` encadeando a status line do usuário. Windows e Docker.

---

## [ ] 7.3 Adaptador do Codex

- **Frente:** A · **Tamanho:** M · **Depende de:** 7.1 e o id da conversa do Codex, que vem do PR 2 de [retomar a conversa](../../planos/retomar-conversa.md). Até lá, a sessão do Codex mostra só o que não depende do arquivo da conversa (nada, na primeira entrega). A parte do Claude Code (7.2 e 7.4) sai antes, sem esperar esta.

**O que fazer**

- Achar o arquivo da conversa pelo id; ler incrementalmente o fim dele; somar os eventos de tokens.
- Tabela de preços por modelo em dados (`src/core/agents/pricing.ts`), com data da tabela; custo marcado como estimado.

**Pronto quando:** testes com arquivo de conversa gravado na sondagem, inclusive um arquivo que cresce.

---

## [ ] 7.4 Interface

- **Frente:** B · **Tamanho:** M · **Depende de:** 7.2

**O que fazer**

- Barra lateral: linha opcional com custo e barra de contexto; âmbar acima de 80%.
- Topo da sessão: detalhe com modelo, tokens e custo.
- Painel **Uso**: total do dia por sessão e agente (só em memória no início; persistir depois, se fizer falta).
- Preferência para esconder.

**Pronto quando:** e2e com um adaptador falso que emite `UsageSnapshot`.

---

## [ ] 7.5 ADR e README

- **Frente:** C · **Tamanho:** P · **Depende de:** 7.4

**O que fazer**

- ADR com os caminhos escolhidos e o que fica de fora; README (seção "Uso e custo") com a ressalva do custo estimado do Codex.

**Pronto quando:** PR com ADR, README e evidências.
