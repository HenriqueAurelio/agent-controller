# 0025 — Tarefas como origem das sessões (quadro de tarefas)

- **Status:** Aceita
- **Data:** 2026-10-17
- **Amplia:** [ADR 0022](0022-experimentos-melhor-de-n.md) (cópia + sessão + envio quando pronto) e [ADR 0015](0015-app-escreve-no-terminal-a-pedido.md). É a funcionalidade 20 de [`docs/funcionalidades`](../docs/funcionalidades/quadro-de-tarefas/README.md).

## Contexto

A pessoa pensa em tarefas, mas o app só conhece sessões. A lista do que falta fica fora dele, e cada início exige criar cópia, sessão e prompt à mão.

## Decisão

- **Cartão = título + descrição + opções de início** (agente, comando, cópia isolada, base, grupo), guardado por repositório em `userData/tasks/<hash do repositório>.json` (`TaskBoard`, `src/core/tasks`). Só isso: sem prazo, responsável nem etiqueta.
- **A coluna não é guardada.** `columnOf(cartão, sessão)` (`src/shared/tasks.ts`, função pura) a calcula do estado da sessão, das verificações e da fila, tanto no renderer (sempre em sincronia com a lista de sessões) quanto nos testes do core. Regras, na ordem: marcado feito → **Feito**; sem sessão → **A fazer**; antes de o primeiro pedido chegar ao agente → **Em andamento** (o "pronto" de um agente recém-aberto não é "aguardando você"); parada, erro, aguardando ou verificações falhas → **Precisa de você**; trabalhando, itens na fila ou verificações em curso → **Em andamento**; o resto (turno terminou) → **Revisar**.
- **Iniciar** (até 4 por clique, um após o outro): cria a cópia na branch `ac/<título>` (com sufixo `-2`, `-3`... se o nome já existe; nunca reaproveita nem apaga uma branch), a sessão (sem tirar a seleção da sessão à vista: `NewSessionInput.keepSelection`) e manda a descrição (ou o título) quando o agente está pronto, com o mesmo respiro de 1,5 s do melhor de N. Um cartão que não inicia é relatado e os outros seguem.
- **Feito.** Marcado à mão (`tasks:done`), e a interface abre o diálogo normal de fechar sessão (manter ou remover a cópia). Também fica feito sozinho quando a branch **andou** desde o início e a base a contém (`git merge-base --is-ancestor`), conferido ao abrir o quadro e no fim de cada turno de uma sessão de cartão, sem vigia. Uma branch parada onde começou também é ancestral da base e **não** conta.
- **Sessão fechada à mão** devolve o cartão a **A fazer** com a marca "sessão fechada" e a branch, que continua no repositório. Iniciar de novo cria outra branch.
- **Mover à mão** só entre A fazer e Feito, e a ordem dentro da coluna (`tasks:reorder`). Cartão com sessão não se arrasta; as colunas do meio seguem o estado.
- **IPC:** `tasks:list/create/update/remove/reorder/start/done` e o evento `tasks:changed`, validados no main.

## Consequências

- Nenhum processo ou vigia novo: o quadro é arquivo pequeno, mais o que o `SessionManager` já emite.
- Quem vive só de colunas derivadas pode ver um cartão saltar de coluna por instantes entre o envio do pedido e o agente declarar "trabalhando"; é o preço de não guardar o estado.
- Um quadro por repositório; trocar de repositório é escolher outro no topo.
