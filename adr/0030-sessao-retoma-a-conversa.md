# 0030 — A sessão retoma a conversa do agente

- **Status:** Aceita
- **Data:** 2026-11-03
- **Funcionalidade:** [`docs/planos/retomar-conversa.md`](../docs/planos/retomar-conversa.md) (`docs/proximas-versoes.md`, v0.4, item 8)
- **Emenda:** a [ADR 0006](0006-persistencia-json-sem-daemon.md) (o que é persistido) e o item 2.1 de [`DECISOES-E-RISCOS.md`](../DECISOES-E-RISCOS.md) (as sessões voltam paradas)

## Contexto

A sessão guardava nome, pasta, agente e comando. Reabrir o app, ou o agente sair, começava uma conversa nova, e o que foi combinado com o agente ficava para trás. Voltar exigia saber do `/resume` e achar a conversa certa numa lista. Os dois agentes sabem retomar uma conversa pelo id; faltava o app lembrar o id.

## Decisão

1. **A sessão guarda o id da conversa** (`conversationId`) no `sessions.json`. Só um id com cara de id (letras, números, `-`, `_` e `.`, até 100) é lido de volta: nada mais chega a uma linha de comando.
2. **Iniciar uma sessão com id retoma a conversa**; sem id, abre uma nova. Como abrir e retomar fica no perfil de cada agente (`conversation`), e nada fora de `src/core/agents` sabe qual é:
   - **Claude Code:** o app escolhe o id da conversa nova (`--session-id <uuid>`) e retoma com `--resume <id>`. O hook `SessionStart` confirma o id, ou traz outro, depois de um `/clear`.
   - **Codex:** não deixa escolher o id. O app o aprende do `SessionStart` (com os hooks confiados) ou do `thread-id` do `notify` de um turno de verdade, e retoma com `codex resume <id>`, antes dos `-c` que já passa.
3. **Uma retomada que falha é esquecida.** Se o agente aberto para retomar sai com erro em menos de 5 segundos, sem nenhum sinal de vida (título, hook), o app esquece o id e escreve "Não foi possível retomar a conversa. Enter inicia uma nova." É o caso de uma conversa apagada, ou de outra conta (um alias com outra pasta de configuração).
4. **Duplicar a sessão e trocar a pasta começam uma conversa nova.** Duas sessões na mesma conversa escreveriam uma por cima da outra, e os agentes guardam a conversa junto da pasta.
5. **"Nova conversa em …"**, na paleta, esquece o id e, com o agente rodando, o reinicia numa conversa nova.
6. **Continua sem daemon:** o agente é reaberto na conversa, não mantido vivo.

## Alternativas consideradas

- **Manter o agente vivo com a janela fechada.** É a [ADR 0026](0026-core-em-processo-proprio.md), ainda em proposta; retomar a conversa resolve o caso comum (reabrir o app) sem processo residente.
- **Mostrar a lista de conversas do agente para escolher.** É o que o `/resume` já faz dentro do agente; o app só precisa lembrar a da sessão.
- **Guardar o id nas preferências.** Ele é da sessão, e as sessões não vão na exportação.

## Consequências

- Reabrir o app e iniciar uma sessão parada volta à conversa, com o aviso "Retomando a conversa anterior." no terminal.
- No Codex sem hooks confiados, a conversa só tem id depois da primeira resposta do agente: fechar o app antes disso perde uma conversa ainda vazia.
- Um alias que não repassa os argumentos (`claude-work` sem `"$@"`) não retoma: o agente abre uma conversa nova, como antes.
- A sintaxe de retomar fica no perfil, com `lastTestedVersion`; uma versão nova que a mude é pega pelo smoke test (só com autorização).
