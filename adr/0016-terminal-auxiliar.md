# 0016 — Terminal auxiliar ao lado do agente

- **Status:** Aceita
- **Data:** 2026-10-16
- **Emenda:** [ADR 0007](0007-escopo-do-v1.md), que deixou de fora o shell puro e a divisão de tela. Os dois entram só na forma descrita aqui: um shell por sessão, ao lado do terminal do agente. O resto da 0007 continua valendo.

## Contexto

Enquanto o agente trabalha, a pessoa quer rodar algo na mesma pasta: subir o servidor, olhar um log, rodar um teste, `git log`. Hoje isso é outra janela de terminal, que é justamente o que o app existe para evitar. Digitar no terminal do agente não serve: ele está ocupado, e o que for digitado vira prompt. É a proposta 8 de [`docs/funcionalidades`](../docs/funcionalidades/terminal-auxiliar/README.md).

## Decisão

- Cada sessão pode abrir **um** terminal auxiliar: o shell do usuário, na pasta da sessão, ao lado do terminal do agente. `Ctrl+Shift+"` (a tecla `'` com `Shift`), o botão **Terminal** no topo da sessão ou a paleta abrem e fecham.
- **O shell é o do usuário**, como o terminal dele o abre: PowerShell (o `pwsh`, se existir) com o perfil no Windows, `$SHELL` no Linux. Nenhum comando vai junto (`interactiveShell`, em `src/core/agents/shellCommand.ts`, ao lado de `wrapInShell`, sem saber de agente).
- **No core**, é um segundo PTY da sessão, com o id `<sessão>:aux`, sem adaptador, sem `SignalAggregator` e sem aviso. O que se digita nele vai direto ao PTY dele: não passa pelo adaptador do agente nem mexe no estado da sessão. O fluxo até a tela (histórico sem tela, envio em lotes, contrapressão) é o mesmo do agente, reaproveitado (`Stream` no `SessionManager`).
- **Vida curta:** só existe enquanto aberto. Fecha (com `killTree`, sem esperar Ctrl+C, que um shell não atende) ao clicar em fechar, ao sair do shell com `exit`, ao fechar a sessão, ao trocar a pasta da sessão (ele estava na pasta antiga; o diálogo avisa) e ao fechar o app. Ao reabrir o app, volta fechado. Parar o agente não o fecha.
- **Na tela:** embaixo do terminal do agente, ou à direita (**Preferências → Layout → Terminal auxiliar**), com uma divisória arrastável. Rótulo, cor de borda própria e cabeçalho com a pasta; o terminal que tem o teclado fica marcado. `Ctrl+Shift+T` volta ao do agente.
- **Memória:** um xterm só, o da sessão à vista; o histórico fica no main, com no máximo 500 linhas.
- **IPC:** `aux:open` e `aux:close`. Os canais `terminal:*` passam a aceitar o id do auxiliar; `terminal:attach`, `terminal:input` e `terminal:screenText` recusam um id que não seja de uma sessão existente ou do auxiliar aberto dela.

Fica de fora: várias abas de terminal por sessão, divisão arbitrária da tela, sessões que são só um shell, guardar o auxiliar aberto entre aberturas do app.

## Alternativas consideradas

- **Sessões que são só um shell, na lista.** Resolveria o mesmo caso, mas o shell viraria uma sessão com estado, aviso e painel de mudanças que não fazem sentido para ele, e a lista se encheria de terminais.
- **Várias abas por sessão.** É o começo de um emulador de terminal com abas; um shell ao lado cobre o caso comum sem abrir essa porta.
- **Manter o xterm do auxiliar montado em cada sessão.** Trocar de sessão seria instantâneo também no auxiliar, mas cada xterm custa memória ([ADR 0009](0009-meta-de-consumo-de-recursos.md)); o histórico no main já devolve a tela ao voltar.
- **Encerrar com Ctrl+C antes, como o agente.** Um shell não sai com Ctrl+C, só esperaria o prazo à toa.

## Consequências

- O app passa a abrir um processo que não é o agente: o shell da pessoa, que roda o que ela digitar. Não muda o que o app faz por conta própria; ele só abre o shell a pedido.
- `src/shared/session.ts` ganha `auxTerminalId`, `parseTerminalId` e `SessionView.auxOpen`; `src/shared/layout.ts`, o lugar do auxiliar; `src/shared/shortcuts.ts`, a ação `toggleAux`.
- O `npm run measure` ganhou a linha "10 sessões + terminal auxiliar".

## Riscos e mitigação

| Risco | Mitigação |
|---|---|
| O shell, ou o que ele rodou, sobreviver à sessão | `killTree` ao fechar o auxiliar, a sessão ou o app; testado no core |
| Memória com muitos auxiliares | Abre só sob demanda; um xterm por vez; histórico menor; medido |
| Confundir os dois terminais | Rótulo, cor e cabeçalho próprios; foco marcado; `Ctrl+Shift+T` volta ao agente |
| O atalho não existir em um teclado | São dois de fábrica (`Ctrl+Shift+"` e `Ctrl+Shift+'`), e o editor de atalhos troca; o botão e a paleta não dependem de tecla |
| Perfil do PowerShell lento ou com erro | É o mesmo shell que a pessoa abre no terminal dela; o erro aparece no próprio auxiliar |
