# Seguir o agente

- **Estado:** proposta, leva 2.
- **ADR:** nova, "Hook de ferramenta para saber o que o agente editou". Amplia os hooks que o app passa por parâmetro ([ADR 0005](../../../adr/0005-deteccao-de-estado-em-tres-camadas.md)).

## O problema

Enquanto o agente trabalha, o terminal mostra "Editei `src/x.ts`" e um pedaço do diff, que passa rápido. Para acompanhar de verdade, a pessoa abre o painel e clica no arquivo depois que o agente já foi para o próximo. No Zed, o painel do agente tem **seguir**: o editor vai sozinho para o arquivo que o agente está mexendo.

## A ideia

Um botão **Seguir** no painel. Ligado, o editor abre sozinho cada arquivo que o agente altera, já no trecho alterado, com a mudança destacada por alguns segundos.

## Como fica para quem usa

- **👁 Seguir** no topo do painel (e na paleta). Ligado, o painel mostra "Seguindo “X”".
- A cada edição do agente, o editor troca para o arquivo e rola até o primeiro trecho mudado, em modo diff contra o turno anterior (com [checkpoints](../checkpoints-por-turno/README.md)) ou contra o último commit.
- **A pessoa manda:** se ela clicar em outro arquivo, rolar ou digitar, o seguir **pausa** e mostra **Voltar a seguir**. Ele nunca troca o arquivo de quem está editando: com algo não salvo, ele espera.
- Várias edições seguidas em um segundo mostram a última. A lista do painel marca as outras.
- Desligado, nada muda.

## Onde entra na arquitetura

- **Claude Code:** o hook `PostToolUse` das ferramentas `Edit`, `Write`, `MultiEdit` e `NotebookEdit` traz `tool_input.file_path`. Ele entra no `--settings` que o app já passa ([`commandLine.ts`](../../../src/core/agents/commandLine.ts)), apontando para o `agentctl` como os outros hooks. Não muda a configuração da pessoa.
- **Codex:** a confirmar na sondagem se algum hook informa o arquivo do `apply_patch`. Sem isso, a reserva vale para os dois agentes: o `RepoWatcher` já vê os arquivos que mudam na pasta, e o mais recente durante o turno é o que o agente editou.
- **Core:** o adaptador emite `edited(file)`, e o `SessionManager` repassa como `session:edited(sessionId, file)`. Fora de `src/core/agents`, ninguém sabe de onde veio.
- **Renderer:** a lógica de pausar e retomar fica no `ChangesPanel`. O editor ganha `revealRange` e um destaque temporário pelo `diffProtocol`.

## Riscos

| Risco | Como fica |
|---|---|
| Tirar o arquivo de quem está editando | Pausa com qualquer interação; nunca troca com algo não salvo |
| Pulos demais (o agente edita 30 arquivos) | Espera de um segundo entre trocas; a lista mostra os outros |
| Hook novo deixar o agente mais lento | O `agentctl` só repassa e sai, como os hooks de hoje; medido no smoke |
| A reserva por watcher pegar o arquivo errado (um build escrevendo) | Ignora o `.gitignore` e as pastas de saída; só durante "Trabalhando" |
