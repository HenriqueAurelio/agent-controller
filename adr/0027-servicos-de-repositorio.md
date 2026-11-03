# 0027 — Serviços de repositório (GitHub e GitLab)

- **Status:** Aceita
- **Revisão:** o item 3 ("Só leitura") foi revisto pela [ADR 0028](0028-escrever-nos-servicos-de-repositorio.md), que deixa o app publicar revisões e fazer merge a pedido da pessoa.
- **Data:** 2026-10-31
- **Funcionalidade:** [`docs/v2/acompanhar-prs`](../docs/v2/acompanhar-prs/README.md)

## Contexto

Até aqui o app não falava com nenhum serviço na internet: tudo vinha do disco, do git e dos agentes. Acompanhar PRs e pipelines exige consultar o serviço onde o repositório está, com a conta da pessoa.

## Decisão

1. **O login é o do CLI do serviço**, e o app não guarda token nenhum.
   - **GitHub:** o processo principal roda `gh auth token` e guarda o token só na memória. O token não vai para a interface e não é gravado.
   - **GitLab:** cada chamada passa pelo `glab api`. O `glab` não entrega o token (não há `glab auth token`), renova sozinho o login OAuth e conhece os servidores da empresa (`--hostname`); o app nunca vê o token.
2. **Só GitHub e GitLab.** O Bitbucket fica fora: não tem CLI oficial, e entrar com ele exigiria guardar um token no app.
3. **Só leitura.** O app consulta PRs, MRs, pipelines e logs de jobs. Comentar, aprovar e fazer merge ficam fora até uma decisão própria.
4. **Só o que a pessoa pediu.** Sem repositório na lista, nada é consultado e nenhum CLI roda. Os repositórios ficam nas preferências.
5. **Um adaptador por serviço** em `src/core/forges`, com o mesmo formato (`ForgeClient`). A interface e o main só conhecem `PullsState` e `PullRequestView`, como os agentes só são conhecidos por perfil e adaptador.
6. **O serviço vem do nome do repositório.** `dono/nome` é GitHub; `servidor/grupo/projeto` é GitLab (nomes de conta do GitHub não têm ponto, e o primeiro trecho com ponto é o servidor).
7. **A consulta é do processo principal**, uma por repositório, a cada minuto, mais espaçada acima de 15 repositórios, porque o limite por hora da API é o mesmo do CLI da pessoa. Cada serviço é consultado à parte: um fora do ar não esconde o outro.

## Alternativas consideradas

- **Token colado nas preferências.** Mais um segredo para guardar, exportar sem querer e renovar. O CLI já tem o login, e a pessoa já o renova.
- **GitHub também por `gh api`.** Um processo por repositório por minuto. Com o token do `gh` e `fetch`, é um processo por sessão do app. No GitLab não há essa escolha: o token não sai do `glab`, e um token OAuth copiado venceria em duas horas.
- **GitLab pelo token do arquivo de configuração do `glab`.** O `glab` guarda o login no chaveiro do sistema, e o formato desse arquivo não é contrato.
- **A interface consultar os serviços direto.** O renderer não acessa a rede nem segredos ([ADR 0010](0010-shell-do-app-electron.md)).

## Consequências

- O app passa a fazer chamadas de rede quando há repositórios observados. Sem eles, continua sem rede, como antes.
- Uma falha não derruba nada: o último estado fica na tela, com o motivo. Um repositório com erro não esconde os outros, e um serviço fora do ar não esconde o outro.
- No GitLab, cada consulta é um processo `glab` (cerca de 1 s de partida, 3 s com a resposta, medido). Até 4 rodam ao mesmo tempo, uma vez por minuto.
- GitLab com porta própria no endereço (`gitlab.empresa.com:8443`) e GitHub Enterprise ficam de fora: o primeiro trecho do nome não traz porta, e o GitHub é sempre `api.github.com`.
- A memória do processo principal cresce com os PRs lidos (algumas centenas de objetos pequenos); dentro da [ADR 0009](0009-meta-de-consumo-de-recursos.md).
