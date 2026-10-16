# Worktree por sessão

- **Estado:** implementada ([ADR 0017](../../../adr/0017-sessoes-em-worktree.md)). Dois ajustes no caminho: a pasta das cópias e o comando de preparação ficam no `sessions.json`, não nas preferências (não vão na exportação), e o vigia do painel passou a olhar a pasta privada da cópia dentro do `.git` de origem, onde ficam o índice e o HEAD dela.
- **ADR:** nova, "Sessões em worktree"; emenda a 0012 (o app passa a criar e remover worktrees, que são operações do git).

## O problema

O app existe para rodar vários agentes ao mesmo tempo. Mas dois agentes na mesma pasta pisam um no outro: um roda os testes enquanto o outro está no meio de uma edição, os dois mexem no mesmo arquivo, o painel de mudanças mistura o trabalho dos dois. Hoje a saída é clonar o repositório à mão, uma vez por tarefa.

## A ideia

Ao criar uma sessão, a opção **Trabalhar numa cópia isolada** cria um `git worktree` numa branch nova e abre o agente lá. Cada sessão tem a sua pasta e a sua branch; o repositório e o histórico são os mesmos.

```
~/projetos/api                     ← repositório original (sessão "revisão")
~/.agent-controller/worktrees/api/
  ├─ corrigir-login/               ← branch ac/corrigir-login (sessão "login")
  └─ paginar-relatorio/            ← branch ac/paginar-relatorio (sessão "relatório")
```

## Como fica para quem usa

- **Nova sessão:** caixa "Cópia isolada (git worktree)", com o nome da branch sugerido a partir do nome da sessão e a branch de base (a atual, de fábrica). Só aparece se a pasta for um repositório git.
- A sessão mostra a branch no topo, com um ícone de cópia isolada.
- **Ao fechar a sessão**, o app pergunta o que fazer com a cópia:
  - **Manter** (de fábrica): a pasta e a branch continuam; dá para abrir outra sessão nela depois.
  - **Remover a cópia**: só se não houver mudanças sem commit. Com mudanças, o app diz quais e não remove.
  - A branch nunca é apagada pelo app.
- **Abrir o PR** fica com a pessoa ou com o agente. O app não faz push.
- **Preferências → Sessões:** pasta onde as cópias ficam (de fábrica, `~/.agent-controller/worktrees`) e um comando opcional para preparar a cópia (`npm ci`), rodado uma vez ao criar.

## Onde entra na arquitetura

- `src/core/git/WorktreeService.ts`: `create(repo, branch, base, folder)`, `status(folder)`, `remove(folder)` usando o binário do git, como o `GitService`. É o primeiro código do app que **altera** um repositório, então fica separado do `GitService`, que continua só lendo.
- `Session` ganha `worktree?: { repoRoot, branch, base, managed: true }`.
- O `SessionManager` cria a cópia antes de iniciar o agente; falhou, a sessão não é criada e o erro aparece no diálogo.
- O painel de mudanças funciona sem mudança: a pasta da sessão é um repositório (worktree) e "Comparar com o último commit" já faz o certo. Um modo novo, **Comparar com a base**, mostra tudo o que a branch mudou desde que saiu da base (`git diff <base>...`).
- Os agentes perguntam se confiam na pasta nova: isso é deles, e o README avisa.

## Riscos

| Risco | Como fica |
|---|---|
| Perder trabalho ao remover a cópia | Remover recusa com mudanças sem commit; branch nunca apagada |
| Cópias esquecidas ocupando disco | Preferências listam as cópias, com tamanho e data, e a sessão que as usa |
| Windows: caminho longo dentro de `node_modules` da cópia | Pasta de fábrica curta; `core.longpaths` documentado |
| `npm ci` em cada cópia demora e ocupa espaço | Comando de preparação é opcional e visível |
| Branch com nome inválido | Validação com `git check-ref-format` antes de criar |
| Agentes pedindo confiança a cada cópia | Documentado; fora do controle do app |
