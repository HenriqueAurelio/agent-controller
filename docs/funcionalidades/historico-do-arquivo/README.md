# Histórico do arquivo

- **Estado:** proposta, leva 2.
- **ADR:** nenhuma nova. Só lê o git.

## O problema

Revisando uma mudança do agente, a pergunta seguinte costuma ser "por que essa linha estava assim?" ou "isso já foi mexido antes?". O painel compara só com o último commit ou com o início da sessão. Para ver o histórico, a pessoa sai do app.

## A ideia

No editor do painel, duas coisas que o VS Code e o Zed têm:

- **Histórico:** a lista de commits que mexeram no arquivo, e o diff de cada um.
- **Autoria (blame):** na margem, quem mudou cada linha, quando e em qual commit.

## Como fica para quem usa

- Ao lado do nome do arquivo, **Histórico** abre a lista: mensagem, autor, data e hash curto, seguindo renomeações. Clicar mostra o diff daquele commit no arquivo.
- **Comparar com este commit:** troca o "Comparar com" do painel por aquele commit, só para este arquivo.
- **Autoria** (botão, ou `Ctrl+Alt+B`): uma coluna na margem com autor e data de cada linha; passar o mouse mostra a mensagem do commit. As linhas ainda sem commit aparecem como "Não commitado". Liga e desliga, e a escolha fica guardada.
- Fora do git, os botões não aparecem.

## Onde entra na arquitetura

- **Core:** `src/core/git/HistoryService.ts` com `log(file)` (`git log --follow --format=… -z -- arquivo`, até 200 commits) e `blame(file)` (`git blame --porcelain`, com o texto do disco para incluir as linhas não commitadas: `--contents -`).
- **DiffBase nova:** `{ kind: 'commit', sha }`. O `sha` é validado no main: hexadecimal, e existente com `git cat-file -e`.
- **IPC:** `git:log(sessionId, file)`, `git:blame(sessionId, file)`, e o `git:diff` de hoje com a base nova.
- **Renderer:** o blame vira decorações do Monaco (`before` na margem), pelo `diffProtocol`. Ele é recalculado ao salvar, não a cada tecla.

## Riscos

| Risco | Como fica |
|---|---|
| `blame` lento em arquivo com muito histórico | Calculado só quando ligado, com prazo; mostra "carregando" |
| Hash vindo do renderer | Validado no main, como qualquer argumento |
| Margem apertada | Autor e data curtos; o resto fica na dica ao passar o mouse |
