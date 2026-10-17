# Funcionalidades propostas depois do v1

- **Estado:** primeira rodada (1 a 11) quase toda feita; segunda rodada (12 a 29) priorizada em duas levas, [abaixo](#segunda-rodada-de-painel-de-agentes-a-orquestrador-e-ide-leve).
- **Data:** 2026-10-14; segunda rodada em 2026-10-16.

O v1 resolve as dores originais: muitas janelas, falta de aviso e insegurança sobre o que o agente alterou ([ADR 0007](../../adr/0007-escopo-do-v1.md)). As propostas abaixo partem dali e seguem uma linha: **o app deixa de só mostrar o que o agente fez e passa a ajudar a revisar, corrigir e devolver o trabalho ao agente**, sem virar uma IDE.

Cada pasta tem:

- `README.md`: o problema, a ideia, como fica para quem usa, onde entra na arquitetura, a ADR que pede e os riscos.
- `tarefas.md`: a implementação dividida em tarefas, no formato de [`tasks/`](../../tasks/README.md) (frente, tamanho, dependências, o que fazer, pronto quando).

Pela ADR 0007, item novo de escopo exige uma ADR. Cada proposta diz qual.

## As propostas

Feitas: 4, 5, 6, 8, 9, 10 e 11. Pendentes: 1, 2, 3 e 7.

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
| 10 | [Grupos de sessões](grupos-de-sessoes/README.md) | Sessões agrupadas por repositório na barra lateral, com nome, recolher e arrastar | Médio | P | Não |
| 11 | [Realce de sintaxe e temas](realce-de-sintaxe/README.md) | Gramáticas TextMate e temas do VS Code no painel: funções, parâmetros e propriedades com cor própria | Médio | M | Sim ([0019](../../adr/0019-realce-textmate-e-temas.md)) |

Já existe um plano detalhado para **retomar a conversa** de uma sessão: [`docs/planos/retomar-conversa.md`](../planos/retomar-conversa.md). Ele não foi repetido aqui e entra na ordem abaixo.

## Ordem escolhida

A proposta **11** (realce de sintaxe e temas) veio em 2026-10-16, a pedido, e foi feita fora da ordem abaixo: não depende de nenhuma outra.


Decisão de 2026-10-14: começar pelas propostas **4, 5, 6, 7 e 8**. As outras (1, 2, 3 e 9) ficam para depois e passam a reaproveitar o que estas criarem.

A proposta **10** (grupos de sessões) veio depois, em 2026-10-15, a pedido, e foi feita fora dessa ordem: não depende de nenhuma outra nem é dependência de alguma.

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

## Segunda rodada: de painel de agentes a orquestrador e IDE leve

- **Data:** 2026-10-16.

Com as propostas 4, 5, 6, 8, 9, 10 e 11 prontas, a linha muda: o app passa a **coordenar** vários agentes (orquestrador) e a cobrir o que a pessoa ainda faz fora dele para revisar o trabalho (IDE leve, no espírito do VS Code e do Zed). O que ficou de fora das duas levas está em [`futuras/`](futuras/README.md).

### Leva 1: orquestração de agentes

Feitas: 12 ([ADR 0020](../../adr/0020-responder-permissao-fora-do-terminal.md)) e 13 (revisão da [ADR 0015](../../adr/0015-app-escreve-no-terminal-a-pedido.md)).

| # | Funcionalidade | Em uma frase | Valor | Esforço | ADR nova |
|---|---|---|---|---|---|
| 12 | [Responder sem abrir a sessão](responder-sem-abrir/README.md) | Permitir ou negar o pedido do agente pela barra lateral ou pela notificação | Muito alto | M | Sim ([0020](../../adr/0020-responder-permissao-fora-do-terminal.md)) |
| 13 | [Fila de prompts](fila-de-prompts/README.md) | Vários prompts por sessão, mandados um a cada fim de turno | Alto | P a M | Não |
| 14 | [Checkpoints por turno](checkpoints-por-turno/README.md) | Uma foto da pasta a cada turno, em ref escondida do git: comparar e voltar | Muito alto | M | Sim (revê a 0018) |
| 15 | [Conflito entre sessões](conflito-entre-sessoes/README.md) | Aviso quando duas sessões do mesmo repositório mexem no mesmo arquivo | Médio | P a M | Não |
| 16 | [Painel geral](painel-geral/README.md) | Todas as sessões numa grade, com estado e as últimas linhas | Alto | M | Não |
| 17 | [Melhor de N](melhor-de-n/README.md) | O mesmo pedido em N cópias e agentes, comparados lado a lado | Alto | M | Sim |
| 18 | [Revisor automático](revisor-automatico/README.md) | Uma segunda sessão revisa cada turno e devolve as observações | Alto | M | Sim |
| 19 | [Encadear sessões](encadear-sessoes/README.md) | Regras "quando A terminar, mandar isto para B", com limite de voltas | Alto | M a G | Sim |
| 20 | [Quadro de tarefas](quadro-de-tarefas/README.md) | Cartões que viram sessões e andam sozinhos pelas colunas | Alto, a longo prazo | G | Sim |

```
Primeiro    12 responder-sem-abrir      13 fila-de-prompts       (em paralelo, sem dependência)
Depois      14 checkpoints-por-turno    15 conflito-entre-sessoes 16 painel-geral
Em seguida  17 melhor-de-n
            14 + 13 ──► 18 revisor-automatico ──► 19 encadear-sessoes
Por último  17 + 16 ──► 20 quadro-de-tarefas
```

O porquê dessa ordem:

1. **Responder sem abrir** ataca a dor original, o vai e vem entre sessões, e não depende de nada. **Fila de prompts** é pequena e é a base de toda passagem automática de trabalho.
2. **Checkpoints** dão o "diff do turno", que o revisor e o encadeamento precisam, e a segurança para deixar o agente correr solto. **Conflito** e **painel geral** são independentes e baratos.
3. **Melhor de N** só junta peças que já existem (cópia isolada, grupos, envio a várias sessões, verificações).
4. **Revisor** cria a passagem de trabalho por arquivo; **encadear** a generaliza, entregando pela fila.
5. **Quadro** reaproveita o "iniciar" do melhor de N e os cartões do painel geral.

### Leva 2: o que falta de IDE

| # | Funcionalidade | Em uma frase | Valor | Esforço | ADR nova |
|---|---|---|---|---|---|
| 21 | [Links no terminal](links-no-terminal/README.md) | `Ctrl+clique` em `arquivo:linha` abre o editor na linha | Alto | P a M | Não |
| 22 | [Abrir arquivo rápido](abrir-arquivo-rapido/README.md) | `Ctrl+P` com busca aproximada pelo nome | Alto | P | Não |
| 23 | [Abrir no editor externo](abrir-no-editor-externo/README.md) | O arquivo na linha, ou a pasta, no VS Code, Cursor ou Zed | Médio | P | Não |
| 24 | [Painel de problemas](painel-de-problemas/README.md) | Os erros das verificações numa lista clicável, mandados ao agente um a um | Alto | M | Não |
| 25 | [Buscar no projeto](buscar-no-projeto/README.md) | `Ctrl+Shift+F` com ripgrep, e os resultados ao agente | Alto | M | Sim |
| 26 | [Seguir o agente](seguir-o-agente/README.md) | O editor acompanha, ao vivo, o arquivo que o agente edita | Médio | M | Sim |
| 27 | [Histórico do arquivo](historico-do-arquivo/README.md) | Log e autoria (blame) do arquivo, e comparar com um commit | Médio | M | Não |
| 28 | [Dividir a tela](dividir-a-tela/README.md) | Duas a quatro sessões à vista ao mesmo tempo | Médio | M | Sim |
| 29 | [Multibuffer](multibuffer/README.md) | Todos os trechos do turno numa rolagem só, editável | Alto | G | Sim (revê a 0012) |

```
Primeiro    21 links-no-terminal   22 abrir-arquivo-rapido   23 abrir-no-editor-externo
Depois      21 ──► 24 painel-de-problemas      25 buscar-no-projeto
Em seguida  26 seguir-o-agente     27 historico-do-arquivo   28 dividir-a-tela
Por último  29 multibuffer (fica melhor com 14 checkpoints e 3 comentar-no-diff)
```

As três primeiras são pequenas e já dão a sensação de IDE. Os **links** criam o leitor de `arquivo:linha` que o painel de problemas reaproveita. A busca pede uma decisão de empacotamento (o binário do ripgrep). **Dividir a tela** e **multibuffer** são as que mais pesam na memória e ficam para quando houver medição a partir das outras.

As duas levas podem andar em paralelo, em frentes diferentes: a leva 1 é quase toda core e sessões; a leva 2, quase toda painel e editor.

## O que vale para todas

- Arquitetura do `CLAUDE.md`: lógica nova no `src/core`, sem Electron; canal novo de IPC no tipo, na lista e no handler juntos; argumento do renderer validado no main.
- Texto novo é chave de `src/shared/i18n`, em pt-BR, en e es.
- Windows e Linux, com teste nos dois. Nada que rode um processo novo sem `killTree` e prazo.
- Memória: nenhuma proposta pode deixar processo residente sem medir com `npm run measure` contra a meta de 450 MB ([ADR 0009](../../adr/0009-meta-de-consumo-de-recursos.md)).
- Toda execução de código do projeto do usuário (binários de `node_modules`, scripts de teste) pede confiança por repositório na primeira vez. Um repositório clonado não pode rodar nada só por ser aberto.
