# Operações de git no painel

- **Estado:** implementada, a proposta completa ([ADR 0018](../../../adr/0018-operacoes-de-git-no-painel.md), que substitui a parte da [ADR 0012](../../../adr/0012-see-changes-permite-editar.md) sobre operações de git). O descarte usa `git reset` + `git checkout` em vez de `git restore`, que exige git 2.23.
- **ADR:** nova, que substitui a parte da 0012 sobre operações de git.

## O problema

Revisado o que o agente fez, o passo seguinte quase sempre é: aceitar parte, jogar fora parte e fazer commit. Hoje isso é sair do app ou pedir ao agente ("faça commit só de X"), o que custa um turno e às vezes erra o que entra.

## A ideia

Três operações, e só elas, com cuidado proporcional ao risco:

| Operação | Onde | Proteção |
|---|---|---|
| **Stage / unstage** por arquivo | Caixa ao lado do arquivo na lista | Reversível; nenhuma confirmação |
| **Commit** do que está em stage | Campo de mensagem no rodapé do painel | Mostra a lista do que entra; sem `--amend`, sem push |
| **Descartar** as mudanças de um arquivo | Menu do arquivo | Confirmação com o nome; **antes de descartar, o app guarda uma cópia** em `~/.agent-controller/descartados/<data>/`, e o aviso depois tem **Desfazer** |

Fica de fora: push, pull, branch, merge, rebase, stash, `--amend`, descartar tudo de uma vez. "Comparar com o início da sessão" continua como hoje.

## Por que reabrir a decisão

- O motivo da 0012 era o descarte sem volta. A cópia antes de descartar e o **Desfazer** tiram esse risco do caso comum.
- O stage por arquivo é reversível e é o que permite usar o painel como etapa de revisão de verdade: o que está em stage é o que foi aprovado.
- Com [worktree por sessão](../worktree-por-sessao/README.md), o commit no painel fecha o ciclo de uma tarefa sem sair do app.

Se isso não convencer, a alternativa menor é **só o stage** (aprovar arquivo por arquivo), que já ajuda a revisão e não apaga nada.

## Onde entra na arquitetura

- `src/core/git/GitWriteService.ts`, separado do `GitService` (que continua só lendo, com `--no-optional-locks`). Comandos: `git add -- <arquivo>`, `git restore --staged -- <arquivo>`, `git commit -F -` (mensagem pelo stdin), `git restore -- <arquivo>` / remoção de não rastreado depois da cópia.
- Cada arquivo validado no main como já é no `git:save`: dentro do repositório, nunca `.git`.
- Bloqueio: com o agente trabalhando, descartar e commit pedem confirmação extra ("o agente está mexendo nesta pasta").
- O hook de commit do repositório roda (não usar `--no-verify`); a saída dele aparece se falhar.

## Riscos

| Risco | Como fica |
|---|---|
| Descartar trabalho por engano | Cópia antes, Desfazer depois, nunca em lote |
| Commit enquanto o agente escreve | Confirmação extra com o agente trabalhando |
| Hook de commit lento ou interativo | Prazo; sem TTY; saída mostrada |
| Lock do índice (`index.lock`) com o agente também usando git | Erro claro com "tente de novo"; nunca apagar o lock |
| Escopo crescer para um cliente de git | Lista fechada de operações na ADR |
