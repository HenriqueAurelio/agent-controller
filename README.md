# Agent Controller

Um app desktop que reúne sessões de **Claude Code** e **Codex** em uma janela só, avisa quando um agente termina ou precisa de você, e mostra o que ele alterou no código.

- Windows e Linux.
- Cada sessão é um terminal de verdade: o agente roda nele como rodaria no seu terminal.
- O app não altera a configuração de nenhum agente: os avisos são ligados por parâmetro, na hora de abrir.

## Pré-requisitos

| O quê | Para quê | Como conferir |
|---|---|---|
| [Claude Code](https://docs.claude.com/claude-code) e/ou [Codex CLI](https://developers.openai.com/codex/cli) | São os agentes que o app abre. Precisam estar instalados, no `PATH` e logados | `claude --version`, `codex --version` |
| [git](https://git-scm.com) 2.15 ou mais novo | Só para o painel "Ver mudanças" | `git --version` |

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
2. Escolha a **pasta** onde o agente vai trabalhar e dê um **nome** à sessão. O campo já vem com a pasta da última sessão, e as **recentes** ficam logo abaixo, a um clique. Em **Preferências → Agentes → Sessões** dá para fixar uma pasta inicial.

   A **☆** ao lado do campo guarda a pasta nos **favoritos**; elas aparecem primeiro, acima das recentes, toda vez que você cria uma sessão ou troca a pasta de uma. A lista também é editada em **Preferências → Agentes → Sessões**.
3. Escolha o **agente**: Claude Code ou Codex. Um agente que não está instalado aparece desabilitado, com a instrução de instalação.
4. Se quiser, informe o **comando** que a sessão roda no lugar do agente (veja "Comando do agente", abaixo). Vazio, roda o próprio agente.
5. **Criar e iniciar** abre o agente no terminal da sessão.

Daí em diante é o agente de sempre: digite o prompt no terminal.

Outros caminhos para o mesmo lugar:

- **Arrastar uma pasta** do gerenciador de arquivos para a janela abre **Nova sessão** já com ela preenchida. Um arquivo solto vale pela pasta em que está.
- **Duplicar** (o botão **⧉** na sessão, ou a paleta de comandos) abre outra sessão na mesma pasta, com o mesmo agente.
- **Trocar a pasta** de uma sessão que já existe: clique no caminho no topo da sessão, ou use a paleta de comandos. O agente trabalha na pasta em que foi aberto; se estiver rodando, o app avisa, encerra e abre de novo na nova pasta, e a conversa em andamento não continua.
- **Parar e iniciar o agente** não tem botão: abrir uma sessão parada inicia o agente dela, e um agente que saiu com a sessão aberta inicia de novo com **Enter** no terminal. Para parar sem fechar a sessão, use "parar o agente" na paleta de comandos, ou peça ao próprio agente que saia (`/exit`).

### Comando do agente

Quem usa o mesmo agente de mais de um jeito costuma ter aliases ou funções no perfil do shell: `claude-work` e `claude-personal`, por exemplo, uma conta em cada um. O app abre o executável do agente direto, sem shell, e por isso não os enxerga. Para usá-los, diga qual comando a sessão roda:

- **Em uma sessão:** o campo **Comando** de **Nova sessão**. O comando fica guardado com a sessão, aparece no topo dela ao lado do nome do agente, e **Duplicar** o leva junto. Os comandos que outras sessões do mesmo agente já usam são sugeridos no campo.
- **Em todas as sessões de um agente:** **Preferências → Agentes**, um comando para o Claude Code e outro para o Codex. Vale para as sessões que não têm um comando só delas, inclusive as que já existem, a partir da próxima vez que forem iniciadas.

O comando é uma linha, como você digitaria no terminal, e pode ter argumentos (`claude-work --model opus`). Ele roda **no seu shell, iniciado como você o inicia**, e por isso aliases e funções valem: no Windows, o PowerShell com o seu perfil (`pwsh`, se estiver instalado, senão o Windows PowerShell); no Linux, o shell de `$SHELL` em modo interativo.

O que muda em uma sessão com comando:

- **O agente continua sendo o que você escolheu.** É ele que diz ao app como ler o estado da sessão; o comando não troca isso. Rodar o Codex em uma sessão de Claude Code deixa os avisos errados.
- **Os avisos dependem de o comando repassar os argumentos.** O app acrescenta ao fim do comando os argumentos que passaria ao agente. Um alias repassa sozinho; uma função precisa fazer isso (`@args` no PowerShell, `"$@"` no bash). Sem isso a sessão funciona, mas o estado passa a ser estimado ("Possivelmente aguardando").
- **O app não confere se o agente está instalado nem a versão.** Quem acha o comando é o seu shell; se ele não existir, o erro aparece no terminal da sessão.
- **Um alias de `cmd.exe` (doskey) não funciona:** no Windows o comando roda no PowerShell.

### O que cada estado significa

A bolinha ao lado do nome da sessão mostra o estado:

| Estado | Significa |
|---|---|
| **Parada** | O agente não está rodando. Sessões restauradas voltam assim e o agente inicia quando você abre a sessão; se ele sair com a sessão aberta, **Enter** no terminal inicia de novo |
| **Iniciando** | O agente foi aberto e ainda não mostrou o prompt |
| **Trabalhando** | O agente está no meio de um turno |
| **Aguardando você** | O agente está parado esperando: pediu uma permissão, fez uma pergunta ou está no prompt |
| **Terminou** | O turno acabou |
| **Erro** | O agente saiu com erro, ou não pôde ser aberto. O motivo aparece no terminal |

"Aguardando você" é o estado que pede uma ação sua, e por isso é o que mais chama atenção: a linha da sessão fica destacada em âmbar, o estado vira uma etiqueta preenchida e a bolinha pulsa. O título da janela mostra quantas sessões estão aguardando, por exemplo `(3 aguardando) Agent Controller`, o que aparece na barra de tarefas mesmo com o app em segundo plano.

Bolinha **cheia** quer dizer que o próprio agente informou o estado. Bolinha **vazada e tracejada**, com o texto "**Possivelmente** aguardando você", quer dizer que o app só está supondo: o agente ficou alguns segundos sem escrever nada, e isso tanto pode ser uma pergunta quanto um build demorado e silencioso. O tempo dessa suposição é ajustável nas preferências, e 0 a desliga.

### Avisos

Quando um agente que estava trabalhando termina ou passa a aguardar você, o app mostra uma notificação do sistema com o nome da sessão. Clicar nela traz a janela para a frente e abre a sessão. A sessão que você está olhando não gera notificação; as outras ganham também um ponto azul na barra lateral.

Em **Preferências** (`Ctrl+,`) dá para desligar cada tipo de aviso e o som.

### Ver o que o agente alterou

**Ver mudanças** (botão no topo da sessão, `Ctrl+Shift+G`, ou "ver mudanças" na paleta de comandos) abre o painel de mudanças:

- A lista dos arquivos adicionados, modificados, removidos, renomeados e não rastreados, agrupados por pasta.
- O antes e depois do arquivo selecionado, lado a lado ou em linha.
- **Edição:** o lado direito é o arquivo como está na pasta. Dá para digitar nele e salvar com `Ctrl+S` ou o botão **Salvar**; a seta entre os dois lados desfaz um trecho. Se o agente escrever no mesmo arquivo enquanto você edita, o app não grava por cima: avisa e deixa você escolher entre recarregar e sobrescrever.
- **Comparar com**: o último commit, ou o início da sessão (só o que mudou desde que o agente foi aberto).
- **Git, comparando com o último commit:**
  - **Marcar para o commit:** a caixa ao lado de cada arquivo faz o *stage* dele; desmarcar desfaz, sem mexer no arquivo. A lista se divide em **Para o commit** e **Fora do commit**. Uma caixa pela metade quer dizer que só parte das mudanças do arquivo está marcada.
  - **Commit:** com algo marcado, o rodapé mostra o que entra e pede a mensagem; **Commit** (ou `Ctrl+Enter`) faz o commit do que está marcado. Os hooks do repositório rodam; se um falhar, o que ele disse aparece no painel e nada é feito. O app não faz push nem `--amend`.
  - **Descartar:** o botão **↺** de um arquivo (aparece ao passar o mouse) devolve o arquivo ao que o último commit tem, ou o apaga se for novo. O app pergunta antes, guarda uma cópia em `~/.agent-controller/descartados/` e mostra **Desfazer** logo em seguida. As cópias ficam 30 dias. Desfazer não funciona se o arquivo mudou depois de descartado, para não apagar o que foi escrito nele.
  - Com o agente trabalhando, descartar e fazer commit pedem uma confirmação a mais. Se o agente estiver usando o git ao mesmo tempo, o app avisa que o repositório está ocupado; é só tentar de novo.
- A lista se atualiza sozinha enquanto o painel está aberto.
- **Vários repositórios:** se a pasta da sessão guarda mais de um repositório (lado a lado numa pasta comum, ou um dentro do outro), a lista ganha um cabeçalho por repositório, com a branch e a contagem de cada um, e o contador do botão soma todos. Com um repositório só, nada muda.

### Ver todos os arquivos da pasta

**Arquivos** (botão no topo da sessão, `Ctrl+Shift+E`, ou o botão **Todos os arquivos** dentro do painel) troca a lista de mudanças por uma árvore com tudo o que há na pasta, a partir da raiz do repositório. Funciona também em pastas sem git.

- As pastas abrem no lugar, e só são lidas quando abertas. Com o teclado: setas para andar, `→` e `←` para abrir e fechar, `Enter` para abrir o arquivo.
- O arquivo escolhido abre no mesmo editor do painel de mudanças, e pode ser editado e salvo do mesmo jeito.
- **Ocultos** (caixa no painel, `Ctrl+Shift+H`, ou em Preferências) mostra também o que normalmente fica de fora: arquivos e pastas que começam com ponto (`.env`, `.github`, a própria `.git`) e o que o `.gitignore` cobre (`node_modules`, saídas de build). Eles aparecem esmaecidos. A escolha fica guardada.
- Os arquivos que mudaram continuam marcados com a mesma letra da lista de mudanças.

### Verificações ao fim do turno

"Terminou" diz que o agente parou, não que o trabalho está certo. As **verificações** são os comandos que dizem isso: `npm run lint`, `npm test`, o que o projeto usar. O app os roda sozinho quando o agente termina um turno que mudou arquivos, e mostra o resultado na sessão.

1. Clique em **Verificações** no topo da sessão (ou "Verificações de “X”" na paleta de comandos).
2. Se a pasta tem um `package.json`, os scripts `lint`, `typecheck`, `check` e `test` aparecem como sugestão, já com o gerenciador do projeto (`npm`, `pnpm`, `yarn`, `bun`). Clique para adicionar, ou escreva os seus em **+ Adicionar verificação**.
3. **Salvar.** Só os comandos salvos rodam; uma sugestão sozinha nunca roda.

Cada verificação tem um nome, o comando (uma linha, como no terminal), um limite de tempo em segundos e a caixa **Ao fim do turno**. Desmarcada, ela só roda quando você pedir.

Daí em diante:

- **Quando roda:** ao fim de cada turno do agente, se algum arquivo da pasta mudou desde a última rodada (o app compara o commit, o `git status` e a data de cada arquivo alterado). Fora de um repositório git, roda a cada turno. **Rodar agora**, no mesmo diálogo ou na paleta, roda todas na hora.
- **Onde roda:** no seu shell, na pasta da sessão, como o comando de um agente: PowerShell com o seu perfil no Windows, `$SHELL` no Linux. Sem terminal e com `CI=1`, uma depois da outra.
- **O resultado** aparece na barra lateral e no botão: **✓** tudo passou, **✗ 2** duas falharam, **…** na fila ou rodando, **–** cancelada. O diálogo mostra cada comando, quanto tempo levou e a saída (só o final, se for longa).
- **O agente voltou a trabalhar:** a rodada em andamento é cancelada, porque o resultado já estaria velho. A próxima vem no fim desse turno.
- **Aviso:** se as verificações de um turno falham numa sessão que você não está olhando, o app avisa ("Verificações falharam: 1 de 2."). Segue a preferência do aviso de "terminou".
- **Mandar o erro ao agente:** com uma rodada que falhou, o botão cola no prompt do agente o que falhou (o comando e as últimas linhas da saída), numa linha só, com **⏎** onde havia quebra de linha. Ele **não envia**: confira no terminal e aperte **Enter**. Uma linha só porque, no Windows, uma quebra de linha colada no agente pode enviar o texto antes da hora.
- No máximo duas sessões rodam verificações ao mesmo tempo; as outras esperam a vez.

As verificações ficam guardadas **por pasta**: toda sessão naquela pasta usa as mesmas, e elas voltam ao reabrir o app. O resultado da última rodada não volta. Elas **não vão** no arquivo de exportação das preferências: são comandos que o app roda sozinho, e importar um arquivo não deve trazê-los.

### Layout

Em **Preferências → Layout** você escolhe onde fica cada parte da janela. As três escolhas são independentes e combinam entre si, e uma miniatura mostra o resultado antes de fechar:

| Parte | Onde pode ficar |
|---|---|
| **Sessões** | À esquerda, à direita, em cima ou embaixo. Em cima e embaixo a lista corre de lado, e as setas `←` / `→` andam por ela |
| **Painel de mudanças e arquivos** | Por cima do terminal (o padrão) ou ao lado dele: à esquerda, à direita, em cima ou embaixo. Ao lado, o terminal continua à vista e usável |
| **Lista de arquivos do painel** | À esquerda, à direita, em cima ou embaixo do texto do arquivo |

A mudança vale na hora e fica guardada. **Restaurar padrão** volta ao arranjo de fábrica.

### Idioma

Em **Preferências → Geral → Idioma** você escolhe a língua da interface: **Português (Brasil)**, que é a de fábrica, **English** ou **Español**. A troca vale na hora, sem reabrir o app, e fica guardada. Ela alcança tudo o que o app escreve: telas, dicas, paleta de comandos, mensagens de erro, as notificações do sistema, as perguntas ao fechar e os avisos que o app deixa no terminal (`[O agente saiu (código 1).]`). O que o próprio agente escreve no terminal não é traduzido, e os avisos que já estavam na tela continuam na língua em que foram escritos.

Este README descreve o app em português; em inglês, os nomes dos botões e menus são os equivalentes.

### Exportar e importar as configurações

Em **Preferências → Importar e exportar**, **Exportar…** grava em um arquivo `.json`, onde você escolher, tudo o que está nas preferências: idioma, avisos, terminal, pasta inicial, pastas favoritas, comandos dos agentes, layout e atalhos. **Importar…** lê um arquivo desses e aplica na hora, substituindo as preferências atuais; o que o arquivo não disser volta ao padrão.

As sessões e as verificações de cada pasta não vão no arquivo. Caminhos de pasta (a inicial e as favoritas) vão como estão: em outra máquina, podem não existir. Os comandos dos agentes também vão, e passam a rodar nas sessões depois de importados: só importe um arquivo de origem conhecida, e confira **Preferências → Agentes** depois.

### Atalhos

| Atalho | Ação |
|---|---|
| `Ctrl+Shift+N` | Nova sessão |
| `Ctrl+Tab` / `Ctrl+Shift+Tab` | Próxima sessão / sessão anterior (também `Ctrl+PageDown` / `Ctrl+PageUp`) |
| `Ctrl+1` … `Ctrl+9` | Ir para a sessão N (fixo) |
| `Ctrl+0` | Ir para a lista de sessões |
| `Ctrl+Shift+T` | Ir para o terminal |
| `Ctrl+Shift+G` | Abrir ou fechar o painel de mudanças |
| `Ctrl+Shift+E` | Abrir ou fechar todos os arquivos da pasta |
| `Ctrl+Shift+H` | Mostrar ou esconder arquivos ocultos |
| `Ctrl+Shift+P` | Paleta de comandos |
| `Ctrl+,` | Preferências |
| sem atalho de fábrica | Próxima sessão aguardando você; fechar a sessão atual |
| `Ctrl+Shift+C` / `Ctrl+Shift+V` | Copiar / colar no terminal. No Windows, `Ctrl+C` com texto selecionado e `Ctrl+V` também |

Esses são os atalhos de fábrica. Em **Preferências → Atalhos** cada ação pode ter os seus: clique em **+**, pressione as teclas e pronto; o **×** ao lado de um atalho o remove, e **Restaurar padrões** desfaz tudo. Uma ação aceita até quatro atalhos. Se a combinação já era de outra ação, ela muda de dono. Para não atrapalhar o que você digita no terminal, um atalho precisa de `Ctrl`, `Alt` ou de uma tecla de função, e não pode ser um dos que o terminal e o editor usam (`Ctrl+C`, `Ctrl+V`, `Ctrl+S`, `F2`, `F12`).

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

- **Fechar o app encerra todos os agentes**, mesmo no meio de uma tarefa. O app pede confirmação antes, listando as sessões que serão encerradas. Ao reabrir, as sessões voltam com nome, pasta e agente, paradas, e cada uma inicia quando você a abre (numa conversa nova). Encerrar os agentes leva alguns segundos, com a janela já fechada; se você abrir o app nesse meio-tempo, ele abre assim que o anterior terminar de sair.
- **O painel de mudanças faz pouco no git, de propósito.** Marca para o commit, faz commit e descarta um arquivo por vez. Não há push, pull, branch, merge, stash, `--amend`, stage de trechos nem "descartar tudo"; para isso, use o git ou peça ao agente. É mais seguro editar e operar com o agente parado.
- **O painel de mudanças exige git**, instalado e com a pasta da sessão dentro de um repositório. Sem isso, ele explica o que falta.
- **"Aguardando você" não é infalível.** Ver "Possivelmente aguardando" acima.
- **Só Claude Code e Codex.** Sem outras IAs, shell puro, SSH, divisão de tela ou macOS. O comando de uma sessão pode ser trocado, mas o agente por trás dele tem que ser um dos dois.
- **O comando de uma sessão não é editável depois de criada.** Para trocar, crie outra sessão (ou mude o comando do agente nas preferências, se a sessão não tiver um só dela).
- **O comando da sessão fica em um arquivo de texto.** O app guarda nome, pasta, agente e comando de cada sessão em `sessions.json`, na pasta de dados do app. Ele não guarda o histórico do terminal nem variáveis de ambiente.

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
  shared/    tipos, contrato de IPC e textos da interface em cada idioma (i18n/)
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

O script `tools/wsl-setup.sh` faz essa preparação de uma vez, incluindo o Claude Code e o Codex: `sudo bash tools/wsl-setup.sh system` e depois `bash tools/wsl-setup.sh user`. O login nos dois agentes fica com você (`claude` e `codex`, uma vez cada).

A janela abre pelo WSLg. Notificações do sistema e foco de janela não são confiáveis no WSLg: esses dois pontos são validados em uma máquina Linux de verdade (tarefa 6.3).

## Licença

MIT. Ver [`LICENSE`](LICENSE).
