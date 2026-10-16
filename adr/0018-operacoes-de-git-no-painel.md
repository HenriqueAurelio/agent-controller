# 0018 — Operações de git no painel de mudanças

- **Status:** Aceita
- **Data:** 2026-10-16
- **Substitui:** a parte da [ADR 0012](0012-see-changes-permite-editar.md) que deixava as operações de git fora do painel ("é outro produto, e descartar apaga trabalho sem volta"). O resto da 0012 (o lado do arquivo editável, as regras de conflito com o agente) continua valendo.

## Contexto

Revisado o que o agente fez, o passo seguinte quase sempre é aceitar parte, jogar fora parte e fazer commit. Hoje isso é sair do app ou pedir ao agente ("faça commit só de X"), o que custa um turno e às vezes erra o que entra. É a proposta 9 de [`docs/funcionalidades`](../docs/funcionalidades/operacoes-git/README.md).

A 0012 recusou operações de git porque descartar apaga trabalho sem volta. O que mudou: descartar passa a guardar uma cópia antes, com **Desfazer** logo depois, e o stage, que é reversível, é o que torna o painel uma etapa de revisão de verdade.

## Decisão

Três operações, e só elas, com cuidado proporcional ao risco. Valem na comparação com o último commit; nas outras bases ("início da sessão", "base da branch") o painel só mostra.

| Operação | Onde | Proteção |
|---|---|---|
| **Marcar para o commit** (stage / unstage) por arquivo | Caixa ao lado do arquivo; a lista se divide em "Para o commit" e "Fora do commit" | Reversível; nenhuma confirmação. Uma mudança marcada só em parte aparece com a caixa indeterminada |
| **Commit** do que está marcado | Rodapé do painel, com a mensagem e a lista do que entra | Sem `--amend`, sem push. A mensagem vai pelo stdin. Os hooks do repositório rodam, sem terminal e com prazo de 2 minutos; se falham, a saída deles aparece e nada é feito |
| **Descartar** as mudanças de um arquivo | Botão ↺ no arquivo | Confirmação com o nome. Antes, uma cópia do arquivo vai para `~/.agent-controller/descartados/<data>/`; o aviso depois tem **Desfazer**. Cópias com mais de 30 dias saem ao abrir o app |

- **Descartar** devolve o arquivo ao que o último commit tem, índice incluído (`git reset` + `git checkout` do arquivo; um arquivo novo é apagado; um renomeado volta ao nome antigo). Não usa `git restore`, que só existe a partir do git 2.23, e o app aceita desde o 2.15.
- **Desfazer** devolve a cópia ao lugar. É recusado se o arquivo mudou depois do descarte: o que foi escrito nele (pelo agente) se perderia.
- **Com o agente trabalhando**, descartar e fazer commit pedem uma confirmação a mais ("o agente está trabalhando nesta pasta agora").
- **Lock do índice:** se o git encontra o `index.lock` (o agente usando o git ao mesmo tempo), o erro diz isso e pede para tentar de novo. O app nunca apaga o lock.
- Cada caminho que chega do renderer é validado no main como no `git:save`: dentro do repositório, nunca em `.git`. Numa sessão com vários repositórios, cada arquivo vai ao seu repositório, e o commit é feito em um repositório por vez.
- O código fica em `src/core/git/GitWriteService.ts`, separado do `GitService`, que continua só lendo.

Fica de fora, de propósito: push, pull, branch, merge, rebase, stash, `--amend`, descartar tudo de uma vez, stage de trechos de um arquivo.

## Alternativas consideradas

- **Só o stage, sem commit nem descartar.** Ajuda a revisão e não apaga nada, mas o ciclo da tarefa continuaria terminando fora do app.
- **Descartar sem cópia, como o git faz.** Era o motivo da recusa na 0012.
- **Descartar vários arquivos de uma vez.** Um clique errado leva tudo; um por vez, com cópia, cobre o caso comum.
- **`git commit --no-verify`.** Mais rápido, mas pularia as regras que o próprio repositório escolheu.
- **Stage por trecho, no diff.** Útil, mas é o começo de um cliente de git; fica para depois, se fizer falta.

## Consequências

- O painel passa a alterar o índice e a fazer commits. A lista fechada de operações acima é o limite: nova operação pede nova ADR.
- O contrato de IPC ganhou `git:stage`, `git:unstage`, `git:commit`, `git:discard` e `git:undoDiscard`. O renderer manda caminhos do painel; o main os confere e decide o repositório.
- `FileChange` ganhou `staged` (`all` ou `partial`), lido do `git status --porcelain=v2` que o painel já usava.
- O item 2.2 de [`DECISOES-E-RISCOS.md`](../DECISOES-E-RISCOS.md) e as limitações do README foram atualizados.

## Riscos e mitigação

| Risco | Mitigação |
|---|---|
| Descartar trabalho por engano | Confirmação com o nome; cópia antes; Desfazer depois; nunca em lote |
| Commit ou descarte enquanto o agente escreve | Confirmação a mais com o agente trabalhando |
| Hook de commit lento ou interativo | Prazo de 2 minutos; sem terminal; saída mostrada |
| `index.lock` com o agente também usando git | Erro claro com "tente de novo"; o lock nunca é apagado |
| Desfazer por cima do que o agente escreveu depois | Desfazer recusado quando o arquivo mudou desde o descarte |
| O escopo crescer para um cliente de git | Lista fechada de operações nesta ADR |
