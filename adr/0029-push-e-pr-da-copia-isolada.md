# 0029 — Push e PR da cópia isolada, e atualizar a cópia com a base

- **Status:** Aceita
- **Data:** 2026-11-03
- **Funcionalidade:** da cópia ao PR (`docs/proximas-versoes.md`, v0.4, item 7)
- **Revê:** a lista fechada da [ADR 0018](0018-operacoes-de-git-no-painel.md), que deixava push e merge fora do app

## Contexto

A sessão em cópia isolada ([ADR 0017](0017-sessoes-em-worktree.md)) termina num commit na branch dela. Daí até o PR, a pessoa saía do app: `git push`, abrir o site, criar o PR, copiar o número da issue. E, quando a base andava, trazer a base para a cópia e resolver conflitos era outro terminal. A [ADR 0028](0028-escrever-nos-servicos-de-repositorio.md) já deixou o app escrever no GitHub e no GitLab; faltava o git.

## Decisão

1. **Duas operações novas, só numa sessão em cópia isolada, e só com um clique da pessoa:**
   - **Fazer push e abrir o PR:**
     - push da branch da própria cópia para o remote dela (o da branch, ou `origin`), com `--set-upstream`;
     - nunca `--force`, nunca para a base, nunca outra branch;
     - depois, o PR no serviço do remote, com o título, a descrição e o rascunho que a pessoa vê e edita.
   - **Atualizar com a base:** um `merge --no-ff` da base dentro da cópia. É a do remote quando ele a tem (`fetch` antes), porque é com ela que o PR é comparado.
2. **Merge, não rebase.** A branch pode já estar no remote; um rebase pediria `--force` depois.
3. **O conflito fica na cópia.** O app lista os arquivos e oferece mandar ao agente um prompt com eles. Não resolve nada sozinho, não aborta o merge e não mexe na pasta principal do repositório.
4. **Com mudanças sem commit, a atualização é recusada.** O merge se misturaria com o que o agente está escrevendo. O push segue, avisando quantos arquivos ficam de fora.
5. **O login do git é o da pessoa** (credential helper, chave ssh). O app roda o git sem terminal (`GIT_TERMINAL_PROMPT=0`): se faltar credencial, o erro do git aparece na tela, e nada fica esperando uma senha.
6. **A descrição começa com os commits da branch e, se o cartão veio de uma issue, `Closes #N`.** O repositório entra na lista do painel de pull requests, para o PR aparecer ali e poder ser vigiado.

## Alternativas consideradas

- **Pedir ao agente o push e o PR.** Gasta um turno, depende de o agente ter o `gh` e acertar a base, e a pessoa não vê o texto antes.
- **Push com `--force-with-lease` depois de um rebase.** Reescreve uma branch que pode estar em revisão.
- **"Trazer para a base" com merge local na pasta principal.** Mexe na branch e na pasta que a pessoa usa, e passa por cima das regras do repositório. O PR com merge pelo serviço (ADR 0028) respeita a proteção da branch.

## Consequências

- O app passa a escrever no remote, só pela branch da cópia e só com o clique. A lista de operações de git do app agora é a da 0018 mais estas duas; uma nova pede outra ADR.
- O `git fetch` e o `git push` usam a rede e o login do git da pessoa, com prazo de 2 minutos cada.
- O merge da base cria um commit de merge na branch da cópia.
- Os testes usam um repositório "remoto" local (bare) e o GitHub falso; nada vai para um serviço de verdade.
