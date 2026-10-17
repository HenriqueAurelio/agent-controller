# Agent Controller

Um app desktop que reúne sessões de **Claude Code** e **Codex** em uma janela só, avisa quando um agente termina ou precisa de você, e mostra o que ele alterou no código.

- Windows e Linux.
- Cada sessão é um terminal de verdade: o agente roda nele como rodaria no seu terminal.
- O app não altera a configuração de nenhum agente: os avisos são ligados por parâmetro, na hora de abrir.

## A ideia do projeto

Quem trabalha com agentes de código hoje vive entre muitas janelas: um terminal por agente, o editor para revisar, o git para desfazer, e o próprio caderno para lembrar quem está fazendo o quê. O Agent Controller quer ser **o lugar único do dev que trabalha com agentes**:

- **Centralizador.** Todos os agentes, de todos os projetos, numa janela, com o estado de cada um à vista e um aviso quando algum precisa de você.
- **Orquestrador.** O app não só mostra os agentes: ele coordena o trabalho entre eles. Ele isola cada um numa cópia do repositório, roda as verificações quando um turno termina, manda prompts a várias sessões, e cada vez mais passa o trabalho de uma sessão para outra (implementar → revisar → corrigir).
- **IDE leve, feita para revisar.** O que o agente escreveu é lido, corrigido e devolvido a ele sem sair do app: diff editável, árvore de arquivos, git, realce do VS Code e terminal ao lado. Ele não quer substituir o VS Code ou o Zed para escrever código à mão: quer cobrir o ciclo "o agente fez, eu confiro, eu peço ajuste".

O que não muda: cada agente roda no terminal dele, do jeito de sempre; o app não mexe na configuração deles; e tudo o que o app escreve no agente sai de um pedido seu ou de uma regra que você criou.

## Estado atual

