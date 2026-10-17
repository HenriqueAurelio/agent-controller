# Abrir no editor externo

- **Estado:** proposta, leva 2.
- **ADR:** nenhuma nova. É mais um caso de "o app roda um comando que a pessoa escolheu" ([ADR 0013](../../../adr/0013-comando-do-usuario-no-lugar-do-agente.md)).

## O problema

O painel edita, mas não é uma IDE, e não quer ser. Quando a pessoa precisa de depuração, refatoração ou extensões, ela abre o VS Code, procura a pasta e procura o arquivo de novo.

## A ideia

Um botão e um atalho: **Abrir no editor**. Abre o arquivo do painel na mesma linha, ou a pasta da sessão, no editor que a pessoa escolheu.

## Como fica para quem usa

- **Preferências → Editor externo:** VS Code, Cursor, Zed, Windsurf, ou **Outro**, com um comando que tem `{pasta}`, `{arquivo}`, `{linha}` e `{coluna}`. O app mostra quais dos conhecidos achou instalados.
- No topo da sessão, **Abrir no editor** abre a pasta (de uma cópia isolada, abre a cópia).
- No painel, ao lado do nome do arquivo, o mesmo botão abre o arquivo na linha do cursor. Atalho `Ctrl+Alt+O`, editável (o `Ctrl+Shift+O` fica com o [painel geral](../painel-geral/README.md)).
- O link do terminal com `Ctrl+Shift+clique` abre direto no editor externo ([links no terminal](../links-no-terminal/README.md)).
- Sem editor configurado, o botão leva às preferências.

## Onde entra na arquitetura

- **Core:** `src/core/tools/externalEditor.ts`, com os perfis dos editores conhecidos: `code -g arquivo:linha:coluna`, `cursor -g …`, `zed arquivo:linha:coluna`, `windsurf -g …`. A detecção procura no `PATH`, com o mesmo código de `agents/detect.ts`.
- **Windows:** `code` e `cursor` são `.cmd`. Eles rodam pelo `cmd.exe /d /s /c` com os argumentos escapados (o mesmo cuidado de `windowsArgs.ts`), nunca montando uma linha de shell com o caminho dentro.
- **Outro:** o comando da pessoa roda no shell dela, como o comando do agente, com as variáveis substituídas e escapadas.
- O processo sai sem prender o app (`detached`, sem esperar).
- **IPC:** `editor:detect`, `editor:open(sessionId, { file?, line?, column? })`. O caminho é validado dentro da pasta da sessão.

## Riscos

| Risco | Como fica |
|---|---|
| Caminho com espaço ou acento no Windows | Escape testado com `.cmd`; caminho com espaço, acento e `&` |
| WSL2 abrindo o VS Code do Windows | `code` no WSL já faz a ponte (Remote WSL); testado e anotado no README |
| Comando "Outro" usado para algo perigoso | É a pessoa quem escreve, como o comando do agente; não vai na exportação das preferências |
