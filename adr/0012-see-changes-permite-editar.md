# 0012 — "See changes" permite editar o arquivo

- **Status:** Aceita
- **Data:** 2026-10-13
- **Emenda:** [ADR 0004](0004-diff-monaco-e-git-cli.md), na parte em que o painel era somente leitura. O restante da 0004 (Monaco para o diff, binário do git para os dados) continua valendo.
- **Revisão (2026-10-16):** a [ADR 0017](0017-sessoes-em-worktree.md) deixa o app criar e remover worktrees, e a branch de cada uma, para as sessões em cópia isolada. O painel continua sem nenhum comando que altere o repositório.
- **Revisão (2026-10-16):** a parte em que o painel não opera o git foi substituída pela [ADR 0018](0018-operacoes-de-git-no-painel.md): marcar para o commit, commit e descartar com cópia e Desfazer. O resto desta ADR continua valendo.

## Contexto

A ADR 0004 definiu o painel de mudanças como somente leitura: ele mostrava o antes e depois, e para mexer em algo o usuário voltava ao terminal ou a um editor. O motivo era o risco de uma ação que apaga trabalho.

Com o painel em uso, o dono do produto pediu que a pessoa possa **editar** ali mesmo: ao revisar o que o agente fez, o ajuste pequeno (um nome, uma linha a mais, um trecho que não deveria ter mudado) é mais rápido no próprio diff do que pedindo ao agente ou abrindo outro programa.

## Decisão

- O **lado direito** do diff, que é o arquivo como está na pasta, passa a ser editável. O lado esquerdo (o que o git tem: último commit ou início da sessão) continua somente leitura.
- **Salvar** grava o arquivo na pasta, com `Ctrl+S` ou o botão. Nada é salvo sozinho.
- A **seta entre os dois lados** desfaz um trecho, trazendo de volta o conteúdo do lado esquerdo. É uma edição como outra qualquer: só vale depois de salvar.
- O painel escreve **apenas no arquivo**, pelo sistema de arquivos. Ele continua sem executar nenhum comando do git que altere o repositório: índice, commits, stash e refs não são tocados. Não há "stage", "commit" nem "descartar todas as mudanças".
- Arquivos removidos, binários e grandes demais não são editáveis.

### O agente e o usuário no mesmo arquivo

O risco novo é os dois escreverem no mesmo arquivo. As regras:

- Edições não salvas **nunca são descartadas por uma atualização automática** do painel. Se o arquivo mudar no disco enquanto há edições, o editor mantém o que o usuário digitou.
- Ao salvar, o app confere se o arquivo no disco ainda é o que o editor carregou. Se não for, **nada é gravado** e o usuário escolhe: recarregar do disco (perde as edições dele) ou sobrescrever com a versão dele (perde o que o agente escreveu).
- Trocar de arquivo, trocar a base de comparação ou fechar o painel com edições não salvas pede confirmação. `Esc` dentro do editor não fecha o painel enquanto houver edições.

## Alternativas consideradas

- **Manter somente leitura (ADR 0004).** Mais simples e sem risco de conflito, mas obriga a sair do app para qualquer ajuste.
- **Botões de reverter e aceitar por trecho, sem edição livre.** Cobre o "desfazer", mas não o ajuste pequeno; e a seta de desfazer trecho do próprio editor já entrega essa parte.
- **Operações de git no painel (stage, commit, descartar).** É outro produto, e ações como descartar apagam trabalho sem volta. Continuam fora.
- **Salvar automaticamente.** Disputaria o arquivo com o agente a cada tecla.

## Consequências

- O painel deixa de ser inofensivo por construção: ele agora escreve em arquivos do usuário. A escrita é restrita ao repositório da sessão, recusa a pasta `.git` e exige confirmação quando há conflito.
- O contrato de IPC ganhou um comando (`git:save`), validado no processo principal.
- O item 2.2 de `DECISOES-E-RISCOS.md` e as limitações do README foram atualizados.

## Riscos e mitigação

| Risco | Mitigação |
|---|---|
| Sobrescrever o que o agente acabou de escrever | O salvamento compara com o conteúdo carregado e recusa em caso de diferença; sobrescrever é uma escolha explícita |
| Perder edições ao trocar de arquivo ou fechar o painel | Confirmação antes de sair; `Esc` não fecha com edições pendentes |
| Editar enquanto o agente trabalha e ele não perceber a mudança | Testado com os dois agentes reais (roteiro em `npm run test:smoke`): o agente lê o arquivo, o usuário salva uma edição pelo painel, o agente altera o mesmo arquivo em seguida. Claude Code 2.1.296 e Codex 0.158.0 preservaram a edição do usuário. O teste cobre o agente parado entre os dois passos; editar no meio de um turno em andamento não foi testado, e o README recomenda editar com o agente parado |
| Digitar no editor enquanto o arquivo seguinte ainda carrega, e o texto ir para o arquivo errado | O editor fica bloqueado durante a troca de arquivo |
| Fechar o painel, trocar de sessão ou fechar o app por um atalho, sem passar pelo aviso | Todos os caminhos perguntam antes: os atalhos globais, o botão da sessão, a troca de sessão e o fechamento da janela |
| Escrita fora do repositório ou em arquivos internos do git, por um caminho forjado | O processo principal resolve o caminho, exige que fique dentro do repositório e recusa `.git` |
| Mudar o fim de linha ou a codificação do arquivo ao salvar | O editor preserva o fim de linha do arquivo; a gravação é em UTF-8. Arquivos em outra codificação aparecem e seriam gravados como UTF-8 |
