# Plano de elaboração e implementação do v1

Plano de trabalho do agent-controller: um app desktop que reúne sessões de Claude Code e Codex em uma janela só, avisa quando um agente termina ou precisa de você, e mostra o que ele alterou no código.

- Decisões de arquitetura: [`adr/`](adr/README.md)
- Decisões e riscos em linguagem direta: [`DECISOES-E-RISCOS.md`](DECISOES-E-RISCOS.md)
- Tarefas detalhadas, um arquivo por marco: [`tasks/`](tasks/README.md)
- Estado em 2026-10-13: v1 implementado. Das 38 tarefas, 35 estão prontas e 3 esperam uma ação fora do código: 0.4 (logar os agentes no WSL), 6.1 (criar a primeira tag) e 6.3 (a máquina Linux real). O passo a passo de cada uma está em [`docs/pendencias/`](docs/pendencias/README.md). A situação de cada uma está em [`tasks/`](tasks/README.md).

## 1. O que já está decidido

| Tema | Decisão | ADR |
|---|---|---|
| Shell do app | Electron, 100% TypeScript | 0010 |
| Terminal | xterm.js + node-pty | 0002 |
| Interface | React + TypeScript + Vite | 0003 |
| See changes | Monaco diff + binário git, somente leitura | 0004 |
| Detecção de estado | Sinais em camadas, tratados por perfil | 0005, 0011 |
| Agentes | Claude Code e Codex, escolhidos pelo usuário por sessão | 0011 |
| Persistência | JSON; os agentes param quando o app fecha | 0006 |
| Plataformas | Windows e Linux | 0007 |
| Memória | Teto de 450 MB com 10 sessões | 0009 |

## 2. O que os testes já provaram

Feitos em 2026-10-12 no Windows, com Codex CLI 0.158.0 e Claude Code 2.1.296. Detalhes na [ADR 0011](adr/0011-perfis-de-agente.md).

| Sinal | Claude Code | Codex |
|---|---|---|
| "Terminou" | Hook `Stop`, sem configuração do usuário | `notify` por parâmetro, com filtro para um aviso falso inicial |
| "Tem dúvida" | Hook `PermissionRequest`, no mesmo segundo | Título da janela (`Action Required`), ou hook depois de confiado |
| Título da janela | Só distingue trabalhando de parado | Distingue trabalhando, pedindo permissão e parado |
| Exige ação do usuário | Não | Só para os hooks (confiar uma vez) |

Também ficou provado que o node-pty cria um terminal onde os dois agentes rodam normalmente, e que o xterm headless reconstrói a tela deles.

**Ainda sem prova**, e por isso viram tarefas do M0: node-pty dentro do Electron empacotado, e os dois agentes no Linux.

## 3. Arquitetura

```
src/
  core/        Node puro, sem importar Electron. Testável em Docker.
    pty/         criação, escrita, resize e encerramento de terminais
    sessions/    modelo de sessão e máquina de estados
    agents/      perfis (dados) e adaptadores de sinal por agente
    signals/     parser do stream (título, BEL, OSC), servidor de hooks, silêncio
    git/         status, conteúdo de arquivos, snapshot
    store/       persistência em JSON
  main/        processo principal do Electron: janela, notificações, ligação do core ao IPC
  preload/     API estreita e tipada exposta ao renderer
  renderer/    React: barra lateral, terminal, painel de diff
  shared/      tipos e contrato de IPC usados pelos três lados
resources/
  agentctl/    script chamado pelos hooks dos agentes
tools/
  agent-probe/ scripts de sondagem usados nos testes de 2026-10-12
tests/
```

Três regras que sustentam o resto:

1. **`core/` não importa Electron.** É o que permite testar PTY, sinais e git em Docker e no CI sem interface.
2. **O renderer não acessa Node.** Tudo passa pelo contrato tipado do preload.
3. **Cada agente é um perfil mais um adaptador.** O perfil diz como abrir o agente; o adaptador traduz os sinais dele em estados da sessão. Nada no resto do app sabe qual agente está rodando.

### Estados de uma sessão

`parada` → `iniciando` → `trabalhando` ⇄ `aguardando você` → `terminou` / `erro`

