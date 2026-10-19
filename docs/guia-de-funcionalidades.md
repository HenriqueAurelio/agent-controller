# Guia de funcionalidades — Aurelium

> Referência de uso da versão atual. Última revisão: 18 de outubro de 2026.
>
> Versão para navegador: [guia-de-funcionalidades.html](guia-de-funcionalidades.html).

O Aurelium é um aplicativo desktop para centralizar sessões do **Claude Code** e do
**Codex**. Cada sessão é um terminal real: o aplicativo não substitui o agente, mas organiza
várias sessões, mostra o estado delas, ajuda a revisar alterações e coordena etapas do trabalho.

## Sumário

1. [Antes de começar](#antes-de-começar)
2. [Fluxo rápido](#fluxo-rápido)
3. [Sessões, agentes e grupos](#sessões-agentes-e-grupos)
4. [Acompanhar e responder aos agentes](#acompanhar-e-responder-aos-agentes)
5. [Trabalho isolado e coordenação](#trabalho-isolado-e-coordenação)
6. [Revisar e editar código](#revisar-e-editar-código)
7. [Qualidade e recuperação](#qualidade-e-recuperação)
8. [Prompts e automação assistida](#prompts-e-automação-assistida)
9. [Produtividade e preferências](#produtividade-e-preferências)
10. [Limites atuais](#limites-atuais)

## Antes de começar

O aplicativo funciona em Windows e Linux. Instale e autentique pelo menos um destes agentes no
`PATH`:

| Dependência | Uso | Como conferir |
| --- | --- | --- |
| Claude Code | Executar sessões Claude Code | `claude --version` |
| Codex CLI | Executar sessões Codex | `codex --version` |
| Git 2.15+ | Diff, worktrees, checkpoints e operações de git | `git --version` |

No Windows, execute o instalador `agent-controller-<versão>-setup.exe`. No Linux, instale o
pacote `.deb` ou dê permissão de execução ao AppImage. As releases são publicadas no repositório
do projeto. Para desenvolver, use Node 22.12+ e execute `npm ci` seguido de `npm run dev`.

## Fluxo rápido

1. Clique em **+ Nova sessão** (`Ctrl+Shift+N`), escolha uma pasta, dê um nome e selecione
   Claude Code ou Codex.
2. Clique em **Criar e iniciar** e escreva normalmente no terminal do agente.
3. Acompanhe a bolinha de estado; quando ela indicar **Aguardando você**, responda no terminal ou
   use a barra lateral para permissões.
4. Abra **Ver mudanças** (`Ctrl+Shift+G`) para revisar o diff, editar arquivos e preparar um
   commit.
5. Configure **Verificações** para executar lint, testes e typecheck ao fim dos turnos.
6. Use uma cópia isolada, checkpoints, revisor ou fluxos quando o trabalho envolver mais de um
   agente ou exigir revisão adicional.

## Sessões, agentes e grupos

### Criar, abrir e organizar sessões

- **Nova sessão:** escolha pasta, nome, agente e, opcionalmente, um grupo e uma cópia isolada.
  Pastas recentes aparecem no formulário; use a estrela para salvá-las como favoritas.
- **Arrastar uma pasta:** solte uma pasta (ou um arquivo) na janela para abrir o mesmo formulário
  já preenchido com a pasta correspondente.
- **Duplicar:** o botão **⧉** ou a paleta cria outra sessão com a mesma pasta, agente e comando.
- **Trocar pasta:** clique no caminho no topo da sessão ou use a paleta. Se o agente estiver em
  execução, ele é reiniciado; a conversa em curso não é migrada.
- **Parar e iniciar:** para encerrar sem fechar a sessão, use **Parar o agente** na paleta ou
  `/exit` no agente. Uma sessão parada inicia ao ser aberta; depois que o agente sai, `Enter` no
  terminal o inicia novamente.

### Comando personalizado do agente

O campo **Comando** de uma nova sessão permite usar aliases, funções e argumentos, como
`claude-work --model opus`. Em **Preferências → Agentes**, há um comando padrão para cada agente.
O comando roda no shell interativo do usuário (PowerShell no Windows; `$SHELL` no Linux).

O perfil selecionado continua determinando como o estado é lido; portanto, não execute Codex em
uma sessão identificada como Claude Code. Funções devem encaminhar os argumentos recebidos
(`@args` no PowerShell, `"$@"` no bash), ou os avisos passam a ser apenas estimados. Aliases de
`cmd.exe` (`doskey`) não funcionam, pois o comando usa PowerShell.

### Grupos

Grupos organizam sessões por repositório ou contexto. Crie-os pelo botão **⊞** da barra lateral ou
pela paleta. Arraste sessões para dentro ou para fora do grupo; o botão **+** do cabeçalho cria uma
sessão já pertencente a ele. Clique no cabeçalho para recolher, clique duas vezes (ou use `F2`)
para renomear e use **×** para desfazer o grupo sem fechar suas sessões.

`Alt+↑` e `Alt+↓` reordenam sessões e grupos, inclusive movendo uma sessão entre grupos. Grupos
e seu estado recolhido são restaurados ao abrir o app.

## Acompanhar e responder aos agentes

### Estados, avisos e painel geral

| Estado | O que significa | Próxima ação típica |
| --- | --- | --- |
| Parada | O agente não está executando | Abra a sessão ou pressione `Enter` no terminal |
| Iniciando | O processo abriu, mas o prompt ainda não apareceu | Aguarde |
| Trabalhando | O agente está em um turno | Acompanhe ou deixe os avisos ativos |
| Aguardando você | Há uma pergunta, permissão ou prompt esperando | Abra ou responda à solicitação |
| Terminou | O turno acabou | Revise, execute verificações ou envie o próximo passo |
| Erro | O agente saiu ou não abriu | Leia o terminal para identificar o motivo |

Uma bolinha cheia é um estado informado pelo agente. Uma bolinha tracejada com
**Possivelmente aguardando você** é uma inferência após um período sem saída; o intervalo pode ser
alterado ou desligado nas preferências.

O app avisa pelo sistema quando uma sessão em segundo plano termina ou precisa de você e exibe a
quantidade de sessões aguardando no título da janela. Em **Preferências** (`Ctrl+,`), configure
tipo de aviso e som.

Para uma visão simultânea, abra o **Painel geral** (`Ctrl+Shift+O`). Ele mostra cartões por grupo,
estado, últimas seis linhas úteis do terminal, branch, arquivos alterados, verificações, fila e
conflitos. Filtre por todas, aguardando ou trabalhando, e ordene por atenção. Setas navegam pelos
cartões, `Enter` abre a sessão e `Esc` retorna ao terminal.

### Permissões sem abrir a sessão

Quando o agente exibe um menu de permissão, a barra lateral mostra a ferramenta e o alvo, com
**✓** para permitir, **✕** para negar e, quando o agente oferecer, **sempre**. Na sessão ativa,
`Alt+Y` permite e `Alt+N` nega. No Windows, esses controles também aparecem na notificação.

O aplicativo só responde a menus de permissão ainda visíveis; se o pedido mudar, nada é enviado.
Perguntas abertas do agente continuam exigindo o terminal. Para ler o terminal antes de decidir,
desligue essa resposta rápida em **Preferências → Geral**. No Codex, o recurso depende de confiar
nos hooks quando o próprio agente solicitar essa confiança.

## Trabalho isolado e coordenação

### Cópia isolada (git worktree) e conflitos

Em uma pasta git, marque **Cópia isolada (git worktree)** ao criar uma sessão. Defina a branch
(a sugestão é `ac/<nome-da-sessão>`) e a base. O app cria uma pasta de trabalho e uma branch
próprias em `~/.agent-controller/worktrees/<repositório>/<branch>`; repositório e histórico são
compartilhados, mas os arquivos de cada agente ficam separados.

Ao fechar a sessão, escolha manter ou remover a cópia. A remoção só é possível sem alterações não
commitadas e quando nenhuma outra sessão a usa; a branch nunca é apagada. Em
**Preferências → Sessões**, ajuste a pasta de worktrees, um comando de preparo (por exemplo,
`npm ci`) e gerencie cópias sem uso.

O app também compara alterações entre cópias e a pasta original. **⚠ n** indica arquivos que outra
sessão também alterou; vermelho significa que as linhas se sobrepõem ou encostam e há provável
conflito de merge. Configure a análise, sessões paradas e padrões ignorados em
**Preferências → Sessões → Conflito entre sessões**.

### Quadro de tarefas

Abra com `Ctrl+Shift+B`. Há um quadro por repositório git, com cartões em **A fazer**, **Em
andamento**, **Precisa de você**, **Revisar** e **Feito**. Crie um cartão com título, descrição,
agente, grupo e, se necessário, worktree; colar várias linhas no título cria até 50 cartões.

**Iniciar** cria a sessão e envia a descrição quando o agente estiver pronto. É possível selecionar
até quatro cartões e iniciá-los juntos. As colunas centrais acompanham o estado automaticamente;
arraste cartões em A fazer/Feito para ordenar ou mudar sua situação. Marcar como feito trata a
sessão e a cópia como no fechamento normal. Quando uma branch entra na base, o cartão também é
reconhecido como concluído.

### Experimentos (melhor de N)

Use **Novo experimento (melhor de N)** no cabeçalho da lista ou na paleta para executar o mesmo
pedido de uma a quatro vezes. Escolha a pasta git, a base, o texto e um agente/comando para cada
tentativa. O app cria um grupo, worktrees e branches próprias (`ac/<nome>-1`, etc.) e envia o
pedido assim que cada agente fica pronto.

O botão **⇄** do grupo abre a comparação: estado, verificações, arquivos, linhas adicionadas e
removidas e tempo de cada tentativa, além de diffs lado a lado por arquivo. **Ficar com esta**
fecha as demais e tenta remover suas cópias; branches são preservadas para você administrar.

### Revisor automático e fluxos

Em uma sessão git com checkpoints ligados, clique em **Revisor**. Escolha uma sessão existente ou
crie uma nova em modo de leitura. Ela recebe o diff do turno em arquivo e grava as observações em
um arquivo de retorno; quando a revisão estiver pronta, marque os itens úteis e use **Devolver ao
agente** para abrir um prompt editável. O app nunca devolve a revisão sem sua confirmação.

No cabeçalho de um grupo, **⇢** abre **Fluxos** entre sessões. Uma regra define origem, evento
(fim de turno, verificações ou arquivo de retorno), destino, mensagem, aprovação e limite de
voltas. Use os modelos **Autor e revisor** ou **Plano → implementação → revisão** como ponto de
partida. Os envios entram na fila do destino e, por padrão, ficam preparados para sua aprovação.
O fluxo pausa ao encontrar uma permissão/pergunta ou ao atingir o limite; o histórico explica cada
envio preparado, enviado ou descartado.

## Revisar e editar código

### Painel de mudanças e git

Abra **Ver mudanças** com `Ctrl+Shift+G`. O painel lista arquivos adicionados, modificados,
removidos, renomeados e não rastreados, agrupados por pasta, e mostra o diff lado a lado ou em
linha. Em **Comparar com**, escolha o último commit, o início da sessão ou o turno anterior.

O lado atual do diff é editável: salve com `Ctrl+S`; se o agente mudar o arquivo durante sua
edição, o app pede que você escolha entre recarregar ou sobrescrever. O painel aplica realce de
sintaxe TextMate/VS Code, permite mudar a linguagem daquele arquivo e reduz o realce em arquivos
muito grandes.

Com comparação ao último commit, você pode:

- marcar arquivos (ou partes) para *stage*;
- informar a mensagem e criar o commit com **Commit** ou `Ctrl+Enter`;
- descartar um arquivo com **↺**, após confirmação;
- usar **Desfazer** para recuperar um descarte, enquanto o arquivo não tiver mudado de novo.

O app não faz push nem `--amend`. Commits e descartes pedem confirmação adicional se o agente
estiver trabalhando, e são interrompidos se o git estiver ocupado. Arquivos descartados ficam em
`~/.agent-controller/descartados/` por 30 dias.

### Arquivos, links e abertura rápida

**Todos os arquivos** ou `Ctrl+Shift+E` abre uma árvore da pasta, mesmo fora de git. Pastas são
lidas sob demanda; setas navegam, `→`/`←` expandem ou recolhem e `Enter` abre o arquivo no editor.
**Ocultos** (`Ctrl+Shift+H`) inclui dotfiles e itens ignorados pelo git, exibidos de forma discreta.

No terminal do agente, no auxiliar e na saída de verificações, `Ctrl+clique` em um caminho válido
dentro da pasta abre o arquivo e a linha no painel. O mesmo gesto em `http://`, `https://` ou
`localhost` abre o navegador.

`Ctrl+P` abre a busca aproximada em todos os arquivos da sessão: por exemplo, `sesmgr` encontra
`SessionManager.ts`. Acrescente `:42` ou `:42:7` para ir a linha e coluna. Com a busca vazia,
aparecem arquivos recentes e modificados. Por padrão o atalho não captura o `Ctrl+P` do terminal;
ative essa opção em **Preferências → Geral** se quiser que ele funcione ali também.

## Qualidade e recuperação

### Verificações e painel Problemas

Abra **Verificações** no topo da sessão. Em projetos com `package.json`, o app sugere scripts como
`lint`, `typecheck`, `check` e `test`; eles só executam depois que você os salva. Para cada um,
defina nome, comando, prazo e se roda no fim do turno.

As verificações configuradas executam no shell, uma após a outra, quando um turno altera arquivos;
use **Rodar agora** para uma execução manual. Há no máximo duas sessões verificando em paralelo.
O resultado mostra sucesso, falha, espera ou cancelamento; se uma falhar, **Mandar o erro ao
agente** preenche o prompt para sua conferência.

A aba **Problemas** do painel de mudanças transforma saídas de TypeScript, ESLint, Vitest/Jest,
Cargo e formatos `arquivo:linha:coluna` em erros e avisos clicáveis. Selecione itens e use
**Mandar N marcados** para montar o prompt **Corrigir problemas**. Uma saída não reconhecida fica
disponível inteira abaixo da lista.

### Linha do tempo e checkpoints

Ao fim de um turno que mudou arquivos em um repositório git, o app pode criar uma foto da pasta em
uma ref interna do git. Abra **Linha do tempo** para ver checkpoints, compará-los, visualizar o
diff de um turno e voltar os arquivos a um ponto anterior. Antes de voltar, o app cria uma foto de
segurança e oferece **Desfazer**.

Checkpoint não restaura a conversa do agente. Use **Avisar o agente** depois de voltar arquivos,
se necessário. Em **Preferências → Sessões**, defina se o recurso está ligado, retenção (padrão:
50 por sessão e 7 dias) e faça a poda. Arquivos acima de 2 MB não entram na foto. Não há
checkpoints fora de git nem em uma pasta comum que contém vários repositórios.

## Prompts e automação assistida

### Biblioteca e fila de prompts

Em **Preferências → Prompts**, salve textos reutilizáveis e atalhos. Há prompts de fábrica para
revisar diff, escrever testes, atualizar README, revisar turno e corrigir problemas. Use a paleta,
um atalho, o menu do editor ou **Enviar prompt** para a sessão atual e para várias sessões marcadas
com `Ctrl+clique`.

Os prompts aceitam `{sessao}`, `{pasta}`, `{branch}`, `{arquivo}`, `{selecao}`, `{problemas}` e
perguntas como `{?descrição}`. A prévia mostra o resultado antes do envio. Por padrão o texto é
colado sem Enter; habilite **Enviar com Enter** apenas quando quiser iniciar o turno diretamente.
Se o agente estiver ocupado, o envio espera o fim do turno, salvo se você escolher enviar agora.

Para uma sequência de trabalho, escolha **Pôr na fila**. Cada sessão aceita até 20 itens, enviados
automaticamente quando o turno terminar ou quando as verificações passarem. A fila sempre envia
com Enter. No diálogo **Fila**, reordene, edite, pause, retome, descarte ou envie o próximo item.
Ao reabrir o aplicativo, filas preservadas voltam pausadas. Elas não avançam sozinhas em estados
estimados, perguntas ou permissões.

## Produtividade e preferências

### Terminal auxiliar, layout e interface

Abra o **Terminal auxiliar** com `Ctrl+Shift+"`, pelo botão **Terminal** ou pela paleta. É um shell
independente na pasta da sessão, para comandos, logs ou servidores que não devem interferir no
agente. Ele fica abaixo ou à direita do terminal principal, pode ser fechado pelo mesmo atalho,
`×` ou `exit`, e há apenas um por sessão. `Ctrl+Shift+T` devolve o foco ao terminal do agente.

Em **Preferências → Layout**, posicione a lista de sessões, o painel de mudanças, a árvore de
arquivos e o terminal auxiliar. A prévia mostra a configuração e **Restaurar padrão** a desfaz.

Em **Preferências → Geral**, selecione Português (Brasil), English ou Español. A troca é imediata
e alcança telas, notificações e mensagens do aplicativo; a saída dos agentes não é traduzida.

Em **Preferências → Editor**, selecione temas claros e escuros, importe um tema JSON do VS Code
sem `include` e crie associações de linguagem como `*.mdc = markdown`. O aplicativo inclui 33
temas de código.

### Configurações, atalhos e teclado

**Importar e exportar** em Preferências grava/restaura idioma, avisos, pastas favoritas, comandos
de agente, prompts, temas, layout e atalhos em JSON. Não inclui sessões, verificações por pasta ou
temas importados. Importe somente arquivos confiáveis: comandos de agentes importados podem
executar em sessões futuras.

Atalhos principais:

| Atalho | Ação |
| --- | --- |
| `Ctrl+Shift+N` | Nova sessão |
| `Ctrl+Tab` / `Ctrl+Shift+Tab` | Próxima/anterior sessão |
| `Ctrl+0` e `Ctrl+1`…`Ctrl+9` | Focar a lista / ir à sessão N |
| `Ctrl+Shift+P` | Paleta de comandos |
| `Ctrl+Shift+M` | Enviar prompt |
| `Ctrl+Shift+G` / `Ctrl+Shift+E` | Mudanças / todos os arquivos |
| `Ctrl+P` | Abrir arquivo rápido |
| `Ctrl+Shift+O` / `Ctrl+Shift+B` | Painel geral / quadro de tarefas |
| `Ctrl+,` | Preferências |

Em **Preferências → Atalhos**, cada ação aceita até quatro combinações. Também é possível operar
sessões, grupos, painel de mudanças, quadro, terminal auxiliar e painel geral apenas com teclado;
a paleta reúne ações que não têm atalho próprio.

## Limites atuais

- Apenas Claude Code e Codex são perfis de agente disponíveis; não há SSH, macOS ou outros agentes.
- O app não faz push, merge/rebase para a base, nem abre pull requests.
- Não há continuação automática da conversa ao recriar, trocar a pasta ou restaurar uma sessão.
- O histórico do terminal não é preservado; sessões, pastas, agente e comando são guardados em
  `sessions.json` na pasta de dados do app.
- Buscar no projeto, seguir o arquivo editado pelo agente, histórico/blame do arquivo, tela
  dividida, multibuffer, formatar ao salvar, extensões, comentários no diff e uso/custo ainda são
  propostas, não funcionalidades disponíveis.

Para detalhes de instalação, desenvolvimento e decisões técnicas, consulte o
[README](../README.md), as [decisões e riscos](../DECISOES-E-RISCOS.md) e as
[ADRs](../adr/README.md).
