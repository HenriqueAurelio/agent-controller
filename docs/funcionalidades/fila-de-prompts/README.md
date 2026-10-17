# Fila de prompts por sessão

- **Estado:** concluída (leva 1). O smoke com os agentes reais (13.4) espera autorização para usá-los.
- **ADR:** nenhuma nova. Amplia o "enviar quando terminar" da [ADR 0015](../../../adr/0015-app-escreve-no-terminal-a-pedido.md) de um envio pendente para uma fila; a ADR ganhou uma revisão que diz quando a fila envia sozinha.

## O problema

O trabalho com um agente costuma vir em passos: "implemente", depois "escreva os testes", depois "atualize o README". Hoje a pessoa espera cada turno terminar para mandar o próximo. Se ela sai da frente do computador, a sessão fica parada até ela voltar.

## A ideia

Cada sessão tem uma **fila**. A pessoa põe três prompts nela, e o app manda o próximo quando o turno anterior termina. Cada item pode pedir que as verificações passem antes de seguir.

## Como fica para quem usa

- No diálogo de envio (paleta, prompt guardado, "Mandar ao agente"), o botão **Pôr na fila** fica ao lado de **Enviar**.
- No topo da sessão, **Fila (3)** abre a lista: reordenar arrastando, editar, apagar, **Pausar** e **Retomar**.
- Cada item tem uma condição:
  - **Quando o turno terminar** (de fábrica).
  - **Quando as verificações passarem.** Se falharem, a fila para e avisa; a pessoa decide entre mandar o erro ao agente, pular o item ou retomar.
- A fila **para sozinha** quando o agente pede permissão ou faz uma pergunta: a resposta é da pessoa. Ela volta a andar no próximo "Terminou".
- O envio continua sem apertar Enter, a menos que a preferência "Enviar com Enter" esteja ligada. Com ela desligada, a fila só anda com o Enter da pessoa, o que tira o sentido dela; por isso **Pôr na fila** liga o Enter só para os itens da fila e diz isso no diálogo.
- Fechar o app guarda a fila. Ao reabrir, ela volta **pausada**.
- Na barra lateral, a sessão mostra **⏵ 2**: dois itens esperando.

## Onde entra na arquitetura

- **Core:** `src/core/prompts/PromptQueue.ts`, uma fila por sessão, guardada com `JsonStore` em `queues/<sessionId>.json`. Ela escuta o `SignalAggregator` (estado `done`) e o `CheckService` (rodada terminada) e entrega pelo mesmo caminho do `terminal:sendText`, com as variáveis preenchidas na hora do envio, não na hora de pôr na fila.
- **Diferença entre "terminou" e "aguardando":** a fila só anda com `done`, nunca com `waiting`. O `Notification idle` do Claude Code fica como "aguardando" e não move a fila.
- **IPC:** `queue:get`, `queue:add`, `queue:update`, `queue:remove`, `queue:reorder`, `queue:pause`, `queue:resume`, e o evento `queue:changed`.

## Riscos

| Risco | Como fica |
|---|---|
| Mandar o próximo item no meio de uma pergunta do agente | Só anda com `done`; `waiting` pausa |
| Estado estimado (bolinha tracejada) disparar envio por engano | Sessões sem sinal do agente não andam a fila sozinhas: o item espera um clique em **Enviar o próximo** |
| Gastar créditos à toa quando algo deu errado | Condição "verificações passaram" e limite de itens por fila (20) |
| Fila velha depois de reabrir o app | Volta pausada |
