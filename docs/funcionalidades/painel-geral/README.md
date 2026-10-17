# Painel geral em mosaico

- **Estado:** proposta, leva 1.
- **ADR:** nenhuma nova, se ficar dentro da meta de memória ([ADR 0009](../../../adr/0009-meta-de-consumo-de-recursos.md)).

## O problema

A barra lateral mostra o estado de cada sessão numa linha. Com oito sessões, a pessoa sabe *quem* precisa dela, mas não *o quê*: para saber em que ponto cada agente está, precisa abrir uma por uma.

## A ideia

Uma visão de **torre de controle**: todas as sessões numa grade, cada cartão com o estado, as últimas linhas do terminal, a branch, o resultado das verificações e, quando existir, a fila e o custo. Um clique entra na sessão.

## Como fica para quem usa

- **Painel geral** (`Ctrl+Shift+O`, o botão no topo da barra lateral ou a paleta) ocupa a área do terminal.
- Cada cartão mostra:
  - o nome, o agente, a bolinha de estado e o tempo naquele estado ("aguardando há 4 min");
  - as **últimas 6 linhas** do terminal, em texto puro, sem cores;
  - a branch **⑂**, as verificações **✓/✗** e o contador de mudanças;
  - o pedido de permissão com **✓/✕**, quando houver ([responder sem abrir](../responder-sem-abrir/README.md));
  - a fila **⏵ n** ([fila de prompts](../fila-de-prompts/README.md)) e o custo ([uso e custo](../uso-e-custo/README.md)), quando existirem.
- Os cartões seguem os grupos da barra lateral, um bloco por grupo. Um filtro no topo mostra só as sessões aguardando, só as que estão trabalhando, ou todas.
- **Ordenar por atenção:** primeiro as que aguardam você, depois as verificações que falharam, depois o resto.
- Com o teclado: setas andam pelos cartões, `Enter` abre a sessão e `Esc` volta.

## Onde entra na arquitetura

- **Sem terminal novo.** Os cartões não montam xterm: mostram o texto do `ScreenHistory` (o que o `terminal:screenText` já devolve), cortado no main. Isso respeita o `TerminalPool`, que mantém no máximo três terminais montados.
- **Core:** `ScreenHistory.tail(lines)` devolve as últimas linhas sem os códigos de escape. Um evento `sessions:tails` agrupa as atualizações de todas as sessões, no máximo uma vez por segundo, e só enquanto o painel geral está aberto.
- **Renderer:** `components/Overview.tsx`, que reaproveita do `Sidebar` o estado, os grupos e as marcas.

## Riscos

| Risco | Como fica |
|---|---|
| Texto do terminal mudando o tempo todo pesar na interface | Um evento por segundo, só com o painel aberto, só das sessões que mudaram |
| Tela de TUI (menus, barras) virar lixo em texto puro | Tirar as linhas vazias e as de borda; se ficar ilegível, o cartão mostra só o estado |
| Memória com muitas sessões | Nenhum xterm a mais; medido com 12 sessões |
