# 0021 — O app grava refs próprias no repositório do usuário

- **Status:** Aceita
- **Data:** 2026-10-17
- **Revê:** a [ADR 0018](0018-operacoes-de-git-no-painel.md), que fechou a lista do que o app escreve no git (stage, commit e descarte, no painel). Esta ADR acrescenta uma escrita fora do painel e fora daquela lista: objetos e refs em `refs/agent-controller/`. O resto da 0018 continua valendo.

## Contexto

Um turno ruim do agente estraga o que o turno anterior tinha deixado certo. Sem commit entre os turnos, voltar atrás é desfazer à mão, arquivo por arquivo, e o painel só compara com o último commit ou com o início da sessão. É a proposta 14 de [`docs/funcionalidades`](../docs/funcionalidades/checkpoints-por-turno/README.md).

A 0018 diz que nova operação de git pede nova ADR. Guardar uma foto da pasta a cada turno é uma operação nova, e de outro tipo: o app escreve no repositório sem que a pessoa clique em nada.

## Decisão

No fim de cada turno que mudou arquivos, o app tira uma **foto** da pasta e a guarda no próprio repositório, numa ref só dele:

```
refs/agent-controller/checkpoints/<id da sessão>/<n>
```

- **A foto passa por um índice do app** (`GIT_INDEX_FILE` num arquivo da pasta de dados do app). Ele começa como cópia do índice da pessoa, para o git só reler o que mudou, e então: `git add --all` (que segue o `.gitignore`), `git write-tree`, `git commit-tree` (sem pai, com autor "Agent Controller") e `git update-ref`. O índice, o `HEAD`, a branch, o stash e o `git log` da pessoa não mudam: o que o app acrescenta são objetos e essas refs.
- **Nada é gravado sem mudança.** Uma foto igual à anterior não vira checkpoint. A foto do início da sessão fica só na memória até o primeiro turno que mudar algo: uma sessão que não muda nada não deixa ref.
- **Arquivo grande fica de fora.** Acima do limite do painel (2 MB), o arquivo não entra na foto, o checkpoint diz qual ficou de fora e voltar não mexe nele.
- **Voltar a um checkpoint** tira antes mais uma foto do estado atual (o "antes de voltar", que é o desfazer), e então escreve só o que difere: `git read-tree` num índice temporário do app e `git checkout-index -f` dos arquivos que mudaram; os que não existiam no checkpoint são apagados, nunca os que o `.gitignore` cobre. O índice da pessoa continua o mesmo. Pede confirmação, e mais uma com o agente trabalhando; com o `index.lock` presente, recusa com "repositório ocupado", como a 0018.
- **A conversa do agente não volta.** O app avisa e oferece escrever no terminal do agente (pelo mesmo caminho da [ADR 0015](0015-app-escreve-no-terminal-a-pedido.md)) que os arquivos voltaram. Não substitui o `/rewind` do Claude Code, que volta conversa e arquivos editados por ele; o checkpoint vale para os dois agentes e para o que mudou pelo shell.
- **Quanto guardar:** 50 checkpoints por sessão e 7 dias, ajustáveis em Preferências → Sessões. O mais novo de cada sessão fica sempre. Os de sessões que não existem mais saem pela idade, na próxima foto naquele repositório. Fechar a sessão pergunta se apaga os dela (por padrão, ficam). Sem pai entre os commits, a ref que sai leva seus objetos no próximo `git gc`.
- **Só no repositório da sessão.** Fora de um repositório git (ou numa pasta comum com vários repositórios dentro), não há checkpoints nem linha do tempo.
- **Comparar:** o painel ganha a base "O turno anterior" e as bases `checkpoint:<id>` e `checkpoint:<de>..<até>`; os ids vêm do renderer e o main só aceita os da lista daquela sessão. Entre dois checkpoints o painel é só leitura.
- O código fica em `src/core/git/CheckpointService.ts`; o gatilho é o mesmo fim de turno das verificações, e uma verificação espera a foto do turno antes de rodar.

## Alternativas consideradas

- **Commit numa branch escondida, ou `git stash create`.** O stash mexe na lista de stashes e não guarda arquivo não rastreado sem `-u`, que então limpa a pasta; uma branch aparece em todo cliente de git e no `git log --all` de quem não espera por ela.
- **Cópia dos arquivos na pasta de dados do app.** Não toca no repositório, mas duplica tudo a cada turno, sem a deduplicação dos objetos do git, e o diff teria que ser feito à parte.
- **Encadear os checkpoints (cada um com o anterior como pai).** Daria um `git log` da linha do tempo, mas podar os antigos não liberaria nada enquanto o mais novo os alcançasse.
- **`git checkout-index -a` para voltar.** Reescreveria todos os arquivos da pasta (e a data de cada um); escrever só o que difere não acorda o watcher do agente sem motivo.

## Consequências

- O app passa a escrever no repositório sem um clique: objetos soltos e refs em `refs/agent-controller/`. Quem lista todas as refs (`git for-each-ref`, `git log --all`) as vê; o README diz isso e como apagá-las (`git for-each-ref --format='delete %(refname)' refs/agent-controller | git update-ref --stdin`).
- O contrato de IPC ganhou `checkpoints:list`, `checkpoints:restore`, `checkpoints:prune`, `checkpoints:usage` e o evento `checkpoints:changed`; `sessions:remove` ganhou a opção `checkpoints`; `DiffBase` ganhou `previousTurn` e `checkpoint:…`. As preferências ganharam `checkpoints` (ligado, quantos, quantos dias).
- Os checkpoints são compartilhados entre os worktrees do mesmo repositório (refs fora de `refs/worktree/` são de todos), separados pelo id da sessão.

## Riscos e mitigação

| Risco | Mitigação |
|---|---|
| O repositório crescer com os blobs de cada turno | Só o que mudou vira objeto novo; poda por quantidade e idade; Preferências → Sessões mostra quanto os checkpoints ocupam |
| Arquivo grande ou binário em cada foto | Acima de 2 MB fica de fora, com aviso no checkpoint |
| Voltar apagar trabalho | Foto antes de voltar, com **Desfazer**; confirmação, e outra com o agente trabalhando; o que o `.gitignore` cobre nunca é apagado |
| Foto lenta num repositório grande | Índice do app copiado do da pessoa: o git só relê o que mudou |
| Corrida com o git do agente | A foto do fim do turno espera até 2 s o `index.lock` sair; voltar recusa com "repositório ocupado"; o lock nunca é apagado |
| Ferramenta de terceiros estranhar as refs | Ficam num namespace próprio, fora de `refs/heads` e `refs/tags`, e somem com a poda ou ao fechar a sessão |
