# Multibuffer: revisar o turno numa rolagem só

- **Estado:** proposta, leva 2, a última dela.
- **ADR:** nova, "Editor de trechos de vários arquivos". Revê a [ADR 0012](../../../adr/0012-see-changes-permite-editar.md) (o painel permite editar).

## O problema

Um turno do agente muda doze arquivos, com três linhas em cada. Para revisar, a pessoa clica no primeiro, rola, lê, clica no segundo, e assim por diante. Perde o fio do que o agente fez e esquece o que já viu. No Zed, o **multibuffer** junta os trechos de vários arquivos numa só rolagem, editável.

## A ideia

Uma visão **Tudo**, no painel: todos os trechos alterados, de todos os arquivos, um depois do outro, com o nome do arquivo em cima de cada grupo e algumas linhas de contexto. Dá para ler de cima a baixo, editar ali mesmo e salvar.

## Como fica para quem usa

- No painel, **Tudo** (ao lado da lista) troca o editor de um arquivo pela rolagem de todos.
- Cada trecho mostra o antes e o depois em linha, com 3 linhas de contexto, que podem ser ampliadas (**↑ mais 10**).
- **Editar:** o lado novo de cada trecho é editável. `Ctrl+S` salva todos os arquivos tocados, com a mesma proteção de hoje: se o agente escreveu no arquivo enquanto a pessoa editava, o app não grava por cima e pergunta.
- **Desfazer um trecho:** a mesma seta de hoje, por trecho.
- **Marcar como visto:** cada arquivo tem um ✓ que o recolhe. A contagem "7 de 12 vistos" fica no topo e é zerada quando o arquivo muda de novo.
- Segue o "Comparar com" do painel: último commit, início da sessão, ou o turno anterior com [checkpoints](../checkpoints-por-turno/README.md).
- Com [comentar no diff](../comentar-no-diff/README.md), cada trecho aceita comentário, e a revisão inteira sai daqui.
- Acima de 200 trechos, a visão carrega por partes.

## Onde entra na arquitetura

- **Renderer, no iframe do diff:** um editor Monaco **por trecho**, virtualizados (só os visíveis existem). Juntar tudo num modelo só complicaria demais devolver cada edição ao arquivo certo, e um editor por trecho reaproveita o `DiffView` de hoje com um intervalo de linhas.
- **Edição:** cada trecho guarda o intervalo de linhas no arquivo. Ao salvar, o app aplica as edições do fim para o começo e grava pelo `git:save` de hoje, com a mesma conferência de "o arquivo mudou no disco".
- **Core:** `ChangesService.hunks(base)` devolve os trechos de todos os arquivos (`git diff -U3` com as posições), com o limite de tamanho do painel.
- **IPC:** `git:hunks(sessionId, base)`. Salvar e desfazer usam os canais que já existem.

## Riscos

| Risco | Como fica |
|---|---|
| Memória com muitos editores Monaco | Virtualização: no máximo 8 editores vivos; medido com 200 trechos |
| Trecho se deslocar quando outro trecho do mesmo arquivo cresce | As edições são aplicadas do fim para o começo, e as posições recalculadas depois de salvar |
| Complexidade da edição | Primeira entrega só leitura com "abrir no arquivo"; a edição vem num segundo PR |
