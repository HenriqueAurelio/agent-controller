# Agent Controller

Um app desktop que reúne sessões de **Claude Code** e **Codex** em uma janela só, avisa quando um agente termina ou precisa de você, e mostra o que ele alterou no código.

- Windows e Linux.
- Cada sessão é um terminal de verdade: o agente roda nele como rodaria no seu terminal.
- O app não altera a configuração de nenhum agente: os avisos são ligados por parâmetro, na hora de abrir.

## Pré-requisitos

| O quê | Para quê | Como conferir |
|---|---|---|
| [Claude Code](https://docs.claude.com/claude-code) e/ou [Codex CLI](https://developers.openai.com/codex/cli) | São os agentes que o app abre. Precisam estar instalados, no `PATH` e logados | `claude --version`, `codex --version` |
| [git](https://git-scm.com) 2.15 ou mais novo | Só para o painel "See changes" | `git --version` |

Versões de agente testadas: **Claude Code 2.1.296** e **Codex CLI 0.158.0**, as duas no Windows 10. Com uma versão mais nova o app funciona e avisa que ela ainda não foi testada; com uma mais antiga que a mínima (Claude Code 2.1.0, Codex 0.158.0), avisa que os avisos podem falhar.

## Instalação

Os instaladores saem do CI a cada tag e ficam na página de releases do repositório.

**Windows.** Rode `agent-controller-<versão>-setup.exe`. O instalador não é assinado: o Windows mostra o aviso "O Windows protegeu o computador". Clique em **Mais informações** e depois em **Executar assim mesmo**.

**Linux.** Escolha um dos dois:

```bash
# .deb (Debian, Ubuntu)
sudo apt install ./agent-controller-<versão>.deb

# AppImage (qualquer distribuição)
chmod +x agent-controller-<versão>.AppImage
./agent-controller-<versão>.AppImage
```

Não há atualização automática no v1: para atualizar, instale a versão nova por cima.

## Como usar

### Criar uma sessão

1. Clique em **+ Nova sessão** (ou `Ctrl+Shift+N`).
2. Escolha a **pasta** onde o agente vai trabalhar e dê um **nome** à sessão.
3. Escolha o **agente**: Claude Code ou Codex. Um agente que não está instalado aparece desabilitado, com a instrução de instalação.
4. **Criar e iniciar** abre o agente no terminal da sessão.

Daí em diante é o agente de sempre: digite o prompt no terminal.

### O que cada estado significa

A bolinha ao lado do nome da sessão mostra o estado:

| Estado | Significa |
|---|---|
| **Parada** | O agente não está rodando. Sessões restauradas voltam assim; clique em **Iniciar** |
| **Iniciando** | O agente foi aberto e ainda não mostrou o prompt |
| **Trabalhando** | O agente está no meio de um turno |
| **Aguardando você** | O agente está parado esperando: pediu uma permissão, fez uma pergunta ou está no prompt |
| **Terminou** | O turno acabou |
| **Erro** | O agente saiu com erro, ou não pôde ser aberto. O motivo aparece no terminal |

Bolinha **cheia** quer dizer que o próprio agente informou o estado. Bolinha **vazada e tracejada**, com o texto "**Possivelmente** aguardando você", quer dizer que o app só está supondo: o agente ficou alguns segundos sem escrever nada, e isso tanto pode ser uma pergunta quanto um build demorado e silencioso. O tempo dessa suposição é ajustável nas preferências, e 0 a desliga.

### Avisos

Quando um agente que estava trabalhando termina ou passa a aguardar você, o app mostra uma notificação do sistema com o nome da sessão. Clicar nela traz a janela para a frente e abre a sessão. A sessão que você está olhando não gera notificação; as outras ganham também um ponto azul na barra lateral.

Em **Preferências** (`Ctrl+,`) dá para desligar cada tipo de aviso e o som.

### Ver o que o agente alterou

**See changes** (botão no topo da sessão, `Ctrl+Shift+G`, ou "see changes" na paleta de comandos) abre o painel de mudanças:

- A lista dos arquivos adicionados, modificados, removidos, renomeados e não rastreados, agrupados por pasta.
- O antes e depois do arquivo selecionado, lado a lado ou em linha.
- **Comparar com**: o último commit, ou o início da sessão (só o que mudou desde que o agente foi aberto).
- A lista se atualiza sozinha enquanto o painel está aberto.

### Atalhos

| Atalho | Ação |
|---|---|
| `Ctrl+Shift+N` | Nova sessão |
| `Ctrl+Tab` / `Ctrl+Shift+Tab` | Próxima sessão / sessão anterior |
| `Ctrl+1` … `Ctrl+9` | Ir para a sessão N |
| `Ctrl+Shift+G` | Abrir ou fechar o painel de mudanças |
| `Ctrl+Shift+P` | Paleta de comandos |
| `Ctrl+,` | Preferências |
| `Ctrl+Shift+C` / `Ctrl+Shift+V` | Copiar / colar no terminal. No Windows, `Ctrl+C` com texto selecionado e `Ctrl+V` também |

Na barra lateral, com uma sessão focada: `F2` renomeia, `Delete` fecha, `Alt+↑` / `Alt+↓` reordena. Também dá para arrastar.

## Codex: o passo de confiança dos hooks

O app avisa do Codex por três caminhos: o título da janela do Codex (trabalhando, pedindo permissão, parado), o aviso de fim de turno e, opcionalmente, **hooks**.

O Codex só executa hooks que você marcou como confiáveis. Por isso, na primeira sessão do Codex aberta pelo app, ele mostra esta tela:

```
Hooks need review
  2 hooks are new or changed.

› 1. Review hooks
  2. Trust all and continue
  3. Continue without trusting (hooks won't run)
```

- **2. Trust all and continue** liga a confirmação por hook. A confiança fica gravada pelo próprio Codex (em `~/.codex/config.toml`) e a tela não volta nas próximas sessões.
- **3. Continue without trusting** funciona do mesmo jeito para o que importa: "trabalhando", "aguardando você" e "terminou" continuam chegando pelo título da janela e pelo aviso de fim de turno. O app mostra uma faixa lembrando que a confirmação por hook está desligada.
- **1. Review hooks** mostra os dois hooks: os dois chamam o `agentctl`, o script do app que repassa o aviso para a sessão certa. Ele fica em `~/.agent-controller/bin`.

O app nunca abre o Codex pulando essa checagem. Se uma atualização mudar o local do `agentctl`, o Codex pede a confiança de novo.

O Claude Code não tem essa tela: os avisos funcionam sem você fazer nada. Os dois agentes, porém, perguntam se confiam na **pasta** quando ela é nova para eles; isso é do agente, não do app.

## Limitações do v1

- **Fechar o app encerra todos os agentes**, mesmo no meio de uma tarefa. O app pede confirmação antes, listando as sessões que serão encerradas. Ao reabrir, as sessões voltam com nome, pasta e agente, paradas.
- **O painel de mudanças é somente leitura.** Ele não reverte nem aceita trechos; para desfazer algo, use o git ou peça ao agente.
- **O painel de mudanças exige git**, instalado e com a pasta da sessão dentro de um repositório. Sem isso, ele explica o que falta.
- **"Aguardando você" não é infalível.** Ver "Possivelmente aguardando" acima.
- **Só Claude Code e Codex.** Sem comando personalizado, outras IAs, shell puro, SSH, divisão de tela ou macOS.
- **O comando da sessão fica em um arquivo de texto.** O app guarda nome, pasta e agente de cada sessão em `sessions.json`, na pasta de dados do app. Ele não guarda o histórico do terminal nem variáveis de ambiente.

O porquê de cada uma está em [`DECISOES-E-RISCOS.md`](DECISOES-E-RISCOS.md) e nas [ADRs](adr/README.md).

## Consumo de memória

Medido com `npm run measure`, somando todos os processos do app (não os agentes dentro dele):

| Windows 10, app empacotado | Working set |
|---|---|
| App vazio | 255 MB |
| 1 sessão | 298 MB |
| 10 sessões | 396 MB |
| 10 sessões e o painel de mudanças aberto | 426 MB |

Para caber na meta de 450 MB, o app faz o trabalho de vídeo dentro do processo principal. Se uma abertura não terminar bem (um driver de vídeo com defeito, por exemplo), a seguinte entra sozinha em **modo seguro**, sem aceleração: tudo continua funcionando, com cerca de 55 MB a mais. Para forçar o modo seguro, abra o app com a variável `AGENT_CONTROLLER_GPU=safe`.

Os números, o que pesa e a comparação com a meta estão na [ADR 0009](adr/0009-meta-de-consumo-de-recursos.md).

## Desenvolvimento

Requer Node 22.12 ou mais novo. No Linux, também `build-essential` e `python3`, porque o node-pty é compilado na instalação.

```bash
npm ci
npm run dev          # abre o app com recarga automática
npm run lint
npm run typecheck
npm test             # testes do core (sem interface)
npm run build && npm run test:e2e    # testes de fumaça da interface, com um shell no lugar do agente
npm run dist         # gera o instalador do sistema em que você está
```

| Comando | O que faz |
|---|---|
| `npm run test:core:docker` | Roda os testes do core em Linux, dentro do Docker |
| `npm run test:smoke` | Roteiros com os **agentes reais** (fim de turno, permissão, cancelamento). Usa a sua conta e consome créditos; fica fora do CI. O resultado é gravado em `tools/agent-probe/results/`, por agente, versão e sistema |
| `npm run test:smoke:app` | Um turno de cada agente real **dentro do app** |
| `npm run measure` | Mede a memória do app com 0, 1, 5 e 10 sessões. `-- --profile real` usa agentes reais ociosos |

Variáveis dos testes de fumaça: `SMOKE_PROFILES=claude-code,codex`, `SMOKE_CWD=<pasta já confiada pelos agentes>` (sem ela, é usada uma pasta temporária e a confiança gravada é desfeita no fim) e `SMOKE_TRUST_HOOKS=1` (escolhe "Trust all" no Codex; a configuração do Codex é restaurada no fim).

### Estrutura

```
src/
  core/      Node puro, sem Electron: PTY, sessões, perfis de agente, sinais, git, persistência
  main/      processo principal do Electron: janela, notificações, IPC
  preload/   a única API exposta à interface
  renderer/  React: barra lateral, terminal, painel de mudanças
  shared/    tipos e contrato de IPC
resources/agentctl/   script chamado pelos hooks dos agentes
tests/       core (Vitest), e2e (Playwright), smoke (agentes reais)
tools/       sondagem dos agentes, medição de memória
```

Três regras, cobradas pelo lint: `src/core` não importa Electron; a interface não acessa Node; cada agente é um perfil (dados) mais um adaptador, e nada fora de `src/core/agents` sabe qual agente está rodando.

### Linux pelo WSL2

Clone o repositório **dentro do sistema de arquivos do WSL** (por exemplo em `~/src/agent-controller`), não em `/mnt/c` ou `/mnt/g`: nas pastas do Windows os eventos de arquivo não chegam de forma confiável e a instalação fica muito lenta.

```bash
sudo apt update && sudo apt install -y build-essential python3 git \
  libgtk-3-0 libnss3 libasound2t64 libgbm1 libxss1 libnotify4
# Node 22: https://github.com/nvm-sh/nvm
git clone https://github.com/HenriqueAurelio/agent-controller ~/src/agent-controller
cd ~/src/agent-controller && npm ci && npm run dev
```

A janela abre pelo WSLg. Notificações do sistema e foco de janela não são confiáveis no WSLg: esses dois pontos são validados em uma máquina Linux de verdade (tarefa 6.3).

## Licença

MIT. Ver [`LICENSE`](LICENSE).
