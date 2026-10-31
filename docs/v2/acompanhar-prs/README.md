# Acompanhar PRs e pipelines

- **Estado:** implementada para o GitHub e o GitLab (gitlab.com e GitLab da empresa). O Bitbucket fica fora.
- **ADR:** [0027](../../../adr/0027-servicos-de-repositorio.md), a primeira vez que o app consulta um serviço na internet.
- **De onde veio:** o Maestro tem uma inbox de MRs do GitLab e um vigia dos MRs da pessoa. Daqui veio a ideia de juntar, numa tela, os pipelines dos meus PRs e os PRs abertos do time.

## O problema

Com vários PRs abertos ao mesmo tempo, saber qual pipeline quebrou é abrir aba por aba no navegador. Os PRs dos colegas que esperam revisão ficam espalhados por repositórios e notificações por e-mail. E, quando um pipeline quebra, levar o erro até o agente é copiar o log, achar a sessão da branch e colar.

## O que muda

Um painel **Pull requests**, aberto com `Ctrl+Shift+U` ou pelo botão **⇄** no topo da barra lateral. Ele ocupa o lugar do terminal, como o quadro de tarefas. PRs do GitHub e MRs do GitLab aparecem juntos, agrupados por repositório; os do GitLab têm o número com `!` (`!42`), como no site.

- **Abas:** **Meus**, **Para eu revisar** e **Todos abertos**, cada uma com a contagem. Os PRs ficam agrupados por repositório, do mais recente para o mais antigo.
- **Cada PR mostra:**
  - o estado do pipeline (bolinha verde, vermelha ou âmbar) e quantos jobs passaram;
  - autor, branch e base;
  - rascunho, aprovado, mudanças pedidas ou aguarda revisão;
  - revisores que ainda não responderam e número de comentários.

  Clicar no título abre o PR no navegador.
- **Pipeline quebrado:** os jobs que falharam aparecem embaixo, com link, e o botão **Mandar ao agente corrigir** abre o prompt "Corrigir pipeline" já preenchido.
  - O prompt traz os jobs que falharam e o fim do log de cada um.
  - A sessão de destino já vem marcada: é a que está na branch do PR, num clone desse repositório (o remote pode ser `https` ou `ssh`).
  - O texto do prompt é editável em **Preferências → Prompts**, como os outros. Ele usa as variáveis novas `{pr}` e `{pipeline}`.
- **Barra lateral:** o botão do painel mostra quantos PRs seus estão com o pipeline quebrado.
- **Avisos do sistema**, cada um ligável em separado:
  - pipeline de um PR meu falhou (uma vez por commit);
  - comentário ou revisão nova num PR meu, vindo de outra pessoa;
  - pedido de revisão para mim.

  O clique no aviso abre o painel no PR.

### Escolher os repositórios

Em **Repositórios**, no topo do painel:

- **Colar:** separados por vírgula, espaço ou linha.
  - **GitHub:** `dono/repo`, o endereço da página ou o de clone.
  - **GitLab:** o endereço do projeto, de um MR dele (`https://gitlab.com/grupo/projeto/-/merge_requests/3`) ou de clone (`git@gitlab.empresa.com:time/app.git`). O app guarda `servidor/grupo/projeto`, com subgrupos.

  O que não for reconhecido aparece numa nota e continua no campo.
- **Escolher dos que tenho acesso:** lista os repositórios que as contas enxergam, com filtro e uma caixa para cada um.
  - **GitHub:** até 300, os de push mais recente primeiro.
  - **GitLab:** até 100 por servidor, os de atividade mais recente primeiro. Os servidores são o padrão do `glab` e os de cada projeto já observado.
- **Copiar a lista:** copia os nomes separados por vírgula, para colar em outra máquina.
- **Conta do gh:** vazio usa a conta ativa. Com mais de uma conta logada no `gh`, escreva o usuário que enxerga esses repositórios. A conta ativa do `gh` não muda. No GitLab não há escolha: o `glab` tem um login por servidor.

No máximo 40 repositórios, somando os dois serviços. A lista e a escolha dos avisos ficam nas preferências e vão junto na exportação.

## Como funciona

- **Login, GitHub:** o do GitHub CLI. O processo principal roda `gh auth token` (ou `gh auth token --user <conta>`) e guarda o token só na memória. O token não vai para a interface, não é gravado em disco e é pedido de novo se o GitHub o recusar.
- **Login, GitLab:** o do GitLab CLI. Cada consulta roda `glab api graphql --hostname <servidor>`, com a consulta pela entrada padrão; o `glab` põe o login, renova o token OAuth quando ele vence e fala com o servidor da empresa. O app nunca vê o token.
- **Sem o CLI, ou sem login:** o painel diz o que fazer, para cada serviço (`gh auth login`, ou `glab auth login --hostname <servidor>`). Um servidor do GitLab sem login não esconde os projetos dos outros.
- **Consulta:** GraphQL, uma consulta por repositório, até 4 ao mesmo tempo, a cada minuto. Acima de 15 repositórios, as consultas se espaçam (4 s por repositório: 30 repositórios, a cada 2 minutos), porque o limite de uso da API por hora é o mesmo do CLI da pessoa.
  - Um repositório que demora demais (504 ou 30 s sem resposta) recebe uma nova tentativa menor: 8 PRs em vez de 20, e 15 jobs por PR em vez de 30. Se falhar de novo, só ele mostra o erro.
  - No GitLab, os jobs que falharam vêm numa lista à parte, porque um pipeline grande tem centenas de jobs e os que falharam podem não estar entre os 30 primeiros.
  - Um serviço que não responde deixa na tela o que mostrava na consulta anterior, com uma nota; o outro continua atualizando.
  - Sem repositório na lista, o app não consulta nada e nem roda o `gh` ou o `glab`.
