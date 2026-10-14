# Plano: voltar à conversa de uma sessão

- **Estado:** proposta, aguardando aprovação.
- **Data:** 2026-10-14.

## O problema

A sessão guarda nome, pasta, agente e comando ([ADR 0006](../../adr/0006-persistencia-json-sem-daemon.md)). A conversa com o agente não volta: ao reabrir o app, ou quando o agente sai, a sessão inicia uma conversa nova, e o que foi combinado com o agente fica para trás. Para voltar, a pessoa precisa saber que existe `/resume` e achar a conversa certa numa lista.

## A ideia

Cada sessão guarda o **id da conversa** do agente. Iniciar uma sessão que tem id **retoma** aquela conversa, em vez de abrir uma nova. Os dois agentes já sabem fazer isso; o app só precisa lembrar o id e passá-lo.

Conferido nas versões instaladas aqui (Claude Code 2.1.299 e Codex 0.158.0):

| | Claude Code | Codex |
|---|---|---|
| Escolher o id ao abrir | `claude --session-id <uuid>` | não tem |
| Saber o id depois de aberto | hook `SessionStart` (`session_id`), sempre ligado | `notify` (`thread-id`), sempre ligado; hook `SessionStart` (`session_id`), se os hooks forem confiados |
| Retomar | `claude --resume <id>` | `codex resume <id>` (aceita os mesmos `-c` que o app já passa) |

## Como fica para quem usa

- Abrir uma sessão parada **retoma a conversa** dela. O terminal mostra `[Retomando a conversa anterior.]` antes do agente.
- O mesmo vale para o Enter depois de o agente sair (`/exit`).
- Quem quiser começar do zero usa "Nova conversa em “X”" na paleta de comandos: o app esquece o id e inicia uma conversa nova.
- **Duplicar** uma sessão começa uma conversa nova: duas sessões na mesma conversa escreveriam uma por cima da outra.
- **Trocar a pasta** começa uma conversa nova, como hoje: os agentes guardam a conversa junto da pasta.
- Se a conversa não puder ser retomada (apagada, de outra conta, de outra máquina), o app avisa `[Não foi possível retomar a conversa. Enter inicia uma nova.]`, esquece o id e espera o Enter.

## O que muda no código

### 1. Dados (`src/shared/session.ts`, `src/core/store`)

- `Session` ganha `conversationId?: string`. Entra no `sessions.json`, validado na leitura (formato de UUID ou nome curto, sem quebra de linha); um valor inválido é descartado, nunca repassado ao shell.
- A exportação de configurações não muda: as sessões não vão no arquivo.

### 2. Perfil do agente (`src/core/agents/profiles.ts`), só dados

Cada perfil diz como abrir e retomar, sem que nada fora de `src/core/agents` saiba qual agente é:

```ts
conversation: {
  /** Args that open a new conversation with an id chosen by the app, when the agent allows it. */
  newWithId?: (id: string) => string[];      // Claude Code: ['--session-id', id]
  /** Args that resume a conversation. */
  resume: (id: string) => { before?: string[]; after: string[] };
  // Claude Code: { after: ['--resume', id] }
  // Codex:       { before: ['resume', id] }  (subcomando vem antes dos -c)
}
```

`buildLaunchCommand` recebe `conversationId` e `mode: 'new' | 'resume'` e monta os argumentos. Com um comando do usuário (alias), os argumentos vão depois dele, como já vão hoje ([ADR 0013](../../adr/0013-comando-do-usuario-no-lugar-do-agente.md)): `claude-work --resume <id>` funciona sempre que o alias repassa os argumentos.

### 3. Descobrir o id (adaptadores)

- O contexto do adaptador ganha `setConversation(id)`, ao lado do `setHooks` que já existe.
- **Claude Code:** o app gera um UUID (`crypto.randomUUID()`), abre com `--session-id` e grava o id antes de o agente começar. O hook `SessionStart` confirma; se ele trouxer outro id (o usuário rodou `/clear` ou `/resume` lá dentro), o app passa a guardar o novo.
- **Codex:** o id vem do `SessionStart` quando os hooks estão confiados e, sem eles, do `thread-id` do primeiro `notify` que não seja o turno interno de gerar título (o filtro `INTERNAL_PROMPT` já existe). Antes da primeira resposta do agente não há id: fechar o app nesse instante perde a conversa, que ainda está vazia.

### 4. Iniciar e retomar (`SessionManager`)

- `start` olha o `conversationId`: com id, retoma; sem id, abre uma nova (no Claude Code, já com o id escolhido).
- **Falha ao retomar:** se o agente aberto com `resume` sair com erro antes de um prazo curto (por exemplo, 5 s) e sem nenhum sinal de vida (hook ou título), o app esquece o id e escreve o aviso. É o caso de uma conversa apagada ou de um alias de outra conta (`claude-work` × `claude-personal` usam pastas de configuração diferentes).
- `changeFolder` e `duplicate` não levam o id adiante.
- Comando novo na paleta: "Nova conversa em “{name}”".

### 5. Interface e textos

- Chaves novas em `src/shared/i18n` (pt-BR, en, es): `notice.resuming`, `notice.resumeFailed`, `command.newConversation`.
- Nenhum botão novo.

## Decisão registrada

ADR 0014, "A sessão retoma a conversa do agente", que emenda a 0006 (o que é persistido) e o item 2.1 de `DECISOES-E-RISCOS.md` (as sessões voltam paradas, mas a conversa volta com elas). Continua sem daemon: o agente é reaberto, não mantido vivo.

## Testes

| Onde | O quê |
|---|---|
| `tests/core/commandLine.test.ts` | argumentos de nova e de retomada, para os dois agentes, com e sem comando do usuário, no Windows e no POSIX |
| `tests/core/*Adapter.test.ts` | id vindo do `SessionStart`, do `notify` e trocado por `/clear`; o turno de título não conta |
| `tests/core/sessionManager.test.ts` | id gravado e lido de volta; `start` retoma; falha rápida esquece o id; trocar pasta e duplicar começam do zero |
| `tests/core/appStore.test.ts` | `conversationId` inválido descartado na leitura |
| `tests/e2e` | com o agente falso dos testes (um script que imprime os próprios argumentos): reabrir o app mostra `--resume <id>`; "Nova conversa" mostra `--session-id` novo |
| `npm run test:smoke` | só com sua autorização: Claude Code e Codex reais, fechar e reabrir, e a conversa continua |

Tudo no Windows e no Linux (`npm run test:core:docker`, e2e no CI).

## Ordem de entrega

1. **PR 1, Claude Code:** dados, perfil, `--session-id` e `--resume`, falha ao retomar, ADR 0014, README.
2. **PR 2, Codex:** id pelo `notify` e pelo hook, `codex resume`.
3. **PR 3:** "Nova conversa" na paleta.

## Riscos

| Risco | Como fica |
|---|---|
| A sintaxe de retomar mudar numa versão nova do agente | Fica no perfil, com `lastTestedVersion`; o smoke test pega |
| Alias que não repassa argumentos | A retomada não acontece e o agente abre uma conversa nova; o README explica |
| Codex sem id antes da primeira resposta | Só perde a conversa ainda vazia |
| `thread-id` errado no Codex | Só o `notify` que passa pelo filtro de título conta; com hooks confiados, vale o `SessionStart` |
| Memória | Nada fica residente; nenhum efeito esperado, conferido com `npm run measure` |
