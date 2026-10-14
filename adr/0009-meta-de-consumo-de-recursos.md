# 0009 — Meta de consumo de recursos

- **Status:** Aceita (confirmada em 2026-10-12, com a ressalva de que o app precisa ser leve: 450 MB é teto, não alvo)
- **Data:** 2026-10-12
- **Revisão:** 2026-10-12, meta ajustada de 300 MB para 450 MB após a [ADR 0010](0010-shell-do-app-electron.md)
- **Revisão:** 2026-10-13, primeiras medições incluídas. A primeira medição estourava o teto com o painel de diff aberto; por decisão do dono do produto (item 4.5 de [`DECISOES-E-RISCOS.md`](../DECISOES-E-RISCOS.md)) a GPU passou a rodar dentro do processo principal, com um modo seguro automático, e **a meta é cumprida no Windows**

## Contexto

O consumo de recursos é uma das dores que motivaram o produto. Sem um número, "leve" vira opinião e não há como saber se uma mudança piorou as coisas.

O grosso do consumo vem dos agentes e das várias janelas de terminal e IDE abertas hoje, não do shell do app. O ganho do produto está em trocar essas janelas por uma só e em deixar visível quem está pesando.

## Decisão

- **Meta:** até **450 MB de RAM** do app com 10 sessões abertas, somando todos os processos do Electron e sem contar os processos dos agentes.
- Medir com 1, 5 e 10 sessões (tarefa 5.4), começando cedo para ter uma linha de base.
- Técnicas adotadas:
  - Um único renderer para todas as sessões.
  - Desmontar o terminal visual das sessões não visíveis, mantendo o histórico no processo principal.
  - Limite de scrollback por sessão.
  - Throttle de saída em sessões em segundo plano.
  - Monaco carregado sob demanda e descartado ao fechar o painel.
- Exibir CPU e RAM por sessão (árvore de processos), para o usuário ver qual agente está pesando.

## Medições

Feitas em 2026-10-13 com `npm run measure` (tarefas 0.6 e 5.4). O script soma a memória de todos os processos do app (principal, renderer, GPU e utilitário), sem os agentes, e grava o resultado em `tools/memory/results/`.

### Windows 10, app empacotado

Working set somado. "Antes" é a primeira medição, com a GPU em um processo próprio; "depois" é o app como está, com a GPU no processo principal.

| Cenário | Antes | Depois |
|---|---|---|
| App vazio | 310 MB | **255 MB** |
| 1 sessão | 354 MB | **298 MB** |
| 5 sessões | 405 MB | **350 MB** |
| 10 sessões | 446 MB | **396 MB** |
| 10 sessões, painel de diff aberto | 480 MB | **426 MB** |
| 10 sessões, painel fechado | 473 MB | 423 MB |
| 10 sessões, painel fechado, após coleta de lixo | 463 MB | 408 MB |

Os private bytes ficam em 152 MB com o app vazio e 507 MB com 10 sessões, nos dois arranjos: é memória reservada, nem toda em uso, e o teto é comparado com o working set.

As sessões rodavam um shell. Com **agentes reais ociosos** (5 Claude Code e 5 Codex) a medição "antes" deu os mesmos números dentro da margem: 442 MB com 10 sessões e 464 MB com o painel aberto. A medição "depois" não foi repetida com agentes reais.

### Linux (Docker, .deb instalado, display virtual)

| Cenário | RSS somado, antes | Depois |
|---|---|---|
| App vazio | 463 MB | cerca de 400 MB |
| 1 sessão | 492 MB | 432 MB |
| 10 sessões | 508 MB | 449 MB |
| 10 sessões, painel de diff aberto | 594 MB | 517 MB |
| 10 sessões, painel fechado, após coleta de lixo | 536 MB | 493 MB |

Este número **não é comparável** ao do Windows nem representa uma máquina real, por dois motivos: no Linux o Electron só informa o RSS, que conta em cada processo as páginas compartilhadas do mesmo binário; e sem placa de vídeo o processo de GPU renderiza por software. A medição que vale para o Linux é a da máquina real (tarefa 6.3).

### Comparação com o teto

- **Windows, 10 sessões:** 396 MB. Dentro do teto, com 54 MB de folga.
- **Windows, 10 sessões e painel de diff aberto:** 426 MB. Dentro do teto.
- **Linux:** sem número confiável ainda. No Docker, 449 MB com 10 sessões e 517 MB com o painel aberto, com as ressalvas acima.
- **Modo seguro** (ver abaixo): volta aos números da coluna "antes", ou seja, 480 MB no pior caso do Windows.