Cada mudança de estado carrega a origem (hook, título, notify, silêncio). A interface mostra "confirmado" quando a origem é um sinal do próprio agente e "possivelmente" quando é o silêncio.

## 4. Marcos e tarefas

Tamanhos: **P** até 1 dia, **M** 2 a 3 dias, **G** cerca de 1 semana, para uma pessoa que conhece TypeScript.

### M0 — Fundação e provas

Objetivo: projeto de pé e as duas incertezas técnicas restantes resolvidas antes de construir em cima delas.

| # | Tarefa | Tam. | Depende de |
|---|---|---|---|
| 0.1 | Scaffold com electron-vite, React, TypeScript, ESLint, Prettier e Vitest | P | — |
| 0.2 | Contrato de IPC tipado em `shared/` e preload com `contextIsolation` e sandbox | P | 0.1 |
| 0.3 | Prova: node-pty dentro do Electron **empacotado**, abrindo um shell, no Windows e no Linux | M | 0.1 |
| 0.4 | Prova: repetir o roteiro de `tools/agent-probe/` com Claude Code e Codex no Linux | M | — |
| 0.5 | CI no GitHub Actions (Windows e Ubuntu) e Dockerfile para os testes do core | M | 0.1 |
| 0.6 | Linha de base de memória: app vazio e app com 1 terminal | P | 0.3 |

**Pronto quando:** o instalador gerado no CI abre um terminal nos dois sistemas; os sinais da seção 2 estão confirmados ou corrigidos para o Linux; existe um número de memória de partida.

**Se a 0.3 falhar:** é o risco 3.3 se materializando. Tentar binários pré-compilados alternativos antes de qualquer outra coisa.

### M1 — Terminal

Objetivo: um terminal que roda Claude Code e Codex sem diferença perceptível para um terminal comum.

| # | Tarefa | Tam. | Depende de |
|---|---|---|---|
| 1.1 | `PtyManager`: criar, escrever, redimensionar, com caminhos sempre na forma longa | M | 0.3 |
| 1.2 | Stream do PTY para o renderer com agrupamento e backpressure | M | 1.1, 0.2 |
| 1.3 | Componente de terminal: xterm.js com WebGL, ajuste de tamanho, copiar e colar, links | M | 1.2 |
| 1.4 | Encerramento: pedido gracioso, depois a árvore de processos (`taskkill /T` e process group) | M | 1.1 |
| 1.5 | Histórico no processo principal (xterm headless) e remontagem do terminal visual | M | 1.2 |

**Pronto quando:** Claude Code e Codex rodam uma tarefa completa nos dois sistemas, com redimensionamento; fechar a sessão não deixa processo órfão (teste automático); a tela volta idêntica depois de desmontar e remontar.

### M2 — Sessões e perfis

Objetivo: várias sessões nomeadas, cada uma com seu agente, que voltam na próxima abertura.

| # | Tarefa | Tam. | Depende de |
|---|---|---|---|
| 2.1 | Modelo `Session` e store em JSON com escrita atômica e versão de schema | P | 0.1 |
| 2.2 | Perfis Claude Code e Codex como dados: comando, parâmetros, variáveis de ambiente | M | 1.1 |
| 2.3 | Barra lateral: criar (nome, pasta, perfil), renomear, fechar, reordenar, atalhos | M | 1.3, 2.1 |
| 2.4 | Restaurar sessões como paradas; confirmação ao fechar o app com agente rodando | P | 2.3 |
| 2.5 | Detectar se o agente está instalado e em versão suportada | P | 2.2 |

**Pronto quando:** dá para criar 5 sessões misturando os dois agentes, alternar por atalho, fechar o app e reencontrar todas com nome, pasta e perfil.

### M3 — Estado e notificações

Objetivo: o app sabe, por sessão, se o agente está trabalhando, esperando ou se terminou, e avisa.

