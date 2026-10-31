# 0027 — Serviços de repositório (GitHub, depois GitLab e Bitbucket)

- **Status:** Aceita
- **Data:** 2026-10-31
- **Funcionalidade:** [`docs/v2/acompanhar-prs`](../docs/v2/acompanhar-prs/README.md)

## Contexto

Até aqui o app não falava com nenhum serviço na internet: tudo vinha do disco, do git e dos agentes. Acompanhar PRs e pipelines exige consultar o serviço onde o repositório está, com a conta da pessoa.

## Decisão

1. **O login é o do CLI do serviço** (`gh` no GitHub, `glab` no GitLab). O processo principal pede o token ao CLI e o guarda só na memória. O token não vai para a interface e não é gravado. O Bitbucket, sem CLI oficial, vai precisar de um token guardado com `safeStorage`; isso fica para a ADR dele.
2. **Só leitura.** O app consulta PRs, pipelines e logs de jobs. Comentar, aprovar e fazer merge ficam fora até uma decisão própria.
3. **Só o que a pessoa pediu.** Sem repositório na lista, nada é consultado e o CLI nem roda. Os repositórios ficam nas preferências.
4. **Um adaptador por serviço** em `src/core/forges`, com o mesmo formato (`ForgeClient`). A interface e o main só conhecem `PullsState` e `PullRequestView`, como os agentes só são conhecidos por perfil e adaptador.
5. **A consulta é do processo principal**, uma por repositório, a cada minuto, mais espaçada acima de 15 repositórios, porque o limite por hora da API é o mesmo do CLI da pessoa.

## Alternativas consideradas

- **Token colado nas preferências.** Mais um segredo para guardar, exportar sem querer e renovar. O CLI já tem o login, e a pessoa já o renova.
- **Rodar `gh pr list` / `gh api` a cada consulta.** Um processo por repositório por minuto, e o formato da saída muda com a versão do `gh`. O token do `gh` com `fetch` é um processo por sessão do app.
- **A interface consultar o GitHub direto.** O renderer não acessa a rede nem segredos ([ADR 0010](0010-shell-do-app-electron.md)).

## Consequências

- O app passa a fazer chamadas de rede quando há repositórios observados. Sem eles, continua sem rede, como antes.
- Uma falha do serviço não derruba nada: o último estado fica na tela, com o motivo, e um repositório com erro não esconde os outros.
- A memória do processo principal cresce com os PRs lidos (algumas centenas de objetos pequenos); dentro da [ADR 0009](0009-meta-de-consumo-de-recursos.md).