### Quem pesa

1. **A base do Electron: 255 MB com o app vazio** (310 MB antes de a GPU ir para o processo principal). É mais da metade do teto antes de abrir a primeira sessão: em números redondos, processo principal com a GPU 130 MB, renderer 85 MB, utilitário de rede 45 MB. A estimativa que originou os 450 MB supunha uma base menor.
2. **No Windows, cada sessão custa cerca de 9 MB no processo principal.** Vem do node-pty, que cria uma thread com um interpretador próprio por terminal para ler a saída do ConPTY. Dez sessões são 90 MB. No Linux esse custo não existe: de 1 para 10 sessões o app cresce 16 MB.
3. **O histórico de cada sessão:** até 2,5 MB por sessão com as 1000 linhas cheias (medido: 5 MB com 2000). O padrão foi fixado em 1000 linhas por isso.
4. **O Monaco: cerca de 30 MB enquanto o painel está aberto.** Ele roda em um iframe que é destruído ao fechar o painel. Pelos private bytes a memória volta (432 MB depois, contra 520 MB antes de abrir); pelo working set sobram cerca de 20 MB até o sistema recolher as páginas.

As técnicas da decisão estão todas implementadas e funcionando: com 10 sessões só 3 terminais visuais existem, e o renderer não cresce de 5 para 10 sessões.

### GPU no processo principal, com modo seguro

Decidido em 2026-10-13 pelo dono do produto, para cumprir o teto sem mudá-lo: o app abre com `--in-process-gpu`, e o trabalho de GPU roda dentro do processo principal em vez de em um processo próprio. Economiza cerca de 55 MB.

O custo é conhecido: uma falha do driver de vídeo passa a derrubar o app inteiro, e com ele os agentes abertos. Para que isso não vire um app que não abre mais, há um **modo seguro automático** (`src/core/store/gpuGuard.ts`):

- Ao abrir no modo rápido, o app grava um marcador. Ele só é apagado depois que a janela carrega e fica 5 segundos de pé.
- Se o app morrer antes disso, o marcador continua lá, e a abertura seguinte é em modo seguro: GPU de volta ao processo próprio e aceleração por hardware desligada.
- Uma falha de GPU ou do renderer durante o uso leva ao mesmo modo seguro a partir da abertura seguinte.
- O modo seguro vale até a próxima versão do app, que tenta o modo rápido de novo.

**Máquina sem placa de vídeo não é o caso de risco:** sem GPU o Chromium desenha por software, nos dois modos. Os testes em Docker rodam assim, sem nenhuma GPU, com o modo rápido ligado, e passam. O risco é um driver que existe e falha.

O que **não** está coberto: a primeira falha em si. Se o driver cair no meio do uso, aquela execução do app cai, e os agentes que estavam rodando são encerrados; a proteção vale da abertura seguinte em diante. E a proteção foi testada simulando o marcador de uma abertura que falhou, não com um driver defeituoso de verdade.

### O que foi testado e não adotado

- `--disable-gpu`: sem ganho quando há um terminal aberto.
- Serviço de rede dentro do processo principal: sem efeito nesta versão do Electron.

## Alternativas consideradas

- **Sem meta numérica.** Não permite detectar regressão.
- **Limitar os recursos dos agentes (cgroups, Job Objects).** Poderia quebrar o agente no meio de uma tarefa; o v1 apenas mostra o consumo.
- **Uma janela ou um renderer por sessão.** Isolamento melhor, mas multiplica a memória.

## Consequências

- Uma única janela e um único renderer para todas as sessões.
- Trocar de sessão remonta o terminal a partir do histórico, com um pequeno custo de redesenho.
- O número medido entra no README e serve de argumento do produto.

## Riscos e mitigação

| Risco | Mitigação |
|---|---|
| A meta é uma estimativa sem medição e pode estar errada para mais ou para menos | Medir no M1 com o primeiro terminal funcionando e corrigir o número nesta ADR |
| O grosso do consumo vir dos agentes, fora do controle do app | Indicador por sessão deixa isso visível para o usuário |
| Remontar o terminal causar atraso perceptível ao trocar de sessão | Medir o tempo de troca; manter montadas as últimas sessões usadas |
| Regressão silenciosa de memória ao longo do desenvolvimento | Repetir a medição da tarefa 5.4 a cada marco |
