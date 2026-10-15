# Terminal auxiliar

- **Estado:** proposta, escolhida para a primeira leva.
- **ADR:** nova; revê dois itens que a [ADR 0007](../../../adr/0007-escopo-do-v1.md) deixou de fora (shell puro e divisão de tela), só no formato descrito aqui.

## O problema

Enquanto o agente trabalha, a pessoa quer rodar algo na mesma pasta: subir o servidor, olhar um log, rodar um teste específico, `git log`. Hoje isso é outra janela de terminal, que é justamente o que o app existe para evitar. Digitar no terminal do agente não serve: ele está ocupado, e o que for digitado vira prompt.

## A ideia

Cada sessão pode abrir **um terminal auxiliar**: um shell comum, na pasta da sessão, ao lado do terminal do agente.

- `Ctrl+Shift+'` (ou botão no topo da sessão) abre ou fecha. Ele fica embaixo do terminal do agente, com divisória arrastável; a posição segue o mesmo editor de layout das outras partes.
- É o shell do usuário (o mesmo que roda o comando do agente: PowerShell no Windows, `$SHELL` no Linux), com o perfil carregado.
- Não tem estado de agente, aviso nem painel de mudanças próprio: é da sessão.
- Fecha junto com a sessão. Ao reabrir o app, volta fechado.

Fica fora: várias abas de terminal por sessão, divisão arbitrária de tela, sessões que são só shell. Esses são outros produtos; um terminal ao lado cobre o caso comum sem abrir essa porta.

## Onde entra na arquitetura

- O `PtyManager` já sabe rodar processos em PTY. O terminal auxiliar é um segundo PTY por sessão, com id próprio (`<sessionId>:aux`), sem adaptador de agente e sem `SignalAggregator`.
- O `terminalPool` do renderer ganha o segundo terminal; o canal `terminal:*` passa a aceitar o id do auxiliar, validado no main (só ids que existem).
- Memória: cada xterm custa. O auxiliar só existe enquanto aberto, e o scrollback dele é menor. `npm run measure` com 10 sessões e um auxiliar aberto entra no PR.

## Riscos

| Risco | Como fica |
|---|---|
| Processo do shell sobreviver à sessão | Mesmo `killTree` do agente, ao fechar o auxiliar ou a sessão |
| Memória com muitos auxiliares | Só abre sob demanda; medido |
| Confundir os dois terminais | Rótulo e cor de borda diferentes; o foco é visível; `Ctrl+Shift+T` vai para o do agente |
| Atalhos que o shell usa | Mesma regra dos atalhos de hoje: só `Ctrl`/`Alt`/função, e nada do que o terminal precisa |
