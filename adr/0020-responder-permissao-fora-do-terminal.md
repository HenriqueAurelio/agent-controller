# 0020 — Responder ao pedido de permissão fora do terminal

- **Status:** Aceita
- **Data:** 2026-10-17
- **Amplia:** [ADR 0015](0015-app-escreve-no-terminal-a-pedido.md), que diz quando o app pode escrever no terminal do agente. Esta acrescenta um caso: a resposta a um pedido de permissão, por um clique ou uma tecla da pessoa.

## Contexto

Com várias sessões abertas, a maior parte dos "aguardando você" é um pedido de permissão ("posso rodar `npm install`?"). Para responder, a pessoa abre a sessão, lê o menu do agente, aperta uma tecla e volta. É a proposta 12 de [`docs/funcionalidades`](../docs/funcionalidades/responder-sem-abrir/README.md).

O hook `PermissionRequest` já chega aos adaptadores com o nome da ferramenta e, no payload, `tool_input`. Faltava levar isso à barra lateral e à notificação, e ter como responder.

## Decisão

### A resposta é a tecla do menu, não a decisão pelo hook

O app escreve no terminal a tecla que o menu do agente espera, como se a pessoa tivesse digitado. O hook do Claude Code poderia devolver `allow`/`deny`, mas teria de esperar a pessoa responder, com o agente parado e o menu fora da tela: o terminal deixaria de mostrar o que acontece, e uma resposta digitada nele não valeria. Pela tecla, o terminal continua sendo a fonte da verdade e responder nele continua funcionando.

### O pedido

- O adaptador monta um `PermissionAsk { id, tool, target, choices }` a partir do hook. O alvo vem de `tool_input` (`command`, `file_path`, `path`, `url`, `pattern`, `query`; o comando do Codex, que vem como lista, é juntado), numa linha só e cortado no meio em 120 caracteres: o começo e o fim de um comando longo dizem o que ele faz. Ferramenta MCP (`mcp__servidor__ferramenta`) aparece como `MCP servidor › ferramenta`.
- Perguntas abertas do Claude Code (`AskUserQuestion`, `ExitPlanMode`) deixam a sessão aguardando, mas não viram pedido: não têm resposta fixa.
- As teclas e o texto do menu ficam no **perfil** do agente (`permission` em `profiles.ts`): fora de `src/core/agents`, ninguém sabe qual agente responde. Claude Code: `1` permite, `2` permite sempre, `Esc` nega. Codex: `y`, `a`, `Esc`.

### Só com o menu na tela

- O `SessionManager` guarda o pedido aberto de cada sessão. Ele aparece no `SessionView` (e, com ele, os botões) só depois que a tela do terminal (`ScreenHistory`) mostra o menu do agente; "permitir sempre" só aparece quando o menu oferece essa opção. O app não cria regra própria de permissão.
- O pedido some quando o estado sai de "aguardando", quando chega outro, quando o agente sai, ou quando é respondido.
- `answerPermission(sessionId, askId, choice)` confere, antes de escrever, que o `askId` é o pedido aberto, que a sessão está aguardando e que o menu continua na tela. Na dúvida, não escreve: devolve `stale` e a interface diz "O pedido mudou; abra a sessão". `unsupported` quando o agente, ou o menu, não tem aquela resposta.
- Nada é respondido sozinho: cada escrita sai de um clique, de `Alt+Y`/`Alt+N` na sessão em vista ou de um botão da notificação.

### Onde aparece

- **Barra lateral:** uma segunda linha com a ferramenta e o alvo, e **✓**, **sempre** (quando há) e **✕**. Atalhos `Alt+Y` e `Alt+N`, editáveis; sem pedido aberto, a tecla segue para o terminal.
- **Notificação:** quando o menu aparece, a notificação de "aguardando você" dá lugar a uma que diz o pedido, com **Permitir** e **Negar** (botões do Electron no Windows; o macOS não é alvo). No Linux o Electron não tem botões na notificação: ela vai sem eles, e o clique abre a sessão, como antes. "Permitir sempre" não vai para a notificação: é escolha para quem está olhando o terminal.
- **Preferência** `permissionButtons` (ligada de fábrica) tira os botões da lista e da notificação; a linha com o pedido continua.

### Contrato

- IPC: `sessions:answerPermission(sessionId, askId, choice)`, validado no main (`choice` entre as três; ids com limite de tamanho). O pedido vai junto do `SessionView` em `sessions:changed`.
- O preload não muda: o canal entra na lista de sempre.

## Alternativas consideradas

- **Decisão pelo hook** (`PermissionRequest` devolvendo `allow`/`deny`): mais robusta contra mudança de teclas, mas o agente fica parado sem menu, e responder no próprio terminal deixa de funcionar. Descartada como caminho de fábrica; pode voltar como opção se as teclas se mostrarem frágeis.
- **Botões assim que o hook chega**, sem olhar a tela: o hook às vezes chega antes do menu, e uma tecla escrita antes do menu iria para o prompt. Descartada.
- **Regras de permissão do próprio app** ("sempre permitir `npm test`"): duplicaria o que os agentes já têm e responderia sem ninguém ver. Fora de escopo.

## Consequências

- `AgentProfile` ganhou `permission`; `AdapterHost` ganhou `ask`; `SessionView` ganhou `permission`; `Preferences` ganhou `permissionButtons`; os atalhos ganharam `allowPermission` e `denyPermission`.
- Ler a tela custa pouco: só nas sessões com pedido aberto, uma vez a cada 80 ms de saída.

## Riscos e mitigação

| Risco | Mitigação |
|---|---|
| Responder ao pedido errado | `askId`, estado e menu na tela conferidos antes de escrever; na dúvida, nada é escrito |
| Teclas ou texto do menu mudarem numa versão nova do agente | Ficam no perfil, junto de `lastTestedVersion`. Se o texto mudar, os botões não aparecem (nada é escrito). A sondagem com os agentes reais (tarefa 12.1) e o smoke (12.6) não rodaram: esperam autorização para usar os agentes e a conta. Até lá, as teclas são as conhecidas do Claude Code 2.1 e do Codex 0.158, não medidas |
| Permitir sem ler | O alvo sempre aparece, com começo e fim do comando; "permitir sempre" não vai para a notificação; a preferência desliga os botões |
| Notificação com botões não existir no Linux | Vai sem botões; o clique abre a sessão |
| Codex sem hooks confiados | Sem hook não há pedido: responde-se no terminal, como antes |
