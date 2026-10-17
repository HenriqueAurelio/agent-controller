# Encadear sessões: tarefas

**Pronto quando:** um grupo com o modelo "Plano → implementação → revisão" passa o trabalho de uma sessão à outra, para no limite de voltas e quando uma sessão faz uma pergunta, e cada envio pede aprovação de fábrica; nos dois agentes e nos dois sistemas.

---

## [ ] 19.1 `FlowEngine`

- **Frente:** A · **Tamanho:** M · **Depende de:** [fila de prompts](../fila-de-prompts/tarefas.md) 13.1, [revisor](../revisor-automatico/tarefas.md) 18.1

**O que fazer**

- `src/shared/flows.ts`: `FlowRule { id, from, when, prompt, to, confirm, maxRounds }`.
- `src/core/handoff/FlowEngine.ts`: escuta os quatro gatilhos, prepara ou entrega na fila do destino, conta as voltas por ciclo, pausa com pergunta.
- Variáveis `{diff_do_turno}`, `{saida}` e `{sessao_origem}` em `prompts/expand.ts`.

**Pronto quando:** testes com ciclo de três voltas, regra com confirmação, sessão removida no meio e estado estimado.

---

## [ ] 19.2 Persistência e IPC

- **Frente:** A · **Tamanho:** P · **Depende de:** 19.1

**O que fazer**

- Regras com o grupo em `sessions.json`, fora da exportação.
- Canais `flows:*`, com validação: sessões do mesmo grupo, `maxRounds` de 1 a 10.

**Pronto quando:** testes de validação e de carga de `sessions.json` antigo.

---

## [ ] 19.3 Editor de regras e modelos

- **Frente:** B · **Tamanho:** M · **Depende de:** 19.2

**O que fazer**

- **Fluxo** no cabeçalho do grupo: lista de regras, editor de uma regra, os dois modelos prontos.
- O revisor automático passa a ser salvo como uma regra.

**Pronto quando:** e2e monta o modelo de três passos.

---

## [ ] 19.4 Barra lateral e histórico

- **Frente:** B · **Tamanho:** M · **Depende de:** 19.3

**O que fazer**

- Seta entre as sessões, envio preparado com **✓**, botão de parar o fluxo, histórico do que cada regra mandou.

**Pronto quando:** e2e com três shells falsos percorre o fluxo com aprovação.

---

## [ ] 19.5 ADR, smoke, README e evidências

- **Frente:** C · **Tamanho:** P · **Depende de:** 19.4

**O que fazer**

- ADR "Regras que enviam sozinhas". Smoke com os agentes reais (só com autorização).
- README: "Fluxos entre sessões". Evidências em `evidences/images/encadear-sessoes/`.

**Pronto quando:** PR com ADR, README e telas.
