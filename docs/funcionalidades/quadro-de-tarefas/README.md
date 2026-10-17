# Quadro de tarefas

- **Estado:** concluída (leva 1). Smoke com agentes reais não rodado.
- **ADR:** [0025](../../../adr/0025-tarefas-como-origem-das-sessoes.md), "Tarefas como origem das sessões".

## O problema

A pessoa pensa em **tarefas** ("corrigir o login", "migrar o IPC"), mas o app só conhece **sessões**. A lista do que falta fazer fica fora dele, num caderno ou num arquivo, e cada vez que uma tarefa começa é preciso criar a sessão, a cópia e o prompt à mão. Também não há um lugar que diga o que já foi revisado e o que ainda falta revisar.

## A ideia

Um **quadro** leve, com colunas. Cada cartão é uma tarefa. **Iniciar** cria a cópia isolada, a sessão e o primeiro prompt a partir do cartão. Daí em diante, o cartão anda **sozinho** pelas colunas, conforme o estado da sessão.

| Coluna | O cartão está aqui quando |
|---|---|
| **A fazer** | Ainda não tem sessão |
| **Em andamento** | A sessão está trabalhando, ou tem itens na [fila](../fila-de-prompts/README.md) |
| **Precisa de você** | A sessão está aguardando você, ou as verificações falharam |
| **Revisar** | O turno terminou com as verificações passando |
| **Feito** | A pessoa marcou, ou a branch entrou na base |

## Como fica para quem usa

- **Quadro** (`Ctrl+Shift+B`, ou a paleta) ocupa a área do terminal, como o [painel geral](../painel-geral/README.md).
- **Novo cartão:** título, descrição (vira o primeiro prompt), pasta, agente e, se quiser, cópia isolada e grupo. Colar uma lista de linhas cria um cartão por linha.
- **Iniciar** (no cartão, ou várias de uma vez): cria a sessão em cópia isolada, com a branch `ac/<titulo>`, e manda a descrição.
- Abrir o cartão leva à sessão. O cartão mostra o mesmo resumo do cartão do painel geral.
- **Arrastar** só existe entre **A fazer** e **Feito**, e para reordenar dentro da coluna. As outras colunas seguem o estado e não podem ser forçadas.
- **Feito** pergunta o que fazer com a sessão e a cópia, com as mesmas opções de fechar uma sessão.
- Um quadro por pasta de repositório, escolhido no topo.

## Onde entra na arquitetura

- **Core:** `src/core/tasks/TaskBoard.ts` guarda os cartões por repositório em `tasks/<repo>.json`. A coluna **não é guardada**: é uma função pura do estado da sessão, das verificações e da fila (`columnOf(task, session)`), para não ficar fora de sincronia.
- **"Iniciar"** reaproveita o que o [melhor de N](../melhor-de-n/README.md) já faz (cópia + sessão + envio quando pronto), com N = 1.
- **"A branch entrou na base"** usa `git merge-base --is-ancestor`, conferido no fim do turno e ao abrir o quadro, não por vigia.
- **IPC:** `tasks:list`, `tasks:create`, `tasks:update`, `tasks:remove`, `tasks:start`, `tasks:done`, e o evento `tasks:changed`.

## Riscos

| Risco | Como fica |
|---|---|
| Virar um gerenciador de projeto | Sem prazo, responsável, etiqueta ou comentário: só título, descrição e a sessão |
| Iniciar dez cartões de uma vez | Limite de sessões iniciadas por clique (4), com o mesmo aviso de uso do melhor de N |
| Cartão perder a sessão (fechada à mão) | Volta para **A fazer** com a marca "sessão fechada", e a branch aparece no cartão |
