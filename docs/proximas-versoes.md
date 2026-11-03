# Próximas versões: proposta

- **Estado:** aprovada em 2026-11-03. A execução segue a ordem v0.3 → v0.6, um PR por funcionalidade; o estado de cada item fica na tabela da versão.
- **Data:** 2026-11-03, depois da release v0.2.0.
- **Método:** a skill [`feature-exploration`](../.agents/skills/feature-exploration/SKILL.md). Cada ideia foi medida por uma pergunta: **ela evita que a pessoa saia do Aurelium para terminar o trabalho?**
- **Comparação:** o [Maestro](https://github.com/rafaelmaestro/maestro), o [CompozyOS](https://github.com/compozy/compozy) v0.4.0 e o mercado de orquestradores (Orca, Conductor, Superset, Agentastic, Nimbalyst, Paseo, cmux, Claude Squad), segundo o [comparativo da Agentastic](https://www.agentastic.dev/compare/ai-coding-agent-orchestration-tools) e a lista [awesome-agent-orchestrators](https://github.com/andyrewlee/awesome-agent-orchestrators).

## Onde o Aurelium está

Comparado com o mercado, o app já é forte em **orquestração**: estados por sessão, responder sem abrir, fila e encadeamento de prompts, melhor de N, revisor automático, quadro de tarefas, checkpoints por turno, worktree por sessão, verificações e problemas, contexto e tokens, PRs com pipeline e comandos em segundo plano. Pouca ferramenta junta tudo isso, e quase nenhuma roda em **Windows e Linux** ao mesmo tempo: Conductor, Superset, Agentastic e cmux são só para macOS.

O usuário ainda sai do app em cinco pontos:

| Ponto em que sai do app | Para onde vai | Quem já resolve |
|---|---|---|
| Revisar um PR ou MR | Navegador (o título do PR "abre no navegador") | Maestro (inbox, diff, comentários, aprovar, merge), Orca |
| Dizer ao agente o que mudar num trecho do diff | Digita no terminal, citando arquivo e linha à mão | Maestro, Orca, Alas (comentário no diff vira prompt) |
| Levar o trabalho da cópia isolada até um PR | Terminal ou IDE para push, PR e merge | Conductor, Orca, Superset |
| Ver a tela que o agente construiu | Navegador externo | Orca, Agentastic, cmux, Superagent (navegador embutido) |
| Acompanhar e responder longe do computador | Nada: fica esperando | Orca, Paseo, Happy, Conductor, Nimbalyst (celular) |

## Proposta de versões

Cada versão tem um tema e fecha um desses pontos. As **pendentes** já têm pasta em `docs/funcionalidades/`.

### v0.3: revisar e devolver sem sair do app

O núcleo do produto: o agente fez, a pessoa revisa e devolve ali mesmo.

| # | Funcionalidade | O que muda | Origem | Esforço |
|---|---|---|---|---|
| 1 | [Comentar no diff](funcionalidades/comentar-no-diff/README.md) (**feita**) | Comentários por linha no painel viram um prompt só, enviado pela fila | Maestro, Orca, Alas | M |
| 2 | [Multibuffer do turno](funcionalidades/multibuffer/README.md) (**feita**, sem edição na rolagem) | Todos os trechos do turno numa rolagem, com **aceitar ou desfazer por bloco** | Maestro, Volt | G |
| 3 | Revisar o PR dentro do app | O diff do PR ou MR no painel, com comentários por linha, respostas, resolver, aprovar e merge; o revisor automático deixa rascunhos que você edita antes de publicar | Maestro | G |
| 4 | Vigia do PR (**feita**, só o pipeline) | Pipeline vermelho ou comentário novo no PR da sessão vai sozinho para o agente, com limite de tentativas (o Maestro para em 3); reaproveita as regras de encadear | Maestro | M |
| 5 | [Sonar por grupo](planos/sonar-por-grupo-e-worktree.md) (seu rascunho) | O Sonar entra nas verificações, com o resultado separado por cópia | Pedido do usuário | M |

A ordem é 1, 2, 4, 3 e 5. O **1** é o de maior valor pelo menor esforço, e o **2** reaproveita os checkpoints. O **3** é o maior item e pede ADR, porque o app passa a escrever no serviço (comentar, aprovar, fazer merge), não só ler (ADR 0027).

### v0.4: do pedido ao PR

O caminho completo de uma tarefa sem abrir o terminal do sistema.

| # | Funcionalidade | O que muda | Origem | Esforço |
|---|---|---|---|---|
| 6 | Issue vira sessão | Uma issue do GitHub ou do GitLab vira um cartão do quadro, com a cópia, a branch e o prompt já montados | Orca, Maestro, Open Session ([futuras](funcionalidades/futuras/README.md)) | M |
| 7 | Da cópia ao PR | O botão "abrir PR" faz push e cria o PR da cópia; o botão "trazer para a base" faz o merge, com os conflitos no painel e "mandar o conflito ao agente" | Conductor, Orca, Aperant ([futuras](funcionalidades/futuras/README.md)) | M a G |
| 8 | [Retomar a conversa](planos/retomar-conversa.md) (pendente) | A sessão volta com a conversa do agente depois de fechar o app | Mercado em geral | M |
| 9 | Preparar a cópia | Copia os `.env*`, roda a preparação e mostra as portas de cada cópia, para duas cópias não brigarem pela 3000 | Maestro, cmux | P a M |
| 10 | Features empilhadas | Uma cópia parte da branch de outra, com aviso de rebase quando a de baixo muda | Maestro | M |

Pede revisar a [ADR 0018](../adr/0018-operacoes-de-git-no-painel.md): hoje o app não faz push nem merge.

### v0.5: ver o que o agente construiu

| # | Funcionalidade | O que muda | Origem | Esforço |
|---|---|---|---|---|
| 11 | Prévia no app | Um painel de navegador ligado às portas dos comandos em segundo plano. Você marca um ponto na tela, e o print com a marcação vai para o agente | Orca, Agentastic, cmux, Ignite | G |
| 12 | [Buscar no projeto](funcionalidades/buscar-no-projeto/README.md) (pendente) | `Ctrl+Shift+F` com ripgrep, e os resultados mandados ao agente | Leva 2 | M |
| 13 | Diagnósticos de linguagem (LSP) | Erros, hover e "ir para a definição" no editor, para TypeScript primeiro | Maestro | G |
| 14 | [Histórico do arquivo](funcionalidades/historico-do-arquivo/README.md) (pendente) | Blame e log, com o PR que trouxe a linha | Maestro | M |

O **11** é o que mais muda o fluxo. O **13** é o que mais pesa na memória: pede medição contra a [ADR 0009](../adr/0009-meta-de-consumo-de-recursos.md) antes de qualquer código.

### v0.6: supervisionar de longe

É a maior tendência do mercado: quase todo concorrente novo traz celular ou acesso remoto.

| # | Funcionalidade | O que muda | Origem | Esforço |
|---|---|---|---|---|
| 15 | [Core em processo próprio](v2/core-em-processo-proprio/README.md) (proposta, ADR 0026) | As sessões continuam vivas com a janela fechada. É a base do resto desta versão | CompozyOS, Maestro (herdr) | G |
| 16 | Aviso no celular | "Aguardando você" chega pelo ntfy ou pelo Telegram, com o endpoint da própria pessoa | [futuras](funcionalidades/futuras/README.md) | P |
| 17 | Painel pela rede | Uma página web servida pelo core: estado das sessões, responder permissões, mandar um prompt e ver o diff. Fica na rede local ou atrás de um túnel da própria pessoa | Paseo, Happy, Orca | G |
| 18 | Controle por CLI ou MCP | `aurelium new-session`, `aurelium send`; um agente pode abrir outra sessão e esperar por ela | CompozyOS, Superset, cmux | M |

O **16** é pequeno e pode entrar antes, em qualquer versão. O **17** pede uma ADR de segurança e privacidade.

### Em paralelo, sem versão própria

- **Mais agentes** (Gemini CLI, OpenCode): o mercado oferece de 40 a 55 agentes. A arquitetura de perfil e adaptador já prevê isso, e cada agente custa uma sondagem dos sinais.
- **Smokes com os agentes reais:** os de responder sem abrir, fila, encadear, melhor de N, revisor e quadro nunca rodaram. Rodam quando o usuário pedir, porque gastam créditos. O CI do GitHub não fica verde no plano gratuito; a garantia vem dos testes locais.

## O que não recomendo

Pela skill, ficam fora as ideias que levam a pessoa para fora do app ou que não ajudam a terminar o trabalho de desenvolvimento:

- **Notícias e caderno de notas** (Maestro): não fazem parte de terminar uma tarefa no repositório.
- **Ambientes na nuvem, microVMs e Docker por agente** (Conductor, Agentastic): custo e infraestrutura fora do escopo de um app local. A worktree já resolve o isolamento para o caso de uso atual.
- **Loja de extensões** (CompozyOS): continua depois do formatador e das verificações, como já decidido em [extensoes](funcionalidades/extensoes/README.md).
- **macOS:** fora das plataformas do projeto. Mudar isso pede uma decisão própria, não uma funcionalidade.

## Decisões tomadas

Em 2026-11-03:

1. A ordem é **v0.3 → v0.4 → v0.5 → v0.6**.
2. O app passa a **escrever** no GitHub e no GitLab (comentar, aprovar, push, merge), com uma ADR nova quando a primeira funcionalidade precisar.
3. Sem rodada de estabilização: o CI vermelho vem do limite do plano gratuito, não de defeito.
