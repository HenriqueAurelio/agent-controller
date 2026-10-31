# Acompanhar PRs e pipelines

- **Estado:** implementada para o GitHub. GitLab e Bitbucket vêm depois, nessa ordem, como outros adaptadores do mesmo formato.
- **ADR:** [0027](../../../adr/0027-servicos-de-repositorio.md), a primeira vez que o app consulta um serviço na internet.
- **De onde veio:** o Maestro tem uma inbox de MRs do GitLab e um vigia dos MRs da pessoa. Daqui veio a ideia de juntar, numa tela, os pipelines dos meus PRs e os PRs abertos do time.

## O problema

Com vários PRs abertos ao mesmo tempo, saber qual pipeline quebrou é abrir aba por aba no navegador. Os PRs dos colegas que esperam revisão ficam espalhados por repositórios e notificações por e-mail. E, quando um pipeline quebra, levar o erro até o agente é copiar o log, achar a sessão da branch e colar.

## O que muda

Um painel **Pull requests**, aberto com `Ctrl+Shift+U` ou pelo botão **⇄** no topo da barra lateral. Ele ocupa o lugar do terminal, como o quadro de tarefas.

- **Abas:** **Meus**, **Para eu revisar** e **Todos abertos**, cada uma com a contagem. Os PRs ficam agrupados por repositório, do mais recente para o mais antigo.
- **Cada PR mostra:**
  - o estado do pipeline (bolinha verde, vermelha ou âmbar) e quantos jobs passaram;
  - autor, branch e base;
  - rascunho, aprovado, mudanças pedidas ou aguarda revisão;
  - revisores pedidos e número de comentários.

  Clicar no título abre o PR no navegador.
- **Pipeline quebrado:** os jobs que falharam aparecem embaixo, com link, e o botão **Mandar ao agente corrigir** abre o prompt "Corrigir pipeline" já preenchido.
  - O prompt traz os jobs que falharam e o fim do log de cada um.
  - A sessão de destino já vem marcada: é a que está na branch do PR, num clone desse repositório.
  - O texto do prompt é editável em **Preferências → Prompts**, como os outros. Ele usa as variáveis novas `{pr}` e `{pipeline}`.
- **Barra lateral:** o botão do painel mostra quantos PRs seus estão com o pipeline quebrado.
- **Avisos do sistema**, cada um ligável em separado:
  - pipeline de um PR meu falhou (uma vez por commit);
  - comentário ou revisão nova num PR meu, vindo de outra pessoa;
  - pedido de revisão para mim.

  O clique no aviso abre o painel no PR.

### Escolher os repositórios

Em **Repositórios**, no topo do painel:

- **Colar:** nomes (`dono/repo`), endereços da página ou de clone, separados por vírgula, espaço ou linha. O que não for reconhecido aparece numa nota e continua no campo.
- **Escolher dos que tenho acesso:** lista os repositórios que a conta enxerga (até 300, os de push mais recente primeiro), com filtro e uma caixa para cada um.
- **Copiar a lista:** copia os nomes separados por vírgula, para colar em outra máquina.
- **Conta do gh:** vazio usa a conta ativa. Com mais de uma conta logada no `gh`, escreva o usuário que enxerga esses repositórios. A conta ativa do `gh` não muda.

No máximo 40 repositórios. A lista e a escolha dos avisos ficam nas preferências e vão junto na exportação.

## Como funciona

- **Login:** o do GitHub CLI. O processo principal roda `gh auth token` (ou `gh auth token --user <conta>`) e guarda o token só na memória. O token não vai para a interface, não é gravado em disco e é pedido de novo se o GitHub o recusar. Sem o `gh`, ou sem login, o painel diz o que fazer.
- **Consulta:** GraphQL, uma consulta por repositório, até 4 ao mesmo tempo, a cada minuto. Acima de 15 repositórios, as consultas se espaçam (4 s por repositório: 30 repositórios, a cada 2 minutos), porque o limite de uso da API por hora é o mesmo do `gh` da pessoa.
  - Um repositório que demora demais (o GitHub responde 504) recebe uma nova tentativa menor: 8 PRs em vez de 20, e 15 jobs por PR em vez de 30. Se falhar de novo, só ele mostra o erro.
  - Sem repositório na lista, o app não consulta nada e nem roda o `gh`.
- **Log do job:** só quando você clica em **Mandar ao agente corrigir**, e só de jobs do GitHub Actions do próprio repositório (verificações de outros serviços entram só com o link).
  - Vão os 3 primeiros jobs que falharam, com no máximo 120 linhas de cada e 20 mil caracteres no total.
  - O recorte termina no último `##[error]` e deixa de fora a limpeza do fim do job, as linhas só de pontos de progresso, as linhas repetidas, as cores e o horário de cada linha.
- **Avisos:** comparam uma consulta com a anterior. Na primeira consulta, e num repositório recém-adicionado, nada é novidade.

| Arquivo | O que faz |
|---|---|
| `src/shared/pulls.ts` | Tipos, leitura da lista colada, preferências |
| `src/core/forges/github.ts` | Token do `gh`, consulta GraphQL, leitura da resposta, log do job |
| `src/core/forges/PullWatcher.ts` | Consulta periódica, último estado, avisos, texto de `{pipeline}` |
| `src/main/app.ts`, `src/main/ipc.ts` | Avisos do sistema; canais `pulls:*`; sessões da branch do PR |
| `src/renderer/src/components/PullRequests.tsx` | O painel |

O resto do app só conhece `PullsState` e `PullRequestView`. O GitLab entra como outro `ForgeClient` (`glab auth token`, API REST de MRs e pipelines), sem mudar o painel.

## Medido

Rodado em 2026-10-31, no Windows 10, contra o GitHub de verdade, só lendo, com a conta HenriqueAurelio:

| Repositórios | PRs abertos lidos | Tempo da consulta |
|---|---|---|
| `HenriqueAurelio/agent-controller` e um inexistente | 0 (erro claro para o inexistente) | 0,6 s |
| `vercel/next.js`, `nodejs/node`, `microsoft/vscode`, `cli/cli`, `HenriqueAurelio/agent-controller` | 80 | 4,5 s |

- **Antes da divisão por repositório:** a consulta única com `next.js` e `node` voltava 504 depois de 11 s, e nenhum repositório aparecia.
- **Log real:** num job do `nodejs/node` que falhou (4 197 linhas), o recorte ficou com 6,5 mil caracteres e termina no teste que falhou e no `##[error]`.

## O que ficou de fora

- **GitLab e Bitbucket:** na fila, nessa ordem.
- **Comentar, aprovar e fazer merge pelo app:** o painel só lê. Escrever no GitHub em nome da pessoa pede outra decisão.
- **Texto dos comentários:** o aviso diz quem comentou, não o que escreveu. Ler os comentários seria mais uma consulta por PR.
- **GitHub Enterprise:** o endereço da API é fixo em `api.github.com`. Os testes já trocam o endereço; falta uma preferência para isso.