| # | Tarefa | Tam. | Depende de |
|---|---|---|---|
| 3.1 | Máquina de estados da sessão e agregador de sinais com origem e prioridade | M | 2.1 |
| 3.2 | Parser do stream: título (OSC 0/2), BEL e OSC 9 | M | 1.2 |
| 3.3 | Servidor local (named pipe / unix socket) e script `agentctl`, restrito ao usuário atual | M | 0.2 |
| 3.4 | Adaptador Claude Code: gerar o arquivo de `--settings`; mapear `Stop`, `PermissionRequest`, `Notification` | M | 3.1, 3.3 |
| 3.5 | Adaptador Codex: título como estado, `notify` com filtro do turno de título, hooks opcionais e detecção de confiança | M | 3.1, 3.2, 3.3 |
| 3.6 | Reserva: silêncio após atividade e saída do processo | P | 3.1 |
| 3.7 | Notificação nativa, badge na barra lateral, clique leva à sessão, sem avisar a sessão em foco | M | 3.1, 2.3 |
| 3.8 | Teste de fumaça por perfil com o agente real, a partir de `tools/agent-probe/` | M | 3.4, 3.5 |

**Pronto quando:** nos dois agentes e nos dois sistemas, um pedido de permissão vira "aguardando você" em até 2 segundos e o fim do turno vira "terminou"; o aviso falso do Codex não aparece; a notificação nativa leva à sessão certa.

**Depende da decisão 1.1** de `DECISOES-E-RISCOS.md` apenas na tarefa 3.5, e só na ordem de prioridade dos sinais: os três são implementados de qualquer forma.

### M4 — See changes

Objetivo: ver o que o agente alterou, em uma interface parecida com a do VS Code.

| # | Tarefa | Tam. | Depende de |
|---|---|---|---|
| 4.1 | `GitService`: `status --porcelain=v2`, conteúdo do HEAD e do working tree, não rastreados, binários | M | 0.1 |
| 4.2 | Painel com a lista de arquivos (adicionado, modificado, removido, renomeado) | M | 4.1, 0.2 |
| 4.3 | Monaco diff lado a lado e inline, carregado sob demanda e descartado ao fechar | M | 4.2 |
| 4.4 | Atualização automática por watcher com debounce | P | 4.1 |
| 4.5 | Botão, atalho e paleta de comandos; tela para pasta sem git ou git ausente | P | 4.2 |
| 4.6 | Diff "desde o início da sessão" por snapshot que não toca no índice nem no working tree | M | 4.1 |

**Pronto quando:** depois de um agente editar, criar e apagar arquivos, o painel lista os três casos e o diff bate com `git diff`; o painel se atualiza sozinho; pasta sem git mostra o aviso.

**Cortável:** 4.6.

### M5 — Consumo de recursos

Objetivo: ficar abaixo do teto de 450 MB e deixar visível quem está pesando.

| # | Tarefa | Tam. | Depende de |
|---|---|---|---|
| 5.1 | Desmontar o terminal visual das sessões não visíveis | P | 1.5 |
| 5.2 | Limite de scrollback e throttle de saída em segundo plano | P | 1.2 |
| 5.3 | CPU e RAM por sessão (árvore de processos) na barra lateral | M | 1.4 |
| 5.4 | Medição com 1, 5 e 10 sessões, nos dois sistemas, comparada ao teto | P | 5.1, 5.2 |

**Pronto quando:** 10 sessões abertas ficam abaixo de 450 MB nos dois sistemas, ou a ADR 0009 é corrigida com o número medido e a justificativa.

**Cortável:** 5.3.

### M6 — Empacotamento e lançamento

| # | Tarefa | Tam. | Depende de |
|---|---|---|---|
| 6.1 | electron-builder: NSIS no Windows, AppImage e .deb no Linux, com o node-pty reconstruído | M | 0.3 |
| 6.2 | Testes e2e de fumaça com Playwright nos dois sistemas | M | M2 |
| 6.3 | Validação manual no Linux real: notificações, instalação, os dois agentes | P | 6.1 |
| 6.4 | README: instalação, perfis, o passo de confiança do Codex | P | M3 |

**Pronto quando:** uma pessoa de fora instala pelo instalador nos dois sistemas e completa o roteiro: criar sessão, rodar agente, receber aviso, ver mudanças.

## 5. Ordem e paralelismo

```
M0 ──► M1 ──► M2 ──┬──► M3 ──┐
                   │         ├──► M5 ──► M6
                   └──► M4 ──┘
```

