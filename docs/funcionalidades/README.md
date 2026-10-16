# Funcionalidades propostas depois do v1

- **Estado:** propostas, aguardando priorização.
- **Data:** 2026-10-14.

O v1 resolve as dores originais: muitas janelas, falta de aviso e insegurança sobre o que o agente alterou ([ADR 0007](../../adr/0007-escopo-do-v1.md)). As propostas abaixo partem dali e seguem uma linha: **o app deixa de só mostrar o que o agente fez e passa a ajudar a revisar, corrigir e devolver o trabalho ao agente**, sem virar uma IDE.

Cada pasta tem:

- `README.md`: o problema, a ideia, como fica para quem usa, onde entra na arquitetura, a ADR que pede e os riscos.
- `tarefas.md`: a implementação dividida em tarefas, no formato de [`tasks/`](../../tasks/README.md) (frente, tamanho, dependências, o que fazer, pronto quando).

Pela ADR 0007, item novo de escopo exige uma ADR. Cada proposta diz qual.

## As propostas

| # | Funcionalidade | Em uma frase | Valor | Esforço | ADR nova |
|---|---|---|---|---|---|
| 1 | [Formatar ao salvar](formatar-ao-salvar/README.md) | Prettier, Biome ou ESLint do próprio projeto rodam ao salvar no painel | Alto | M (≈ 2 semanas) | Sim |
| 2 | [Extensões](extensoes/README.md) | Manifesto declarativo para formatadores, comandos e ações sem mexer no código do app | Alto, a longo prazo | G (≈ 4 semanas) | Sim |
| 3 | [Comentar no diff](comentar-no-diff/README.md) | Comentários por linha no painel viram um prompt para o agente | Muito alto | M | Sim |
| 4 | [Verificações ao fim do turno](verificacoes-pos-turno/README.md) | Testes, lint e typecheck rodam quando o agente termina, com ✓/✗ na sessão | Alto | M | Sim |
| 5 | [Worktree por sessão](worktree-por-sessao/README.md) | Cada sessão pode trabalhar numa cópia isolada do repositório | Alto | M | Sim |
| 6 | [Biblioteca de prompts](biblioteca-de-prompts/README.md) | Prompts guardados, com variáveis, enviados a uma ou várias sessões | Médio | P a M | Não |
| 7 | [Uso e custo](uso-e-custo/README.md) | Tokens, custo e contexto ocupado por sessão | Médio | M | Sim |
| 8 | [Terminal auxiliar](terminal-auxiliar/README.md) | Um shell na pasta da sessão, ao lado do agente | Médio | M | Sim |
| 9 | [Operações de git no painel](operacoes-git/README.md) | Stage, commit e descartar por arquivo, com confirmação | Médio | M | Sim (revê a 0012) |
| 11 | [Realce de sintaxe e temas](realce-de-sintaxe/README.md) | Gramáticas TextMate e temas do VS Code no painel: funções, parâmetros e propriedades com cor própria | Médio | M | Sim ([0015](../../adr/0015-realce-textmate-e-temas.md)) |

Já existe um plano detalhado para **retomar a conversa** de uma sessão: [`docs/planos/retomar-conversa.md`](../planos/retomar-conversa.md). Ele não foi repetido aqui e entra na ordem abaixo.

## Ordem escolhida

A proposta **11** (realce de sintaxe e temas) veio em 2026-10-16, a pedido, e foi feita fora da ordem abaixo: não depende de nenhuma outra.


Decisão de 2026-10-14: começar pelas propostas **4, 5, 6, 7 e 8**. As outras (1, 2, 3 e 9) ficam para depois e passam a reaproveitar o que estas criarem.

```
Primeiro    6 biblioteca-de-prompts ──► 4 verificacoes-pos-turno
Em paralelo 5 worktree-por-sessao      8 terminal-auxiliar
Por último  7 uso-e-custo (Claude Code; o Codex espera retomar-conversa)
Depois      1 formatar-ao-salvar ──► 3 comentar-no-diff ──► 2 extensoes;  9 operacoes-git
```

O porquê dessa ordem:

1. **Biblioteca de prompts** é a menor das cinco e cria uma peça que outras usam: o **envio de texto ao terminal do agente** (colagem em bloco, "enviar quando terminar"). Leva a ADR "O app escreve no terminal do agente a pedido do usuário".
2. **Verificações ao fim do turno** criam o **`ToolRunner`** (rodar um comando do projeto com prazo, sem processo residente, nos dois sistemas) e usam o envio do item anterior em "Mandar o erro ao agente".
3. **Worktree por sessão** e **terminal auxiliar** não dependem de nada e podem andar em paralelo com os dois primeiros, em outra frente.
4. **Uso e custo** começa por uma sondagem com os agentes reais, que depende da sua autorização. A parte do Claude Code anda sozinha; a do Codex precisa do id da conversa, que vem de [retomar a conversa](../planos/retomar-conversa.md) (PR 2 daquele plano).

Quando vierem as que ficaram para depois: o formatador reaproveita o `ToolRunner`, comentar no diff reaproveita o envio ao terminal, e as extensões continuam por último. O formato do manifesto nasce do formatador e das verificações, sem código especulativo, como pede a ADR 0007.

## O que vale para todas

- Arquitetura do `CLAUDE.md`: lógica nova no `src/core`, sem Electron; canal novo de IPC no tipo, na lista e no handler juntos; argumento do renderer validado no main.
- Texto novo é chave de `src/shared/i18n`, em pt-BR, en e es.
- Windows e Linux, com teste nos dois. Nada que rode um processo novo sem `killTree` e prazo.
- Memória: nenhuma proposta pode deixar processo residente sem medir com `npm run measure` contra a meta de 450 MB ([ADR 0009](../../adr/0009-meta-de-consumo-de-recursos.md)).
- Toda execução de código do projeto do usuário (binários de `node_modules`, scripts de teste) pede confiança por repositório na primeira vez. Um repositório clonado não pode rodar nada só por ser aberto.