**Pronto e em uso** (descrito em [Como usar](#como-usar)):

| Área | O que já existe |
|---|---|
| Sessões | Claude Code e Codex em terminais reais, grupos por repositório, comando próprio por sessão (aliases e funções do seu shell), pastas recentes e favoritas, arrastar pasta para abrir; painel geral com todas as sessões numa grade |
| Estado e avisos | Estado de cada sessão pelos sinais do próprio agente, notificação do sistema, contador de "aguardando" no título da janela, pedidos de permissão respondidos pela barra lateral ou pela notificação |
| Isolamento | Cópia isolada por sessão (git worktree), com comando de preparo e limpeza; aviso quando sessões em cópias diferentes mudam o mesmo arquivo, com "provável conflito" quando as linhas se cruzam |
| Verificações | Lint, typecheck e testes ao fim de cada turno, com ✓/✗ na sessão e "mandar o erro ao agente" |
| Prompts | Prompts guardados com variáveis, enviados a uma ou várias sessões, com espera pelo fim do turno; fila de prompts por sessão, um a cada fim de turno |
| Revisão de código | Painel de mudanças com diff editável, árvore de arquivos, stage, commit e descarte com desfazer, vários repositórios na mesma pasta, realce TextMate e temas do VS Code |
| Checkpoints | Uma foto da pasta no fim de cada turno, no próprio git e fora das branches: ver só o que o último turno mudou, comparar dois turnos, voltar a um turno e desfazer |
| Terminal | Terminal auxiliar por sessão, layout configurável, atalhos editáveis e uso completo sem mouse |
| Interface | Português, inglês e espanhol |

**Próximos passos**, já priorizados em [`docs/funcionalidades`](docs/funcionalidades/README.md#segunda-rodada-de-painel-de-agentes-a-orquestrador-e-ide-leve):

- **Leva 1, orquestração:** "melhor de N", revisor automático, encadear sessões e quadro de tarefas.
- **Leva 2, IDE:** links `arquivo:linha` no terminal, `Ctrl+P`, abrir no editor externo, painel de problemas, busca no projeto, seguir o agente, histórico e autoria do arquivo, tela dividida e multibuffer.
- **Depois:** o que está em [`docs/funcionalidades/futuras`](docs/funcionalidades/futuras/README.md), as propostas que restam da primeira rodada (formatar ao salvar, extensões, comentar no diff, uso e custo) e [retomar a conversa](docs/planos/retomar-conversa.md).

A `v0.1.0` existe como release em rascunho, com os três instaladores, e ainda falta testá-la numa máquina limpa antes de publicar. O que falta está em [`docs/pendencias/primeira-release.md`](docs/pendencias/primeira-release.md).

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

### Grupos de sessões

Com várias sessões no mesmo repositório, dá para juntá-las num **grupo** (por exemplo, `XXX-REPO`) e ver cada repositório como um bloco na barra lateral.

- **Criar:** o botão **⊞** no topo da barra lateral, ou "Novo grupo de sessões" na paleta. O nome já vem com a pasta da sessão aberta, e as sessões abertas nessa pasta já vêm marcadas; ajuste e clique em **Criar grupo**.
- **Pôr e tirar sessões:** arraste a sessão para o cabeçalho do grupo, ou para entre as sessões dele. Para tirá-la, arraste para a faixa **Solte aqui para tirar do grupo**, que aparece no topo da lista durante o arraste. Pela paleta, "Mover … para o grupo …" e "Tirar … do grupo …". Com o teclado, `Alt+↑` / `Alt+↓` além da borda do grupo leva a sessão para o grupo vizinho, ou para fora.
- **Nova sessão já no grupo:** o **+** no cabeçalho do grupo. Em **Nova sessão**, o campo **Grupo** também escolhe; **Duplicar** mantém a cópia no mesmo grupo.
- **Recolher:** clique no cabeçalho. Recolhido, o grupo mostra quantas sessões tem e, em laranja, quantas estão aguardando você; a sessão aberta continua à vista mesmo dentro de um grupo recolhido.
- **Renomear:** clique duas vezes no nome do grupo (ou `F2` com o cabeçalho focado). **✎** edita o nome e as sessões de uma vez.
- **Desfazer:** o **×** no cabeçalho desfaz o grupo. **As sessões continuam abertas**, só deixam de estar agrupadas.

As sessões sem grupo ficam no topo da lista, e os grupos vêm em seguida, na ordem que você escolher (arraste um cabeçalho sobre o outro, ou `Alt+↑` / `Alt+↓` com ele focado). `Ctrl+1` … `Ctrl+9` seguem a lista como ela aparece. Os grupos são guardados com as sessões e voltam ao reabrir o app, recolhidos ou não; não vão no arquivo de exportação das configurações.

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

### Painel geral

Com várias sessões, a barra lateral diz *quem* precisa de você; o **painel geral** mostra *o quê*. Ele abre com `Ctrl+Shift+O`, com o botão **▦** no topo da barra lateral ou pela paleta, e ocupa o lugar do terminal: todas as sessões numa grade, um bloco por grupo. Cada cartão traz:

- o nome, o agente, a bolinha de estado e há quanto tempo a sessão está nele ("Aguardando você há 4 min");
- as **últimas 6 linhas** do terminal, em texto puro: sem cores, sem linhas vazias e sem as bordas e réguas que os agentes desenham. Se não sobrar nada legível, o cartão diz isso e fica só o estado;
- a branch **⑂**, o número de arquivos mudados **±** e o resultado das verificações **✓/✗**;
- o pedido de permissão com **✓** e **✕**, como na barra lateral, a fila **⏵ n** e o aviso de conflito **⚠ n**, quando existem.

No topo, o filtro mostra **Todas**, só as que estão **Aguardando você** ou só as que estão **Trabalhando**, com quantas há em cada um. **Ordenar por atenção** (ligado de início) põe, em cada grupo, primeiro as que aguardam você, depois as com verificações falhando, depois o resto.

Um clique no cartão abre a sessão. Pelo teclado, o painel começa no cartão da sessão que estava à vista: as setas andam pelos cartões, `Enter` abre e `Esc` volta ao terminal. Escolher uma sessão na barra lateral também fecha o painel.

O painel não monta nenhum terminal: as linhas vêm do que o app já guarda de cada sessão, chegam no máximo uma vez por segundo e só das sessões que escreveram algo, e só enquanto o painel está aberto.

### Avisos

Quando um agente que estava trabalhando termina ou passa a aguardar você, o app mostra uma notificação do sistema com o nome da sessão. Clicar nela traz a janela para a frente e abre a sessão. A sessão que você está olhando não gera notificação; as outras ganham também um ponto azul na barra lateral.

Em **Preferências** (`Ctrl+,`) dá para desligar cada tipo de aviso e o som.

### Responder a um pedido sem abrir a sessão

Quando o agente pede permissão ("posso rodar `npm install`?"), a sessão ganha, na barra lateral, uma segunda linha com a ferramenta e o alvo (`Bash npm install`, `Edit src/app.ts`; um comando longo mostra o começo e o fim) e os botões **✓** (permitir) e **✕** (negar). Onde o menu do agente oferece "não perguntar de novo", aparece também **sempre**. O clique escreve no terminal do agente a tecla do menu dele, como se você tivesse digitado, e a sessão em que você está continua aberta. Na sessão que você está olhando, `Alt+Y` permite e `Alt+N` nega (editáveis em **Preferências → Atalhos**; sem pedido aberto, as teclas vão para o terminal).

- Os botões só aparecem quando o menu do agente está na tela. Se o pedido mudou entre você ver e clicar (o agente já seguiu, ou perguntou outra coisa), nada é escrito, e a sessão diz "O pedido mudou; abra a sessão".
- Uma pergunta aberta do agente ("qual das duas abordagens?") não tem botões: só pedidos de permissão, que têm resposta fixa.
- A notificação do pedido traz **Permitir** e **Negar** no Windows. No Linux ela vem sem botões, e o clique abre a sessão, como as outras.
- O pedido nunca é respondido sozinho: cada resposta sai de um clique ou de uma tecla sua.
- No Codex, o pedido só chega ao app com os hooks confiados (veja [abaixo](#codex-o-passo-de-confiança-dos-hooks)); sem eles, responda no terminal.
- Para sempre ler o terminal antes de responder, desligue **Preferências → Geral → Responder pedidos de permissão pela lista de sessões e pela notificação**: a linha com o pedido continua, sem os botões.

### Cópia isolada (git worktree)

Dois agentes na mesma pasta pisam um no outro. Para cada um trabalhar sem atrapalhar o outro, crie a sessão como **cópia isolada**: o app faz um `git worktree` do repositório, numa branch nova, e abre o agente lá. O repositório e o histórico são os mesmos; a pasta e a branch são só daquela sessão.

1. Em **Nova sessão**, escolha uma pasta que esteja num repositório git. Aparece a caixa **Cópia isolada (git worktree)**.
2. Marque. A **branch nova** vem sugerida a partir do nome da sessão (`ac/corrigir-login`), e **A partir de** é a branch atual; dá para trocar os dois.
3. **Criar e iniciar.** A cópia vai para `~/.agent-controller/worktrees/<repositório>/<branch>`.

Depois disso:

- O topo da sessão mostra a branch, com o ícone **⑂**.
- O painel de mudanças mostra só o que aconteceu na cópia. Em **Comparar com**, a opção **A base da branch** mostra tudo o que a branch mudou desde que saiu da base: os commits dela e o que ainda não tem commit.
- **Duplicar** uma sessão em cópia abre a nova na mesma cópia. Enquanto as duas existirem, uma faixa avisa que elas mexem nos mesmos arquivos.
- **Ao fechar**, o app pergunta o que fazer com a cópia. **Manter** (o padrão) deixa a pasta e a branch; dá para abrir outra sessão nela depois. **Remover a cópia** apaga a pasta, e só é possível quando nada nela está sem commit e nenhuma outra sessão a usa; com mudanças, o app diz quais e não remove. A **branch nunca é apagada**.
- O app não faz commit nem push: abrir o PR fica com você ou com o agente.

**Conflito entre sessões.** As cópias evitam que dois agentes escrevam no mesmo arquivo ao mesmo tempo, mas não o conflito na hora de juntar as branches. Por isso o app cruza o que cada sessão mudou em todas as cópias do mesmo repositório (e na pasta original dele) e avisa quando duas mexem no mesmo arquivo:

- Na barra lateral, a sessão ganha um **⚠ n**: n arquivos dela também mudaram em outra sessão. Passe o mouse para ver em qual ("2 arquivos também mudados em “refatorar-ipc”"). Fica vermelho quando há **provável conflito**: as linhas mudadas nas duas se cruzam ou encostam, que é quando o merge do git para. Sem isso, é só "mesmo arquivo".
- No painel de mudanças, o arquivo em comum tem a mesma marca. Passar o mouse diz com qual sessão; **um clique abre o mesmo arquivo nela**, com o painel em **A base da branch** quando o arquivo já tem commit lá.
- Conta o que ainda não tem commit e os commits da branch desde a base, os mesmos de **A base da branch**. Sessões na mesma cópia não se avisam entre si: elas dividem os próprios arquivos.
- O app olha de novo quando o painel de uma das sessões vê uma mudança e no fim de cada turno, no máximo uma vez a cada 5 segundos por repositório. Ele não abre observador de pasta novo para isso: uma sessão sem o painel aberto é revista no fim do turno.

Em **Preferências → Sessões → Conflito entre sessões** dá para desligar o aviso, deixar de contar as sessões paradas e editar a lista de arquivos que ele ignora: um padrão por linha, já com os lockfiles (`package-lock.json`, `pnpm-lock.yaml`, `yarn.lock` e outros).

Em **Preferências → Sessões** você escolhe a **pasta das cópias** e um **comando para preparar cada cópia nova** (por exemplo, `npm ci`), que roda uma vez, na cópia, antes de a sessão abrir; se ele falhar, a sessão não abre, e a cópia fica. A mesma aba lista as cópias, com branch, tamanho, data e quais sessões as usam, e remove as que nenhuma sessão usa. Esses dois ajustes ficam com as sessões, não vão no arquivo de exportação das preferências.

Os agentes perguntam se confiam em cada pasta nova, e cada cópia é uma pasta nova. No Windows, um `node_modules` fundo dentro da cópia pode passar do limite de caminho; se acontecer, `git config --global core.longpaths true` ajuda o git, e uma pasta de cópias curta ajuda o resto.

### Ver o que o agente alterou

**Ver mudanças** (botão no topo da sessão, `Ctrl+Shift+G`, ou "ver mudanças" na paleta de comandos) abre o painel de mudanças:

- A lista dos arquivos adicionados, modificados, removidos, renomeados e não rastreados, agrupados por pasta.
- O antes e depois do arquivo selecionado, lado a lado ou em linha.
- **Edição:** o lado direito é o arquivo como está na pasta. Dá para digitar nele e salvar com `Ctrl+S` ou o botão **Salvar**; a seta entre os dois lados desfaz um trecho. Se o agente escrever no mesmo arquivo enquanto você edita, o app não grava por cima: avisa e deixa você escolher entre recarregar e sobrescrever.
- **Cores do código:** o código é colorido como no VS Code, com as mesmas gramáticas (funções, parâmetros, propriedades e tipos com cores próprias) e a linguagem tirada do nome do arquivo, inclusive `Dockerfile`, `Makefile`, `.env`, JSON, TOML, Vue e Svelte. O seletor ao lado do nome do arquivo mostra a linguagem detectada e deixa escolher outra só para aquele arquivo. Arquivos com mais de 30 000 linhas ficam com o realce mais simples do Monaco.
- **Comparar com**: o último commit, o início da sessão (só o que mudou desde que o agente foi aberto) ou, num repositório git, **O turno anterior** (só o que o último turno mudou; veja [Linha do tempo e checkpoints](#linha-do-tempo-e-checkpoints)).
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

### Linha do tempo e checkpoints

No fim de cada turno que mudou arquivos, o app tira uma **foto** da pasta (um *checkpoint*) e a guarda no próprio git, numa ref escondida (`refs/agent-controller/checkpoints/<sessão>/<n>`). Isso não cria commit na branch, não mexe no índice nem nos arquivos, e não aparece no `git log`. Com isso dá para deixar o agente correr: um turno ruim se desfaz em um clique.

- **Linha do tempo** (botão no topo da sessão, ou "linha do tempo" na paleta): a lista dos checkpoints, do mais novo ao mais antigo, com a hora, quantos arquivos mudaram e o **✓**/**✗** das verificações daquele turno. **Início** é a pasta como a sessão a encontrou.
- **Ver o que mudou** num checkpoint abre o painel com o que mudou nele em relação ao anterior. **Comparar dois pontos** escolhe qualquer par (ou um ponto e a pasta agora). Entre dois checkpoints o painel é só leitura.
- **O turno anterior**, em "Comparar com" no painel, mostra só o que o último turno mudou.
- **Voltar a este turno** devolve os arquivos ao que eram naquele ponto: o que mudou volta, o que não existia é apagado (o que o `.gitignore` cobre, nunca). Antes, o app tira mais uma foto ("Antes de voltar ao turno N"), e **Desfazer** volta a ela. Pede confirmação, e mais uma se o agente estiver trabalhando. Se o agente estiver usando o git na hora, o app avisa que o repositório está ocupado.
- **A conversa do agente não volta.** Ele não sabe que os arquivos mudaram; **Avisar o agente** escreve isso no terminal dele (sem Enter, a não ser que **Enviar com Enter** esteja ligado).
- **Diferença para o `/rewind` do Claude Code:** o `/rewind` volta a conversa e os arquivos que o próprio Claude editou. O checkpoint vale para os dois agentes e para tudo o que mudou na pasta, inclusive por um comando no shell (um `sed`, um gerador de código), mas não mexe na conversa. Um não substitui o outro.
- **Quanto guardar:** em **Preferências → Sessões**, ligar ou desligar, quantos por sessão (50) e por quantos dias (7), e quanto espaço os checkpoints de cada sessão ocupam no repositório, com **Podar agora**. Um arquivo maior que 2 MB fica fora da foto (o checkpoint avisa) e voltar não mexe nele.
- **Fechar a sessão** pergunta se apaga os checkpoints dela; mantidos, saem sozinhos depois do prazo. Para apagar todos de um repositório à mão: `git for-each-ref --format='delete %(refname)' refs/agent-controller | git update-ref --stdin`.
- Fora de um repositório git, ou numa pasta comum com vários repositórios dentro, não há checkpoints nem linha do tempo.

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

### Prompts guardados

Pedidos que você repete ("revise o diff", "escreva os testes de {arquivo}") ficam guardados em **Preferências → Prompts**, com nome, texto e, se quiser, um atalho. O app vem com três de fábrica; **Restaurar os de fábrica** os traz de volta no idioma atual.

Para enviar:

- **Paleta:** `Ctrl+Shift+P` → "Prompt: Escrever testes". Abre o diálogo de envio para a sessão à vista.
- **Atalho do prompt**, definido na mesma aba.
- **Painel de mudanças:** com um trecho selecionado no editor, clique com o botão direito → **Mandar ao agente com o prompt…** (ou o botão de mesmo nome no topo do arquivo). O prompt já sabe qual é o arquivo e o trecho.
- **Várias sessões:** na barra lateral, `Ctrl+clique` marca outras sessões além da que está à vista; **Enviar prompt** manda a todas as marcadas.

No diálogo você escolhe o prompt, responde às perguntas dele, pode mexer no texto só para esse envio e marca as sessões de destino. A **prévia** mostra como o texto chega na primeira sessão, com as variáveis preenchidas:

| Variável | Vira |
|---|---|
| `{sessao}` | O nome da sessão |
| `{pasta}` | A pasta da sessão |
| `{branch}` | A branch atual da pasta (vazio fora de um repositório) |
| `{arquivo}` | O arquivo aberto no painel de mudanças |
| `{selecao}` | O trecho selecionado no editor do painel (até 20 mil caracteres; o resto é cortado, com aviso) |
| `{?pergunta}` | Um campo que o diálogo pede na hora de enviar |

Uma variável que o app não conhece fica como está escrita. Cada sessão recebe o texto com as variáveis dela.

Como o texto chega:

- **Sem Enter, de fábrica.** O texto fica no prompt do agente para você conferir e enviar. A preferência **Enviar com Enter** (e a caixa no diálogo, só para aquele envio) aperta o Enter por você.
- **Numa linha só**, com **⏎** onde havia quebra de linha, como em "Mandar o erro ao agente" (ver acima).
- **Agente ocupado:** se ele está trabalhando, ou pedindo uma permissão, o texto **espera o fim do turno**. A sessão mostra "1 envio(s) esperando o turno", com **Cancelar**. **Enviar agora mesmo assim**, no diálogo, não espera. Com vários textos esperando, sai um turno de cada vez.

Os prompts são só texto e **vão no arquivo de exportação** das preferências.

### Fila de prompts

Para um trabalho em passos ("implemente", depois "escreva os testes", depois "atualize o README"), ponha os passos na **fila** da sessão e saia da frente do computador: o app manda o próximo quando o agente termina o turno anterior.

- **Pôr na fila:** no diálogo de envio de prompt (paleta, atalho do prompt, "Mandar ao agente"), o botão **Pôr na fila** fica ao lado de **Enviar**. Com várias sessões marcadas, o item entra na fila de cada uma. Se o agente está livre, o primeiro item vai na hora.
- **Condição de cada item:** **Quando o turno terminar** (de fábrica) ou **Quando as verificações passarem**. Neste caso, ao fim do turno o app roda todas as [verificações](#verificações-ao-fim-do-turno) da pasta e só manda o item se todas passarem.
- **Com Enter.** Os itens da fila vão com Enter, mesmo com **Enviar com Enter** desligado: sem ele, a fila só andaria com o seu Enter. O diálogo avisa isso.
- **Na sessão:** o botão **Fila (3)** no topo abre a lista: arrastar (ou ↑ ↓) para mudar a ordem, **Editar**, **Apagar**, trocar a condição, **Pausar**, **Retomar** e **Enviar o próximo** (manda o primeiro agora, sem esperar a condição). Na barra lateral, **⏵ 2** diz que dois itens esperam; **⏸ 2**, que a fila está pausada.
- **A fila só anda com "Terminou".** Quando o agente pede permissão ou faz uma pergunta, a resposta é sua: a fila espera e volta a andar no próximo "Terminou". O "aguardando você" de quando o agente fica parado também não a move.
- **Verificação que falhou:** a fila para e uma faixa no topo da sessão oferece **Mandar o erro ao agente** (cola o que falhou no prompt dele; a fila volta a andar no fim do turno seguinte, e as verificações rodam de novo), **Pular o item** e **Retomar** (roda as verificações outra vez).
- **Sessão sem sinal do agente** (estado estimado, bolinha tracejada): a fila não anda sozinha; use **Enviar o próximo**.
- **Até 20 itens** por fila. As variáveis (`{branch}`, `{sessao}`…) são preenchidas na hora do envio, não na hora de pôr na fila.
- **Fechar o app guarda a fila.** Ao reabrir, ela volta **pausada**; **Retomar** quando quiser. A fila de uma sessão fechada é apagada com ela. Se o agente sai, a fila pausa.
### Terminal auxiliar

Para rodar algo na pasta da sessão sem sair do app e sem atrapalhar o agente (subir o servidor, olhar um log, `git log`), abra o **terminal auxiliar**: `Ctrl+Shift+"` (a tecla `'` com `Shift`), o botão **Terminal** no topo da sessão ou "Terminal auxiliar: abrir um shell…" na paleta.

- É o **seu shell**, na pasta da sessão, como o seu terminal o abre: PowerShell com o seu perfil no Windows, `$SHELL` no Linux.
- Fica **embaixo** do terminal do agente, com uma divisória que se arrasta. Em **Preferências → Layout** ele pode ir para a **direita**.
- O que você digita nele **não chega ao agente** nem muda o estado da sessão. Ele tem rótulo e cor de borda próprios, e o terminal que está com o teclado fica marcado. `Ctrl+Shift+T` volta ao terminal do agente.
- **Fecha** pelo **×** do cabeçalho, pelo mesmo atalho ou botão, ou com `exit`. Fechar o auxiliar encerra o shell e tudo o que ele estiver rodando. Ele também fecha junto com a sessão, ao trocar a pasta da sessão e ao fechar o app; ao reabrir, volta fechado. Parar o agente não fecha o auxiliar.
- É **um por sessão**. Ao trocar de sessão, cada uma mostra o seu, com o que estava na tela.

### Layout

Em **Preferências → Layout** você escolhe onde fica cada parte da janela. As escolhas são independentes e combinam entre si, e uma miniatura mostra o resultado antes de fechar:

| Parte | Onde pode ficar |
|---|---|
| **Sessões** | À esquerda, à direita, em cima ou embaixo. Em cima e embaixo a lista corre de lado, e as setas `←` / `→` andam por ela |
| **Painel de mudanças e arquivos** | Por cima do terminal (o padrão) ou ao lado dele: à esquerda, à direita, em cima ou embaixo. Ao lado, o terminal continua à vista e usável |
| **Lista de arquivos do painel** | À esquerda, à direita, em cima ou embaixo do texto do arquivo |
| **Terminal auxiliar** | Embaixo do terminal do agente (o padrão) ou à direita dele |

A mudança vale na hora e fica guardada. **Restaurar padrão** volta ao arranjo de fábrica.

### Idioma

Em **Preferências → Geral → Idioma** você escolhe a língua da interface: **Português (Brasil)**, que é a de fábrica, **English** ou **Español**. A troca vale na hora, sem reabrir o app, e fica guardada. Ela alcança tudo o que o app escreve: telas, dicas, paleta de comandos, mensagens de erro, as notificações do sistema, as perguntas ao fechar e os avisos que o app deixa no terminal (`[O agente saiu (código 1).]`). O que o próprio agente escreve no terminal não é traduzido, e os avisos que já estavam na tela continuam na língua em que foram escritos.

Este README descreve o app em português; em inglês, os nomes dos botões e menus são os equivalentes.

### Temas do código

Em **Preferências → Editor**:

- **Com o app escuro** e **Com o app claro**: o tema de cores do código em cada tema do app, com uma prévia ao lado. Vêm 33 temas do VS Code (Dark+, Light+, Monokai, One Dark Pro, Dracula, GitHub, Solarized, Nord, Tokyo Night, Catppuccin e outros). O padrão, **Agent Controller escuro/claro**, usa as cores do Dark+/Light+ com o fundo do app.
- **Importar tema do VS Code…**: um arquivo `.json` de tema, como os que vêm nas extensões de tema do VS Code (na pasta `themes` da extensão). O tema importado passa a valer na hora e pode ser removido na mesma tela. Um tema que só estende outro (`include`) não é aceito.
- **Linguagem por arquivo**: uma associação por linha, `padrão = linguagem` (`*.mdc = markdown`, `conf/nginx/*.conf = nginx`). Vale antes da extensão.

Na paleta de comandos, **Tema do código: …** troca o tema do modo atual do app.

### Exportar e importar as configurações

Em **Preferências → Importar e exportar**, **Exportar…** grava em um arquivo `.json`, onde você escolher, tudo o que está nas preferências: idioma, avisos, terminal, pasta inicial, pastas favoritas, comandos dos agentes, prompts guardados, temas do código, linguagem por arquivo, layout e atalhos. **Importar…** lê um arquivo desses e aplica na hora, substituindo as preferências atuais; o que o arquivo não disser volta ao padrão.

As sessões, as verificações de cada pasta e os temas importados não vão no arquivo (um tema importado que falte na outra máquina volta ao tema do app). Caminhos de pasta (a inicial e as favoritas) vão como estão: em outra máquina, podem não existir. Os comandos dos agentes também vão, e passam a rodar nas sessões depois de importados: só importe um arquivo de origem conhecida, e confira **Preferências → Agentes** depois. Os prompts de um arquivo importado são só texto: nada é enviado sem você abrir o diálogo, ver o texto e clicar em **Enviar**.

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
| `Ctrl+Shift+"` | Terminal auxiliar: abre; se já está aberto, leva o teclado para ele; se já está nele, fecha (a tecla `'` com `Shift`) |
| `Ctrl+Shift+M` | Enviar um prompt às sessões marcadas, ou à atual |
| `Alt+Y` / `Alt+N` | Permitir / negar o pedido de permissão da sessão atual (sem pedido aberto, a tecla vai para o terminal) |
| `Ctrl+Shift+P` | Paleta de comandos |
| `Ctrl+Shift+O` | Abrir ou fechar o painel geral |
| `Ctrl+,` | Preferências |
| sem atalho de fábrica | Próxima sessão aguardando você; fechar a sessão atual; novo grupo de sessões |
| `Ctrl+Shift+C` / `Ctrl+Shift+V` | Copiar / colar no terminal. No Windows, `Ctrl+C` com texto selecionado e `Ctrl+V` também |

Esses são os atalhos de fábrica. Em **Preferências → Atalhos** cada ação pode ter os seus: clique em **+**, pressione as teclas e pronto; o **×** ao lado de um atalho o remove, e **Restaurar padrões** desfaz tudo. Uma ação aceita até quatro atalhos. Se a combinação já era de outra ação, ela muda de dono. Para não atrapalhar o que você digita no terminal, um atalho precisa de `Ctrl`, `Alt` ou de uma tecla de função, e não pode ser um dos que o terminal, o editor e o painel usam (`Ctrl+C`, `Ctrl+V`, `Ctrl+S`, `F2`, `F6`, `F12`, `Ctrl+Espaço`).

#### Sem mouse

Tudo o que o app faz tem caminho pelo teclado.

- **Barra lateral** (`Ctrl+0`): as setas passam pelas sessões e pelos cabeçalhos dos grupos; `Esc` volta ao terminal.
  - Sessão focada: `Enter` abre, `F2` renomeia, `Delete` fecha, `Alt+↑` / `Alt+↓` reordena (e, na borda de um grupo, leva a sessão para fora dele ou para o vizinho), `Ctrl+Espaço` marca ou desmarca para enviar um prompt a várias (como o `Ctrl+clique`).
  - Cabeçalho de grupo focado: `Enter` recolhe ou abre, `F2` renomeia, `Alt+↑` / `Alt+↓` muda o grupo de lugar, `Delete` desfaz o grupo (as sessões ficam). `Tab` chega aos botões do cabeçalho (nova sessão no grupo, editar).
- **Painel de mudanças** (`Ctrl+Shift+G`): na lista, `↑` / `↓` escolhe o arquivo, `Espaço` marca ou desmarca para o commit, `Delete` descarta as mudanças do arquivo (com a pergunta de sempre), `Enter` leva ao editor e `Ctrl+Enter` à mensagem do commit, onde `Ctrl+Enter` faz o commit. `F6` / `Shift+F6` passam entre a lista, o editor e a mensagem do commit. `Esc` fecha o painel.
- **Terminal auxiliar**: o mesmo `Ctrl+Shift+"` abre, vai para ele e fecha; `Ctrl+Shift+T` volta ao terminal do agente. Na paleta, "Terminal auxiliar: aumentar" e "diminuir" mudam o tamanho; com a divisória focada, as setas também.
- **Painel geral** (`Ctrl+Shift+O`): as setas andam pelos cartões, `Enter` abre a sessão, `Esc` volta ao terminal. `Tab` chega ao filtro, ao "Ordenar por atenção" e aos botões ✓/✕ de um pedido de permissão.
- **Paleta** (`Ctrl+Shift+P`): grupos (novo, editar, mover a sessão), prompts, temas do código e tudo o que tem atalho.

Também dá para arrastar sessões e grupos com o mouse.

Cada prompt guardado pode ter o seu atalho, em **Preferências → Prompts**, com as mesmas regras.

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
- **O painel de mudanças faz pouco no git, de propósito.** Marca para o commit, faz commit e descarta um arquivo por vez. Não há push, pull, branch, merge, stash, `--amend`, stage de trechos nem "descartar tudo"; para isso, use o git ou peça ao agente. É mais seguro editar e operar com o agente parado. Fora do painel, o app só cria e remove as [cópias isoladas](#cópia-isolada-git-worktree) e a branch nova de cada uma, e guarda os [checkpoints](#linha-do-tempo-e-checkpoints) em refs próprias; nunca faz push nem apaga uma branch.
- **O painel de mudanças exige git**, instalado e com a pasta da sessão dentro de um repositório. Sem isso, ele explica o que falta.
- **"Aguardando você" não é infalível.** Ver "Possivelmente aguardando" acima.
- **Só Claude Code e Codex.** Sem outras IAs, SSH ou macOS. Um shell comum só existe como o [terminal auxiliar](#terminal-auxiliar) de uma sessão: um por sessão, sem abas nem divisão livre da tela. O comando de uma sessão pode ser trocado, mas o agente por trás dele tem que ser um dos dois.
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
