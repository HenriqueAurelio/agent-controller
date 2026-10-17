# Quadro de tarefas: tarefas

**Pronto quando:** a pessoa cola três linhas no quadro, inicia duas, e os cartões andam sozinhos de "Em andamento" para "Precisa de você" e "Revisar" conforme as sessões; "Feito" fecha a sessão com a pergunta da cópia; nos dois sistemas.

---

## [x] 20.1 `TaskBoard` e `columnOf`

- **Frente:** A · **Tamanho:** M · **Depende de:** nada

**O que fazer**

- `src/shared/tasks.ts` e `src/core/tasks/TaskBoard.ts`: cartões por repositório, persistidos com `JsonStore`.
- `columnOf(task, session, checks, queue)`, função pura.
- "Branch na base" com `merge-base --is-ancestor`.

**Pronto quando:** testes de cada coluna, cartão sem sessão, sessão fechada à mão e branch que entrou na base.

---

## [x] 20.2 Iniciar e concluir

- **Frente:** A · **Tamanho:** M · **Depende de:** 20.1, [melhor de N](../melhor-de-n/tarefas.md) 17.1

**O que fazer**

- `tasks:start` (até 4 por vez) com cópia, sessão e envio da descrição; `tasks:done` com as opções de fechar.
- Canais `tasks:*`, validados no main.

**Pronto quando:** testes do core com worktree temporária e agente falso.

---

## [x] 20.3 Interface do quadro

- **Frente:** B · **Tamanho:** M · **Depende de:** 20.2, [painel geral](../painel-geral/tarefas.md) 16.2

**O que fazer**

- `components/TaskBoard.tsx`: colunas, cartões (o mesmo resumo do painel geral), novo cartão, colar várias linhas, arrastar só onde pode.
- Atalho `Ctrl+Shift+B` e comandos na paleta.

**Pronto quando:** e2e cria, inicia e conclui cartões com shell falso.

---

## [x] 20.4 ADR, README e evidências

- **Frente:** C · **Tamanho:** P · **Depende de:** 20.3

**O que fazer**

- ADR "Tarefas como origem das sessões". README: "Quadro de tarefas". Evidências em `evidences/images/quadro-de-tarefas/`.

**Pronto quando:** PR com ADR, README e telas.
