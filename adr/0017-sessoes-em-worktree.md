# 0017 — Sessões em worktree

- **Status:** Aceita
- **Data:** 2026-10-16
- **Emenda:** [ADR 0012](0012-see-changes-permite-editar.md), em que o app não rodava nenhum comando do git que altere o repositório. Agora ele cria e remove worktrees, e a branch de cada uma, e nada além disso. O resto da 0012 continua valendo.

## Contexto

O app existe para rodar vários agentes ao mesmo tempo. Dois agentes na mesma pasta, porém, pisam um no outro: um roda os testes enquanto o outro está no meio de uma edição, os dois mexem no mesmo arquivo, e o painel de mudanças mistura o trabalho dos dois. Hoje a saída é clonar o repositório à mão, uma vez por tarefa. É a proposta 5 de [`docs/funcionalidades`](../docs/funcionalidades/worktree-por-sessao/README.md).

## Decisão

### Criar

- Na **Nova sessão**, a caixa **Cópia isolada (git worktree)** aparece quando a pasta está num repositório git. Marcada, pede o nome da **branch nova** (sugerido a partir do nome da sessão: `ac/<nome>`) e de onde ela parte (a branch atual, de fábrica, ou outra local).
- O app roda `git worktree add -b <branch> -- <pasta> <base>` e abre a sessão na cópia. Antes, confere o que dá para conferir: o nome com `git check-ref-format --branch`, que a branch ainda não existe, que a base é um commit, que a pasta de destino não existe. Qualquer recusa vira um erro no próprio diálogo, e nenhuma sessão é criada.
- A cópia vai para `<pasta das cópias>/<repositório>/<branch>`. A pasta das cópias é `~/.agent-controller/worktrees` de fábrica, curta para não esbarrar no limite de caminho do Windows, e pode ser trocada em **Preferências → Sessões**.
- **Preparar a cópia:** um comando opcional (`npm ci`), em **Preferências → Sessões**, roda uma vez na cópia, no shell do usuário e sem terminal, como as verificações ([ADR 0014](0014-verificacoes-ao-fim-do-turno.md)), antes de a sessão existir. Se falhar, a sessão não é criada, e o erro traz o fim da saída; a cópia e a branch ficam, porque o app não apaga nada sem que peçam.
- O comando de preparação e a pasta das cópias ficam no `sessions.json`, **fora das preferências**: importar um arquivo de configurações não pode trazer um comando que o app roda sozinho.

### Usar

- A sessão guarda `worktree: { repoRoot, branch, base }`, validado ao ler o `sessions.json`. O topo da sessão mostra a branch com o ícone ⑂.
- O painel de mudanças funciona como em qualquer repositório: a pasta da sessão é a cópia. Ganha a base **"A base da branch"**, só nessas sessões, com tudo o que a branch mudou desde que saiu da base: commits e o que ainda não tem commit (`git merge-base <base> HEAD`, comparado com o estado atual da pasta).
- O índice e o HEAD de uma cópia ficam na pasta `.git/worktrees/<nome>` do repositório de origem, fora da cópia. O vigia do painel passa a olhar também essa pasta, para que um commit feito na cópia apareça.
- **Duplicar** uma sessão em cópia abre a nova na **mesma** cópia, sem criar outra; enquanto duas sessões dividem uma cópia, uma faixa no topo avisa que as duas mexem nos mesmos arquivos.

### Fechar e remover

- Ao fechar uma sessão em cópia, o app pergunta o que fazer com ela: **Manter** (de fábrica) ou **Remover a cópia**.
- Remover só é oferecido quando nada na cópia está sem commit e nenhuma outra sessão trabalha nela. Com mudanças, o diálogo lista os arquivos e a opção fica desligada; o app confere de novo depois de parar o agente e, se algo apareceu, não remove e a sessão fica.
- A remoção é `git worktree remove`, **nunca** com `--force`. A **branch nunca é apagada** pelo app.
- **Preferências → Sessões** lista as cópias (as das sessões e as que estão na pasta das cópias), com branch, tamanho, data e as sessões que as usam, e remove as que nenhuma sessão usa, com as mesmas regras.

### O que o app continua sem fazer

Commit, push, merge, apagar branch, `--force`. Abrir o PR fica com a pessoa ou com o agente.

## Alternativas consideradas

- **Clonar o repositório para cada sessão.** Isola igual, mas copia o histórico inteiro e cria repositórios soltos; o worktree divide os objetos com o original e as branches aparecem nele.
- **Remover a cópia ao fechar, de fábrica.** Mais limpo, mas um clique errado apagaria trabalho que só existe nela.
- **`git worktree remove --force` quando há arquivos sem commit, com confirmação.** Uma confirmação a mais não traz o trabalho de volta.
- **Comando de preparação nas preferências.** Iria no arquivo de exportação, e importar faria o app rodar um comando novo sem a pessoa ver.
- **Uma sessão por cópia, sem duplicar.** Duplicar na mesma cópia serve para ter dois agentes olhando o mesmo trabalho; o aviso deixa claro o que isso significa.

## Consequências

- O app passa a **alterar** repositórios: cria worktrees e branches e remove worktrees. Isso fica em `src/core/git/WorktreeService.ts`, separado do `GitService`, que continua só lendo.
- O contrato de IPC ganhou `worktrees:inspect`, `worktrees:status`, `worktrees:list`, `worktrees:configure` e `worktrees:remove`; `sessions:create` aceita `worktree` e `sessions:remove` aceita o que fazer com a cópia. `worktrees:remove` só remove uma pasta da lista que o próprio main monta, nunca um caminho qualquer vindo do renderer.
- Os agentes perguntam se confiam em cada pasta nova; uma cópia é uma pasta nova. Isso é deles, e o README avisa.

## Riscos e mitigação

| Risco | Mitigação |
|---|---|
| Perder trabalho ao remover a cópia | Só sem nada sem commit; sem `--force`; branch nunca apagada; conferido de novo depois de parar o agente |
| Cópias esquecidas ocupando disco | Lista em Preferências → Sessões, com tamanho, data e quem usa |
| Caminho longo no Windows dentro de `node_modules` da cópia | Pasta de fábrica curta; `core.longpaths` citado no README |
| `npm ci` demorado em cada cópia | Opcional, visível no diálogo de nova sessão, com prazo de 15 minutos |
| Nome de branch inválido | `git check-ref-format --branch` antes de criar |
| O vigia não ver o commit feito na cópia | O vigia olha também a pasta privada da cópia dentro do `.git` de origem; testado no core e no e2e |
