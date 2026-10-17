# Responder sem abrir a sessão

- **Estado:** feita (leva 1). A sondagem com os agentes reais (12.1) e o smoke (12.6) esperam autorização para usar os agentes; veja a ADR.
- **ADR:** [0020, "Responder ao pedido de permissão fora do terminal"](../../../adr/0020-responder-permissao-fora-do-terminal.md). Reaproveita a [ADR 0015](../../../adr/0015-app-escreve-no-terminal-a-pedido.md) (o app escreve no terminal a pedido do usuário).

## O problema

Com cinco sessões abertas, a maior parte dos "Aguardando você" é um pedido de permissão: "posso rodar `npm install`?". Para responder, a pessoa abre a sessão, lê o menu do agente, aperta uma tecla e volta para onde estava. É o vai e vem entre janelas que o app nasceu para acabar, só que agora dentro do próprio app.

## A ideia

O pedido aparece **onde a pessoa já está olhando**: na linha da sessão na barra lateral e na notificação do sistema. Ele mostra o que o agente quer fazer (`Bash: npm install`, `Edit: src/app.ts`) e os botões **Permitir** e **Negar**. O clique escreve no terminal do agente a tecla que ele espera, como se a pessoa tivesse digitado.

## Como fica para quem usa

- Na barra lateral, uma sessão aguardando permissão ganha uma segunda linha com a ferramenta e o alvo, cortados para caber, e os botões **✓** (permitir) e **✕** (negar). Com o teclado, a sessão focada responde com `Alt+Y` e `Alt+N`.
- A notificação do sistema traz os mesmos dois botões, onde o sistema suporta ações (Windows sim; no Linux, depende do servidor de notificações, e sem suporte o clique só abre a sessão, como hoje).
- **Permitir sempre** ("não perguntar de novo nesta sessão") existe só onde o agente oferece essa opção no menu dele. O app não cria regra própria de permissão.
- Se o pedido mudou entre a pessoa ver e clicar (o agente já seguiu, ou fez outra pergunta), o clique não escreve nada e avisa "O pedido mudou; abra a sessão".
- Uma pergunta aberta do agente ("qual das duas abordagens?") não tem botões: só pedidos de permissão, que têm resposta fixa.
- Uma preferência desliga os botões para quem prefere sempre ler o terminal.

## Onde entra na arquitetura

- **Core, adaptador:** o hook `PermissionRequest` já chega ao `ClaudeAdapter` com `tool_name` e, no payload, `tool_input`. O adaptador passa a emitir um `PermissionAsk { id, tool, target, choices }` além do estado. O Codex faz o mesmo no adaptador dele, com o que o hook dele traz. Fora de `src/core/agents` ninguém sabe qual agente é: as respostas (`allow`, `allowAlways`, `deny`) viram teclas dentro do perfil do agente.
- **Core, sessão:** `SessionManager` guarda o pedido aberto de cada sessão e o descarta quando o estado sai de "aguardando" ou chega outro pedido. `answerPermission(sessionId, askId, choice)` confere se o `askId` ainda é o aberto, e se a tela do terminal ainda mostra o menu (`ScreenHistory`), antes de escrever.
- **IPC:** `sessions:answerPermission(sessionId, askId, choice)`, com tudo validado no main. O pedido vai junto do `SessionView` no `sessions:changed`.
- **Main:** ações na notificação (`Notification` do Electron com `actions` no Windows).

O pedido nunca é respondido sozinho: cada escrita sai de um clique ou de uma tecla da pessoa.

## Uma alternativa a conferir na sondagem

O hook `PermissionRequest` do Claude Code pode devolver a decisão (`allow`/`deny`) em vez de deixar o menu aparecer. Seria mais robusto que simular teclas, mas o hook teria de esperar a resposta da pessoa, e o agente ficaria parado sem mostrar o menu no terminal. A sondagem compara os dois caminhos. A escolha de fábrica é a tecla, porque o terminal continua mostrando o que acontece.

## Riscos

| Risco | Como fica |
|---|---|
| Responder ao pedido errado (o menu mudou) | `askId` mais a conferência da tela antes de escrever; na dúvida, não escreve |
| Teclas do menu mudarem numa versão nova do agente | Ficam no perfil, com `lastTestedVersion`; o smoke de cada versão confere |
| Permitir sem ler o que é | O alvo (comando, arquivo) sempre aparece; comando longo mostra o começo e o fim |
| Notificação com ação não existir no Linux | O clique só abre a sessão, como hoje |
