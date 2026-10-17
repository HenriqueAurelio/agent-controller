# Fila de prompts: tarefas

**Pronto quando:** a pessoa põe três prompts na fila de uma sessão e sai; o agente recebe um depois do outro, cada um ao fim do turno anterior; a fila para quando o agente pede permissão e quando uma verificação falha; nos dois agentes e nos dois sistemas.

---

## [ ] 13.1 `PromptQueue` no core

- **Frente:** A · **Tamanho:** M · **Depende de:** nada

**O que fazer**

- `src/shared/prompts.ts`: `QueueItem { id, text, values, condition: 'turnEnd' | 'checksPassed' }` e `QueueState { items, paused, blockedBy? }`.
- `src/core/prompts/PromptQueue.ts`: anda com `done`, pausa com `waiting`, espera a rodada de verificações quando o item pede. Persistência com `JsonStore`; volta pausada ao carregar.
- Sessão sem sinal do agente: o item espera o clique.

**Pronto quando:** testes com relógio falso para turno, pergunta no meio, verificação que falha, sessão removida e app reaberto.

---

## [ ] 13.2 IPC

- **Frente:** A · **Tamanho:** P · **Depende de:** 13.1

**O que fazer**

- Canais `queue:*` no tipo, na lista e no handler, juntos. Validação no main: sessão existe, texto com limite, no máximo 20 itens.

**Pronto quando:** testes de validação dos argumentos.

---

## [ ] 13.3 Interface

- **Frente:** B · **Tamanho:** M · **Depende de:** 13.2

**O que fazer**

- **Pôr na fila** no `PromptDialog`; botão **Fila (n)** no topo da sessão; lista com arrastar, editar, apagar, pausar e retomar.
- **⏵ n** na barra lateral; aviso quando a fila para por falha.
- Textos novos em pt-BR, en e es.

**Pronto quando:** e2e com o shell falso: três itens chegam em ordem, e a fila para no "aguardando".

---

## [ ] 13.4 Smoke, README e evidências

- **Frente:** C · **Tamanho:** P · **Depende de:** 13.3

**O que fazer**

- Smoke com os agentes reais (só com autorização): dois itens, o segundo com "verificações passaram".
- README: seção "Fila de prompts". Evidências em `evidences/images/fila-de-prompts/`.

**Pronto quando:** PR com README e telas.
