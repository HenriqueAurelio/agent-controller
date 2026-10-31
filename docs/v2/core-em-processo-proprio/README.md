# Core em processo próprio

- **Estado:** proposta, com a [ADR 0026](../../../adr/0026-core-em-processo-proprio.md) em discussão. Nada foi implementado ainda; o motivo está em [Por que ainda não foi implementada](#por-que-ainda-não-foi-implementada).
- **Muda:** a [ADR 0006](../../../adr/0006-persistencia-json-sem-daemon.md) ("os processos morrem com o app"), na fase 3.

## O problema

Hoje o processo principal do Electron faz duas coisas:

- cuida da janela: repassa cliques, teclas, redimensionamento e mensagens da interface;
- roda o core inteiro: PTYs, histórico de cada tela, sinais dos agentes, git, checkpoints, verificações e persistência.

Quando o core faz algo demorado de uma vez (um `git status` num repositório enorme, a foto de um checkpoint com muitos arquivos, uma rajada de saída), a janela espera junto. E, como tudo vive nesse processo, **fechar o app encerra todos os agentes**.

O Maestro e o CompozyOS separam as duas coisas. No Maestro, as sessões ficam no herdr, um processo à parte. No CompozyOS, ficam num daemon em Go. Nos dois, a janela é só um cliente.

## Como fica, em três fases

Cada fase entra num PR próprio e pode parar ali.

### Fase 1: core num `utilityProcess`

- O que hoje está em `src/main/app.ts` e não precisa do Electron passa a rodar num processo Node criado com `utilityProcess.fork`. Isso inclui `SessionManager`, `PtyManager`, `HookServer`, os serviços de git, checagens, fila e fluxos.
- O processo principal fica com a janela, os diálogos, as notificações, o menu, a bandeja e as métricas do Electron.
- **Saída do terminal direto para a interface:** o main cria um `MessageChannelMain` e entrega uma ponta ao core e a outra à interface. Os lotes de `terminal:data` não passam mais pelo processo principal.
- **Os outros canais de IPC continuam passando pelo main**, que repassa ao core. A validação dos argumentos continua no main, onde está hoje.
- Ganho esperado: a janela não espera o core, e uma falha no node-pty não derruba a janela; o main mostra o erro e sobe o core de novo. O CPU total não cai.
- Custo: mais um processo Node, uns 30 a 50 MB a medir com `npm run measure`; e a meta da ADR 0009 precisa ser revista.

### Fase 2: o core sobrevive à janela

- O core deixa de ser filho do Electron: é iniciado como processo separado, com o próprio binário do app em modo Node (`ELECTRON_RUN_AS_NODE`). A janela se conecta a ele por named pipe no Windows ou socket Unix no Linux, como o `HookServer` já faz.
- Fechar a janela pergunta: **Encerrar os agentes** ou **Deixar rodando**. Reabrir o app reconecta e remonta cada terminal a partir do histórico, que continua no core.
- O core encerra sozinho quando não há sessão rodando e nenhuma janela conectada.

### Fase 3: avisos com a janela fechada

- Com a janela fechada, o core avisa "aguardando você" por uma notificação do sistema. No Windows, isso pede um pequeno processo de notificação ou uma entrada na bandeja.

## Riscos

| Risco | Como fica |
|---|---|
| O processo do core morre sozinho | O main mostra o erro e oferece subir de novo; as sessões voltam paradas, como hoje ao reabrir |
| Duas janelas do app ligadas ao mesmo core | O core aceita uma conexão de cada vez; uma segunda janela traz a primeira para a frente, como hoje (`requestSingleInstanceLock`) |
| Versões diferentes de janela e core depois de uma atualização | O core informa a versão ao conectar; diferente, a janela pede para encerrar o core antigo |
| Processo rodando sem a pessoa saber (fase 2) | Ícone na bandeja enquanto houver core sem janela, e o "deixar rodando" só por escolha explícita |
| Segredos no histórico que fica na memória do core | Igual a hoje: nada vai para o disco |

## Por que ainda não foi implementada

1. **O ganho de CPU já foi colhido.** Depois dos PRs #44 a #47, o JavaScript do processo principal gasta de 2% a 6% de um núcleo com 6 sessões, e as mensagens entre a interface e o main respondem em menos de 2 ms mesmo na rajada. A fase 1 não teria um número de desempenho para mostrar no PR; o ganho dela é resiliência e o caminho para a fase 2.
2. **O tamanho.** `src/main/app.ts` e `src/main/ipc.ts` somam cerca de 1 800 linhas, que ligam uns 20 serviços do core. A fase 1 reorganiza todas elas e muda a forma de cada canal de IPC chegar ao core. Um erro ali quebra o app inteiro, não uma funcionalidade.
3. **A decisão é de produto.** A fase 2 inverte a ADR 0006 e coloca um processo residente na máquina da pessoa. A ADR 0006 pedia uma ADR nova só "se sessões persistentes virarem o pedido principal".

Antes de implementar, falta decidir:

- se as sessões devem sobreviver a fechar a janela (fase 2). Se não, a fase 1 sozinha rende pouco;
- quanto de memória a mais é aceitável pelo processo extra.
