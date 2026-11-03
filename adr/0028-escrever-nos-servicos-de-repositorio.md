# 0028 — Escrever nos serviços de repositório, a pedido

- **Status:** Aceita
- **Data:** 2026-11-03
- **Funcionalidade:** revisar o PR dentro do app (`docs/proximas-versoes.md`, v0.3, item 3)
- **Revê:** o item 3 ("Só leitura") da [ADR 0027](0027-servicos-de-repositorio.md)

## Contexto

Com a [ADR 0027](0027-servicos-de-repositorio.md) o app passou a ler PRs, MRs e pipelines. Ler não basta para revisar: a pessoa achava o problema no app e voltava ao site para comentar, aprovar ou fazer merge. A skill `feature-exploration` aponta esse vai e vem como o que mais tira a pessoa do app, e o usuário decidiu, em 2026-11-03, que o app pode escrever nos serviços.

## Decisão

1. **O app escreve no GitHub e no GitLab só com um clique da pessoa**, e só estas ações:
   - publicar uma revisão: comentários nas linhas, um comentário geral, e o veredito (comentar, aprovar, pedir mudanças);
   - fazer o merge de um PR, com squash, e apagar a branch se a pessoa marcar.

   Nada é publicado sozinho: o vigia do PR manda o erro ao agente, nunca ao serviço.
2. **O login continua o do CLI**, como na 0027: o token do `gh` na memória do processo principal, e o `glab api` (agora também com `--method POST`/`PUT` e o corpo pela entrada padrão) no GitLab. Nenhum token vai para a interface nem para o disco.
3. **A revisão é escrita no app e publicada de uma vez.** Os comentários nas linhas ficam como rascunho na tela até "Comentar", "Aprovar" ou "Pedir mudanças". No GitHub isso é uma revisão só; no GitLab, uma discussão por linha, uma nota geral e, ao aprovar, a aprovação.
4. **Contra o commit que a pessoa viu.** A revisão leva o commit lido (`commit_id` no GitHub; no GitLab, o app confere o `sha` antes de comentar). Se o PR andou, o serviço recusa, e a tela mostra o motivo.
5. **O merge pergunta antes** e só fica disponível quando o serviço diz que o PR pode entrar. Conflito, rascunho, revisão pendente ou pipeline exigido aparecem como o motivo do bloqueio, com o botão desligado.
6. **O processo principal valida o que vem da interface**: o veredito é um dos três, as linhas são números positivos, os textos têm limite, e o PR tem que estar na última consulta.

## Alternativas consideradas

- **Continuar só leitura e abrir o site.** É o que a skill pede para evitar, e o que o Maestro já resolve dentro do app.
- **Publicar cada comentário na hora.** Gera uma notificação por linha para o autor do PR e não deixa a pessoa revisar o conjunto antes. O site também agrupa numa revisão.
- **Fazer o merge pelo git local.** O merge do serviço respeita as regras do repositório (proteção de branch, pipeline exigido, revisões), e o git local não.
- **"Pedir mudanças" no GitLab** pela API de revisores das versões novas. Não existe em todos os servidores; os comentários publicados dizem a mesma coisa.

## Consequências

- A conta da pessoa passa a escrever nos repositórios observados. Isso só acontece pelos botões da tela de revisão, com o texto à vista.
- O próprio autor não pode aprovar o próprio PR no GitHub: os botões aparecem desligados, com o motivo.
- Um comentário num arquivo renomeado do GitLab usa o caminho novo também como antigo; o servidor pode recusar a posição. O erro aparece na tela, e o resto da revisão não é perdido.
- Os testes usam o GitHub e o GitLab falsos (`tests/e2e/fake-github.ts`) e um transporte falso no core; nada é publicado num serviço de verdade.
