# Checkpoints por turno

- **Estado:** feita (leva 1).
- **ADR:** [0021](../../../adr/0021-refs-proprias-no-repositorio.md), "O app grava refs próprias no repositório do usuário". Revê a [ADR 0018](../../../adr/0018-operacoes-de-git-no-painel.md), que limitou o que o app escreve no git.
- **Como ficou, onde mudou do desenho:** a foto do início da sessão só vira ref junto com o primeiro turno que muda algo (uma sessão que não muda nada não deixa rastro); o mais novo de cada sessão nunca sai na poda; a base do painel é texto (`checkpoint:<id>` e `checkpoint:<de>..<até>`), não um objeto; fechar a sessão mantém os checkpoints por padrão; numa pasta com vários repositórios dentro não há linha do tempo.

## O problema

Um turno ruim do agente estraga o que o turno anterior tinha deixado certo. Sem commit entre os turnos, voltar atrás é desfazer à mão, arquivo por arquivo. O painel compara com o último commit ou com o início da sessão, mas não com "como estava antes deste turno". Por isso a pessoa não deixa o agente correr solto.

## A ideia

A cada fim de turno que mudou arquivos, o app tira uma **foto** da pasta e a guarda no próprio git, numa ref escondida (`refs/agent-controller/checkpoints/<sessão>/<n>`). Isso não cria commit na branch, não mexe no índice nem no working tree, e não aparece no `git log`. A sessão ganha uma **linha do tempo** de turnos.

## Como fica para quem usa

- **Comparar com** ganha a opção **O turno anterior**: o painel mostra só o que o último turno mudou. Na linha do tempo, dá para escolher qualquer par de turnos.
- **Linha do tempo** (no topo da sessão): uma lista com cada turno, a hora, quantos arquivos mudaram e o ✓/✗ das verificações daquele turno.
- **Voltar a este turno:** devolve os arquivos ao que eram naquele ponto. Antes disso, o app tira mais uma foto do estado atual, para que a volta também possa ser desfeita. Pede confirmação, e pede uma a mais se o agente estiver trabalhando.
- Voltar não mexe na conversa do agente: o app avisa que o agente não sabe que os arquivos voltaram, e oferece mandar a ele "voltei os arquivos ao turno N".
- **Quanto guardar:** 50 checkpoints por sessão, ou 7 dias (ajustável). Fechar a sessão pergunta se apaga os dela, como faz com a cópia isolada.
- Fora de um repositório git, a linha do tempo não aparece.

## Onde entra na arquitetura

- **Core:** `src/core/git/CheckpointService.ts`. A foto usa um **índice temporário** (`GIT_INDEX_FILE` apontando para um arquivo na pasta de dados do app): `git add -A` nesse índice (o que respeita o `.gitignore`), `git write-tree`, `git commit-tree` e `git update-ref`. O índice de verdade da pessoa não é tocado.
- **Voltar:** `git read-tree` no índice temporário e `git checkout-index -a -f`, mais a remoção dos arquivos que não existiam no checkpoint (só os que não estão no `.gitignore`).
- **Gatilho:** o mesmo fim de turno que dispara as verificações (`CheckService` já sabe se algo mudou, por `fingerprint.ts`).
- **IPC:** `checkpoints:list`, `checkpoints:restore`, `checkpoints:prune`. A comparação usa o `git:diff` de hoje com uma `DiffBase` nova, `{ kind: 'checkpoint', id }`, e o id é validado no main contra a lista da sessão.

## Os próprios agentes já têm algo parecido

O Claude Code tem `/rewind`, que volta a conversa e os arquivos que ele mesmo editou. Os checkpoints do app são outra coisa: valem para os dois agentes e para o que o agente fez pelo shell (um `sed`, um gerador de código), não só pelas ferramentas de edição. Não substituem o `/rewind`, e o README explica a diferença.

## Riscos

| Risco | Como fica |
|---|---|
| Repositório crescer com blobs de cada turno | Os objetos sem ref somem no `git gc`; com a poda, as refs saem. A aba Sessões mostra quanto ocupam |
| Arquivo grande ou binário em cada foto | O mesmo limite de tamanho do painel; acima dele, o arquivo fica fora da foto e o checkpoint avisa |
| Voltar apagar trabalho | Foto antes de voltar; confirmação dupla com o agente trabalhando |
| Tempo da foto num repositório grande | `git add -A` só no que o `git status` mostra mudado; medido num repositório de 50 mil arquivos |
| Corrida com o git do agente | Mesmo tratamento de "repositório ocupado" da ADR 0018 |
