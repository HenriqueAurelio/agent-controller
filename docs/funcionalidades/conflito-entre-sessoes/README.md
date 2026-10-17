# Conflito entre sessões

- **Estado:** feita, leva 1.
- **ADR:** nenhuma nova. Só lê o git, como o painel de mudanças.

## O problema

As cópias isoladas evitam que dois agentes escrevam no mesmo arquivo ao mesmo tempo, mas não evitam o conflito na hora de juntar as branches. Duas sessões no mesmo repositório, cada uma na sua cópia, podem mexer no mesmo `SessionManager.ts` e só descobrir isso no merge. Hoje o app só avisa quando duas sessões dividem **a mesma** cópia.

## A ideia

O app cruza os arquivos que cada sessão mudou, em todas as cópias e pastas do mesmo repositório, e avisa quando duas sessões mexem no mesmo arquivo. Se o mesmo trecho for tocado nas duas, o aviso fica mais forte.

## Como fica para quem usa

- Na barra lateral, a sessão ganha um **⚠** com a contagem: "2 arquivos também mudados em “refatorar-ipc”".
- No painel de mudanças, o arquivo em comum tem a mesma marca. Passar o mouse mostra a outra sessão, e um clique abre o mesmo arquivo nela.
- **Mesmo trecho:** quando as duas mudanças se sobrepõem (as linhas alteradas se cruzam), o aviso diz "provável conflito". Sem sobreposição, diz só "mesmo arquivo".
- A comparação vale para o que ainda não tem commit e para os commits da branch desde a base, os mesmos de **A base da branch**.
- Uma preferência desliga o aviso, e outra decide se ele conta também as sessões paradas.

## Onde entra na arquitetura

- **Core:** `src/core/git/OverlapService.ts`. Junta as sessões pelo repositório de verdade (`git rev-parse --git-common-dir`, com `toLongPath` e sem diferenciar maiúsculas no Windows). Para cada sessão, pega a lista de arquivos mudados com os caminhos relativos à raiz, que já sai do `ChangesService`. A sobreposição de trechos usa os intervalos dos hunks (`git diff -U0`), só nos arquivos em comum.
- **Quando recalcula:** quando o `RepoWatcher` de uma das sessões avisa de mudança, com espera e um teto de uma vez a cada poucos segundos por repositório. Sessão sem painel aberto não ganha watcher novo: usa o fim do turno.
- **IPC:** a contagem vai no `SessionView` (`overlaps`), e `git:overlaps(sessionId)` devolve o detalhe.

## Riscos

| Risco | Como fica |
|---|---|
| Custo de rodar `git diff` em muitas sessões | Só nos arquivos em comum, com teto de frequência; medido com 10 sessões no mesmo repositório |
| Falso alarme em arquivo gerado (`package-lock.json`) | Lista de arquivos ignorados pelo aviso, editável, com o lockfile já incluído |
| Caminhos iguais escritos diferente no Windows | Comparação com `toLongPath` e sem diferenciar maiúsculas |