- **Caminho crítico:** M0 → M1 → M2 → M3.
- **Pode começar cedo, em paralelo:** 4.1 (`GitService`) e 3.3 (servidor de hooks) só dependem do M0; 2.1 (store) também.
- **M3 e M4 são independentes** entre si.
- **5.4 (medição)** deve ser repetida ao fim de cada marco, não só no M5.

## 6. Divisão de tarefas

O `core/` não depender do Electron é o que permite dividir o trabalho por área sem uma pessoa travar a outra.

| Frente | O que cobre | Tarefas |
|---|---|---|
| **A. Core e agentes** | PTY, sinais, adaptadores, servidor de hooks | 0.3, 0.4, 1.1, 1.4, 1.5, 2.2, 2.5, 3.1 a 3.6, 3.8 |
| **B. Interface** | Renderer, terminal visual, barra lateral, notificações | 0.2, 1.2, 1.3, 2.3, 2.4, 3.7, 4.2, 4.3, 4.5, 5.1 |
| **C. Git, infra e entrega** | See changes no core, CI, medição, empacotamento | 0.1, 0.5, 0.6, 2.1, 4.1, 4.4, 4.6, 5.2 a 5.4, 6.1 a 6.4 |

Como fica conforme o tamanho do time:

| Time | Organização | Prazo estimado |
|---|---|---|
| 1 pessoa | Segue a ordem dos marcos | 12 a 15 semanas |
| 2 pessoas | Uma em A, outra em B; a frente C é dividida, e no M4 quem estiver livre assume | 7 a 9 semanas |
| 3 pessoas | Uma por frente | 5 a 6 semanas |

São 38 tarefas: 14 pequenas e 24 médias, cerca de 62 a 74 dias de trabalho somados. Os prazos são estimativas, sem histórico de velocidade do time, e substituem as "6 a 8 semanas" do primeiro esboço, que tinha menos tarefas e não contava as provas do M0 nem os adaptadores por agente. O M0 e o M1 quase não se dividem: com 3 pessoas, duas ficam subutilizadas nas duas primeiras semanas, e vale adiantar 4.1, 3.3 e 2.1.

O contrato de IPC (0.2) é o ponto de encontro entre as frentes A e B: precisa ser combinado no primeiro dia e alterado só em conjunto.

## 7. Ordem de corte

Se o prazo apertar, nesta ordem:

1. 4.6, diff desde o início da sessão.
2. 5.3, CPU e RAM por sessão.
3. Hooks opcionais do Codex dentro da 3.5: o título e o `notify` já cobrem os dois estados.
4. Modo inline do diff na 4.3.

Não se corta: encerramento da árvore de processos (1.4), filtro do aviso falso do Codex (3.5) e a validação no Linux real (6.3).

## 8. Como cada tarefa é dada por pronta

- Código em TypeScript, com lint e testes passando no CI nos dois sistemas.
- Lógica do `core/` com teste automático; interface com pelo menos o teste de fumaça.
- Comportamento verificado no Windows e no Linux, não só em um.
- Se a tarefa contrariar uma ADR, a ADR é revista antes do merge.

## 9. Pendências antes de começar

| Pendência | Bloqueia | Onde |
|---|---|---|
| Qual sinal é o principal no Codex | Só a prioridade dentro da tarefa 3.5 | `DECISOES-E-RISCOS.md`, item 1.1 |
| Seu "concordo" nas cinco decisões da parte 2 | Nada tecnicamente; evita retrabalho | `DECISOES-E-RISCOS.md`, parte 2 |
| Tamanho do time | A escolha da linha na tabela da seção 6 | — |
| Codex e Claude Code instalados e logados no Linux | A tarefa 0.4 | — |

Nenhuma delas impede o início do M0.

### Pendências depois da implementação (2026-10-13)

O que falta depende de ações fora do código, e cada uma tem o passo a passo em [`docs/pendencias/`](docs/pendencias/README.md):

| Pendência | Fecha |
|---|---|
| Logar o Claude Code e o Codex no WSL e rodar os roteiros com os agentes reais | 0.4 |
| Validar notificações, instaladores e memória na máquina Linux real | 6.3 |
| Criar a primeira tag, para os instaladores saírem do CI | 6.1 |
| Confirmar a prioridade dos sinais do Codex (já funciona com a opção recomendada) | Item 1.1 de `DECISOES-E-RISCOS.md` |