- **Log do job:** só quando você clica em **Mandar ao agente corrigir**. Vão os 3 primeiros jobs que falharam, com no máximo 120 linhas de cada e 20 mil caracteres no total, sem as linhas só de pontos de progresso, as repetidas, as cores e o horário de cada linha.
  - **GitHub:** só de jobs do GitHub Actions do próprio repositório (verificações de outros serviços entram só com o link). O recorte termina no último `##[error]` e deixa de fora a limpeza do fim do job.
  - **GitLab:** o log é lido no projeto onde o job rodou, que é o fork quando o MR vem de um. As seções do próprio runner (preparar, baixar o código, cache, artefatos, limpeza) ficam de fora; o recorte termina em `ERROR: Job failed`. Logs de runners Windows (`\r\n`) também.
- **Avisos:** comparam uma consulta com a anterior. Na primeira consulta, e num repositório recém-adicionado, nada é novidade. "Comentário de outra pessoa" compara com a conta daquele serviço, que pode ser diferente no GitHub e no GitLab.

| Arquivo | O que faz |
|---|---|
| `src/shared/pulls.ts` | Tipos, leitura da lista colada (os dois serviços), preferências |
| `src/core/forges/forge.ts` | O formato comum (`ForgeClient`), consulta repositório a repositório |
| `src/core/forges/github.ts` | Token do `gh`, consulta GraphQL, leitura da resposta, log do job |
| `src/core/forges/gitlab.ts` | `glab api`, consulta GraphQL dos MRs, leitura da resposta, log do job |
| `src/core/forges/log.ts` | O que os dois recortes de log têm em comum |
| `src/core/forges/PullWatcher.ts` | Consulta periódica de cada serviço, último estado, avisos, texto de `{pipeline}` |
| `src/main/app.ts`, `src/main/ipc.ts` | Avisos do sistema; canais `pulls:*`; sessões da branch do PR |
| `src/renderer/src/components/PullRequests.tsx` | O painel |

O resto do app só conhece `PullsState` e `PullRequestView`.

## Medido

Rodado em 2026-10-31, no Windows 10, só lendo.

**GitHub**, com a conta HenriqueAurelio:

| Repositórios | PRs abertos lidos | Tempo da consulta |
|---|---|---|
| `HenriqueAurelio/agent-controller` e um inexistente | 0 (erro claro para o inexistente) | 0,6 s |
| `vercel/next.js`, `nodejs/node`, `microsoft/vscode`, `cli/cli`, `HenriqueAurelio/agent-controller` | 80 | 4,5 s |

- **Antes da divisão por repositório:** a consulta única com `next.js` e `node` voltava 504 depois de 11 s, e nenhum repositório aparecia.
- **Log real:** num job do `nodejs/node` que falhou (4 197 linhas), o recorte ficou com 6,5 mil caracteres e termina no teste que falhou e no `##[error]`.

**GitLab**, com `glab` 1.126 e a conta henriquesd no gitlab.com:

| Projetos | MRs abertos lidos | Tempo da consulta |
|---|---|---|
| `gitlab-org/cli`, `gitlab-org/gitlab` e um inexistente | 40 (erro claro para o inexistente) | 3,0 s |

- **Pipeline grande:** nos MRs do `gitlab-org/gitlab`, os jobs que falharam não estavam entre os 30 primeiros; com a lista à parte, aparecem.
- **Fork:** no `gitlab-org/cli!4268`, o pipeline rodou no fork do autor; o log foi lido lá (432 linhas) e termina na mensagem do `check_docs_update` e em `ERROR: Job failed: exit code 1`.
- **Runner Windows:** um log de 3 230 linhas, quase todas `Status: processing`, com `\r\n`, ficou com 1,5 mil caracteres e termina no estouro de tempo.

## O que ficou de fora

- **Bitbucket:** sem CLI oficial, exigiria guardar um token no app ([ADR 0027](../../../adr/0027-servicos-de-repositorio.md)).
- **Comentar, aprovar e fazer merge pelo app:** o painel só lê. Escrever no serviço em nome da pessoa pede outra decisão.
- **Texto dos comentários:** o aviso diz quem comentou, não o que escreveu. Ler os comentários seria mais uma consulta por PR.
- **GitHub Enterprise e GitLab com porta no endereço:** o GitHub é sempre `api.github.com`, e o nome guardado do GitLab não leva porta.
