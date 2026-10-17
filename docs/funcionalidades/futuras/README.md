# Funcionalidades futuras

- **Estado:** ideias, fora das levas 1 e 2. Ainda sem pasta própria nem tarefas.
- **Data:** 2026-10-16.

Vieram da mesma rodada das levas 1 e 2 ([índice](../README.md)). Ficaram para depois porque dependem do que as levas criam, porque saem do app para serviços de fora, ou porque rendem menos pelo esforço. Quando uma entrar numa leva, ganha a pasta dela, com `README.md` e `tarefas.md`, e sai desta lista.

| Funcionalidade | O que faz | Por que ficou para depois | Esforço |
|---|---|---|---|
| **Integrar a cópia na base** | O botão "trazer para a base" faz o merge ou o rebase da branch da cópia isolada, com os conflitos no painel e "mandar o conflito ao agente" | Hoje o app não faz merge nem push ([ADR 0018](../../../adr/0018-operacoes-de-git-no-painel.md)). O [conflito entre sessões](../conflito-entre-sessoes/README.md) avisa antes, e isso cobre a maior parte da dor | M |
| **Prévia de Markdown e imagens** | Markdown renderizado, imagens e SVG no painel, além do código | Útil, mas não muda o fluxo; cabe a qualquer momento como tarefa pequena | P |
| **Buscar em todas as sessões** | `Ctrl+F` no terminal, mais uma busca em tudo o que os agentes escreveram em todas as sessões | O histórico de cada sessão é limitado ([`ScreenHistory`](../../../src/core/history/ScreenHistory.ts)); buscar o passado pede guardar mais, e isso custa memória ou disco | M |
| **GitHub: PR e CI na sessão** | Abrir o PR da branch da cópia, ver o CI no topo da sessão, e mandar ao agente o log do job que falhou ou os comentários do review | Sai do app para um serviço de fora (token, `gh`), e o app hoje não faz push | M–G |
| **Issue → sessão** | Escolher uma issue cria a cópia, a branch `ac/123-titulo` e a sessão, com a issue no prompt | Depende da integração com o GitHub e encaixa melhor no [quadro de tarefas](../quadro-de-tarefas/README.md) (uma issue vira um cartão) | M |
| **Contexto por arrastar** | Arrastar arquivos da árvore, ou colar uma imagem, insere a referência (`@arquivo`, o caminho da imagem) no prompt do agente | Cada agente tem a sua sintaxe de referência; pede sondagem, e o ganho é pequeno sobre digitar | P |
| **Configuração do agente por projeto** | Uma aba para ver e editar `CLAUDE.md` / `AGENTS.md`, servidores MCP, comandos e skills do projeto | O app não mexe na configuração dos agentes ([DECISOES-E-RISCOS 4.3](../../../DECISOES-E-RISCOS.md)); editar arquivos do projeto à vista da pessoa é diferente, mas precisa de ADR | M |
| **Aviso no celular** | "Aguardando você" chega pelo ntfy ou pelo Telegram, com o endpoint da própria pessoa | Manda dados para fora do computador; pede ADR de privacidade e configuração cuidadosa | P |
| **Mais agentes** | Perfis para Gemini CLI, OpenCode e Aider | A arquitetura de perfil + adaptador ([ADR 0011](../../../adr/0011-perfis-de-agente.md)) já foi pensada para isso; cada um pede uma sondagem dos sinais de estado | M cada |

Continuam pendentes também as propostas anteriores que não entraram em leva nenhuma: [formatar ao salvar](../formatar-ao-salvar/README.md), [extensões](../extensoes/README.md), [comentar no diff](../comentar-no-diff/README.md), [uso e custo](../uso-e-custo/README.md) e o plano de [retomar a conversa](../../planos/retomar-conversa.md).
