# Decisões e riscos que precisam da sua atenção

Resumo, em linguagem direta, de tudo no plano do v1 que depende de você ou que você precisa saber antes de começar. Os detalhes técnicos estão nas ADRs em [`adr/`](adr/README.md); este arquivo existe para você não precisar lê-las para entender o que está em jogo.

Está dividido em quatro partes:

1. **Decisões em aberto**: ninguém decidiu ainda; o trabalho depende da sua resposta.
2. **Decisões que tomei por você**: estão marcadas como aceitas nas ADRs, mas têm efeito direto no produto. Confirme ou conteste.
3. **Riscos**: não pedem decisão agora, mas você deve saber que existem.
4. **Decisões já fechadas**: histórico do que você já resolveu.

---

## 1. Decisões em aberto

### 1.1 Qual sinal o app usa para saber o estado do Codex

- [ ] Decidido

**Do que se trata.** Os testes interativos de 2026-10-12 mostraram que o Codex oferece três sinais, e todos funcionam. A dúvida é qual deles é o principal.

| Sinal | O que entrega | Exige do usuário | Ponto fraco |
|---|---|---|---|
| Título da janela | Trabalhando, pedindo permissão ("Action Required") e parado | Nada | Não é documentado; pode mudar numa atualização do Codex |
| Hooks confiados (item 4.4) | Pedido de permissão e início de sessão, com detalhes | Confiar uma vez, numa tela do próprio Codex | Passo manual; a confiança cai se o app mudar o script de lugar |
| Aviso de fim de turno (`notify`) | Só "terminou" | Nada | Dispara um aviso falso uns 3 s depois do primeiro pedido; precisa de filtro |

**Possibilidades.**

- **1. Título como principal, hooks como reforço opcional.** Funciona desde a primeira sessão sem o usuário fazer nada. Quem confiar nos hooks ganha a confirmação dupla.
- **2. Hooks como principal, título como reserva.** É o item 4.4 como está: mais robusto a mudanças do Codex, mas com o passo manual, e o título cobre quem não confiou.
- **3. Só título e `notify`, sem hooks.** O mais simples de construir e sem nenhuma tela de confiança, mas todo o aviso de "tem dúvida" fica dependendo de um comportamento não documentado.

**Minha recomendação.** A 1: o usuário não precisa fazer nada para o aviso funcionar, e os hooks continuam disponíveis como proteção caso o título mude.

**Bloqueia:** o M3. Detalhes: [ADR 0011](adr/0011-perfis-de-agente.md).

**Situação em 2026-10-13.** O M3 foi implementado com a **opção 1**, a recomendada, para não ficar parado. Os três sinais existem e foram testados com o Codex real; o que esta decisão muda é só qual deles vence quando discordam. Trocar para a opção 2 é inverter dois números no perfil do Codex (`src/core/agents/profiles.ts`); a opção 3 é desligar os hooks no mesmo arquivo. Falta apenas o seu "de acordo", ou a troca.

---

## 2. Decisões que tomei por você

Cada uma destas muda o que o usuário vai viver no produto. Se discordar de alguma, avise e a ADR correspondente é revista.

### 2.1 Fechar o app encerra todos os agentes

- [ ] Concordo

Os agentes rodam "dentro" do app. Se você fechar a janela, todos param, mesmo no meio de uma tarefa. Ao reabrir, as sessões aparecem com nome e pasta, mas paradas.

**Por quê.** Manter os agentes vivos exigiria um programa residente em segundo plano, o que aumenta o consumo e quase dobra a complexidade do v1.

**Proteção prevista.** O app pede confirmação antes de fechar se houver agente rodando. Detalhes: [ADR 0006](adr/0006-persistencia-json-sem-daemon.md).

### 2.2 "See changes" mostra e deixa editar, mas não mexe no git

- [x] Revista por você em 2026-10-13

A versão original desta decisão era "só mostra, não desfaz". Você pediu que a pessoa também possa editar, e ela foi revista:

- O painel lista os arquivos alterados e mostra o antes e depois.
- O lado direito, que é o arquivo como está na pasta, **pode ser editado e salvo** (`Ctrl+S`). Uma seta entre os dois lados desfaz um trecho.
- O painel continua **sem operações de git**: não tem "stage", "commit" nem "descartar tudo". Ele só grava o arquivo que você editou.

**O cuidado que veio junto.** Você e o agente podem escrever no mesmo arquivo. Se o arquivo mudar no disco enquanto você edita, o app não grava por cima: avisa e pergunta se você quer recarregar ou sobrescrever. Edições não salvas não se perdem em silêncio ao trocar de arquivo ou fechar o painel.

Detalhes: [ADR 0012](adr/0012-see-changes-permite-editar.md), que emenda a [ADR 0004](adr/0004-diff-monaco-e-git-cli.md).

### 2.3 "See changes" só funciona em pastas com git

- [ ] Concordo

Se o agente estiver trabalhando em uma pasta que não é um repositório git, o painel mostra um aviso em vez das mudanças. O git também precisa estar instalado na máquina.

**Por quê.** O git já sabe exatamente o que mudou. Construir essa comparação do zero para pastas comuns é um projeto à parte. Detalhes: [ADR 0004](adr/0004-diff-monaco-e-git-cli.md).

### 2.4 O que ficou de fora do v1

- [ ] Concordo

- macOS
- Outras IAs além de Claude Code e Codex e terminal comum (decisão sua, item 4.3). O comando personalizado entrou depois, restrito aos dois agentes ([ADR 0013](adr/0013-comando-do-usuario-no-lugar-do-agente.md))
- Sessões em outras máquinas (SSH)
- Dividir a tela em vários terminais lado a lado
- Um agente coordenando outros
- Sessões que continuam após fechar o app (item 2.1)
- Operações de git no painel de mudanças: stage, commit, descartar tudo (item 2.2)

Se algum destes for indispensável para você, o prazo muda. Detalhes: [ADR 0007](adr/0007-escopo-do-v1.md).

### 2.5 O que é cortado primeiro se o prazo apertar

- [ ] Concordo

1. Ver as mudanças "desde que a sessão começou". Sobra a comparação com o último commit.
2. O indicador de CPU e memória por sessão.

Detalhes: [ADR 0007](adr/0007-escopo-do-v1.md).

---

## 3. Riscos para você ter consciência

### 3.1 O aviso de "tem dúvida" não será 100% confiável

**Gravidade: alta.** É o maior risco do produto.

Um terminal não sabe o que o programa dentro dele está "pensando". O app usa três fontes de informação:

- **Avisos do próprio agente**: precisos. Nos dois agentes, "terminou" e "tem dúvida" foram testados no Windows e funcionam (no Codex, ver decisão 1.1). No Linux nada foi testado.
- **Sinais que o agente manda ao terminal**: bons, quando o agente os envia.
- **Silêncio**: se o agente parou de escrever há alguns segundos, o app supõe que ele pode estar esperando.

**Situação em 2026-10-13.** No Windows, as duas primeiras fontes funcionam nos dois agentes rodando dentro do app: pedido de permissão vira "aguardando você" no mesmo segundo e o fim do turno vira "terminou". No Linux o mecanismo foi testado com um agente simulado, mas não com os agentes reais.

A terceira fonte erra. Um build longo e silencioso parece igual a um agente esperando resposta. Enquanto o aviso de "tem dúvida" não estiver confirmado para um agente, ele aparece como "possivelmente aguardando", e o usuário vai receber alarmes falsos de vez em quando. Detalhes: [ADR 0005](adr/0005-deteccao-de-estado-em-tres-camadas.md).

### 3.2 O app em si consome mais memória com Electron

**Gravidade: média.** Consequência direta da escolha do item 4.1.

O Electron embarca um navegador inteiro. A estimativa é de uns 100 MB a mais do que a alternativa descartada, e um instalador em torno de 100 MB. Perto dos agentes, que consomem alguns GB juntos, é pouco, mas o app não vai ser "minúsculo". O ganho de recursos vem de substituir várias janelas por uma e de mostrar qual agente está pesando. Detalhes: [ADR 0010](adr/0010-shell-do-app-electron.md).

### 3.3 A biblioteca de terminal precisa ser compilada para cada sistema

**Gravidade: média.**

A peça que cria os terminais (node-pty) não é JavaScript puro: tem uma parte nativa que precisa ser gerada para Windows e para Linux, e de novo a cada troca de versão do Electron. Isso costuma dar trabalho na montagem do build e do instalador, não no código do dia a dia. Fica resolvido uma vez, no M0 e no M6. Detalhes: [ADR 0010](adr/0010-shell-do-app-electron.md).

**Situação em 2026-10-13: não se materializou.** O app empacotado abre terminais nos dois sistemas. No Windows a parte nativa já vem pronta no pacote; no Linux ela é compilada na instalação das dependências, e a máquina de build precisa de um compilador.

### 3.4 O terminal do Windows se comporta diferente

**Gravidade: média.**

O mecanismo de terminal do Windows trata redimensionamento de janela e alguns comandos de tela de forma diferente do Linux. Agentes com interface elaborada, como o Claude Code, podem apresentar falhas visuais em um sistema e não no outro. Por isso os testes com agentes reais começam já no M1. Detalhes: [ADR 0002](adr/0002-terminal-xterm-e-node-pty.md).

### 3.5 Agentes "órfãos" consumindo a máquina

**Gravidade: média.** Atinge direto a dor de consumo.

Um agente costuma abrir outros programas (servidores, builds, testes). Se o app fechar a sessão e não encerrar também esses programas, eles continuam rodando escondidos. Há uma tarefa dedicada a isso (1.4), com teste automático. Detalhes: [ADR 0002](adr/0002-terminal-xterm-e-node-pty.md).

### 3.6 Um app que executa comandos precisa de cuidado com segurança

**Gravidade: média.**

Por natureza, o app roda qualquer comando na sua máquina. Em Electron, um descuido na separação entre a interface e a parte que executa comandos pode dar esse poder a conteúdo que não deveria tê-lo. As proteções padrão do Electron ficam ligadas desde o início e o app não carrega nada da internet. Detalhes: [ADR 0010](adr/0010-shell-do-app-electron.md).

Com as **verificações ao fim do turno**, o app também roda, sozinho, os comandos de verificação que você salvou para uma pasta (`npm test`, por exemplo), sempre que o agente termina um turno que mudou arquivos. Esses comandos rodam código do projeto. Por isso só rodam os que você salvou, nunca os que o app apenas sugere, e eles ficam fora do arquivo de exportação das preferências: importar configurações não traz comandos. Detalhes: [ADR 0014](adr/0014-verificacoes-ao-fim-do-turno.md).

### 3.7 O teste em Linux na sua máquina não cobre tudo

**Gravidade: baixa.**

Docker e WSL resolvem o dia a dia, mas as notificações do sistema não aparecem de forma confiável no WSL. Você tem outro Linux disponível, então a validação final está coberta; falta só reservar esse teste antes do lançamento. Detalhes: [ADR 0008](adr/0008-teste-em-linux-docker-e-wsl2.md).

### 3.8 Segredos gravados em arquivo

**Gravidade: baixa.**

O app salva em um arquivo de texto o comando de cada sessão. Se alguém digitar uma senha ou chave de API direto no comando, ela fica gravada em texto puro. O app não salva o histórico do terminal justamente para reduzir esse risco. Detalhes: [ADR 0006](adr/0006-persistencia-json-sem-daemon.md).

### 3.9 O prazo é uma estimativa

**Gravidade: média.**

Com o plano detalhado em [`PLANO.md`](PLANO.md), a estimativa subiu: 12 a 15 semanas para uma pessoa em dedicação integral que conheça TypeScript, 7 a 9 com duas e 5 a 6 com três. O primeiro número que dei, 6 a 8 semanas, era de um esboço com menos tarefas. Não há histórico de velocidade do time para calibrar. Os itens 3.1 e 3.3 são os que mais podem atrasar.

---

## 4. Decisões já fechadas

### 4.1 Electron no lugar de Tauri (2026-10-12)

A tecnologia que "embrulha" o app em uma janela desktop é o **Electron**, com todo o código em TypeScript.

**Motivo.** O time conhece apenas JS/TS; Rust complicaria o desenvolvimento e a manutenção. A escolha inicial tinha sido Tauri, pela memória, mas a diferença estimada é de cerca de 100 MB.

**O que foi aceito com isso.** Os riscos 3.2, 3.3 e 3.6. Em troca, saiu da lista o risco de o Linux se comportar diferente do Windows na interface. Detalhes: [ADR 0010](adr/0010-shell-do-app-electron.md), que substitui a [ADR 0001](adr/0001-shell-do-app-tauri-2.md).

### 4.2 Meta de memória: 450 MB com 10 sessões (2026-10-12)

O app deve usar até 450 MB de RAM com 10 sessões abertas, contando só o app e não os agentes rodando dentro dele.

**Condição dada por você.** O app tem que ser leve; o número é um teto, não um alvo. Ele é uma estimativa ainda sem medição e será corrigido com a medição real no M1. Detalhes: [ADR 0009](adr/0009-meta-de-consumo-de-recursos.md).

### 4.3 O usuário escolhe a IA de cada sessão, e o app não mexe na configuração dela (2026-10-12)

Ao criar uma sessão, o usuário escolhe o perfil: **Claude Code ou Codex**. Não há outras IAs nem shell puro no v1. Desde 2026-10-13 a sessão pode rodar um comando do usuário no lugar do executável do agente, para que aliases e funções do shell dele valham ([ADR 0013](adr/0013-comando-do-usuario-no-lugar-do-agente.md)); o perfil continua sendo escolhido. O app abre o agente já com os avisos ligados por parâmetro, sem alterar nenhum arquivo do usuário ou do agente.

**O que foi testado com o Codex (0.158.0, Windows).**

- Aviso de "terminou" por parâmetro: funciona.
- O app consegue saber de qual sessão veio o aviso: funciona.
- Hooks por parâmetro: só executam se forem confiados (item 4.4).
- Aviso de "tem dúvida": funciona de duas formas, pelo título da janela e por hook confiado (decisão 1.1).

**O que foi testado com o Claude Code (2.1.296, Windows).**

- Hooks passados por parâmetro: funcionam, sem nenhuma tela de confiança.
- Aviso de "terminou" e de "tem dúvida": os dois funcionam por hook.
- O título da janela do Claude Code não distingue "terminou" de "pedindo permissão".

**O que ainda não foi testado.** Os dois perfis no Linux.

Detalhes: [ADR 0011](adr/0011-perfis-de-agente.md).

### 4.4 No Codex, o usuário confia no hook do app uma vez (2026-10-12)

O Codex só executa hooks que o usuário marcou como confiáveis. Para o aviso de "tem dúvida", o usuário confirma essa confiança uma vez, pelo próprio Codex. O app nunca abre o Codex pulando essa checagem.

**O que foi aceito com isso.**

- Há um passo manual por máquina na primeira vez que se usa o Codex pelo app.
- Até o usuário confiar, "terminou" funciona normalmente e "tem dúvida" aparece como "possivelmente aguardando".
- Os dois testes que faltavam foram feitos em 2026-10-12 e passaram: o Codex mostra uma tela "Hooks need review" para os hooks do app, e depois de confiado avisa no momento em que pede permissão. A confiança vale para as sessões seguintes.
- A confiança fica presa ao texto exato do comando do hook. Se uma atualização do app mudar o script de lugar, o Codex pede confiança de novo.

Detalhes: [ADR 0011](adr/0011-perfis-de-agente.md).

### 4.5 Memória: GPU no processo principal, com modo seguro (2026-10-13)

A primeira medição no Windows deu 446 MB com 10 sessões e 480 MB com o painel de mudanças aberto, acima do teto de 450 MB (item 4.2). Entre manter o teto com uma exceção, subir o teto ou mudar o app, você escolheu mudar o app: o trabalho de vídeo passou a rodar dentro do processo principal.

**Resultado medido.** 255 MB com o app vazio, 396 MB com 10 sessões e 426 MB com o painel aberto. O teto é cumprido no Windows.

**O que foi aceito com isso.** Uma falha do driver de vídeo derruba o app inteiro, e com ele os agentes abertos naquele momento.

**A proteção que você pediu.** Se uma abertura do app não terminar bem, a seguinte é em **modo seguro**: vídeo de volta a um processo separado e sem aceleração. O app continua funcionando, só consome o que consumia antes (até 480 MB). O modo seguro vale até a próxima versão do app. Um computador sem placa de vídeo não trava: nesse caso o desenho é feito por software, e os testes em Docker rodam exatamente assim.

**O que a proteção não faz.** Ela não salva a execução em que o driver falhou: aquela cai, e os agentes dela são encerrados. Ela impede que o app fique sem abrir depois disso. Foi testada simulando uma abertura que falhou, não com um driver defeituoso de verdade.

No Linux ainda falta a medição na máquina real. Detalhes: [ADR 0009](adr/0009-meta-de-consumo-de-recursos.md).

---

## Como usar este arquivo

Marque as caixas conforme for decidindo. Quando uma decisão da parte 1 for fechada, ela desce para a parte 4 e o status da ADR correspondente muda de "Proposta" para "Aceita". Se você discordar de algo da parte 2, a ADR é revista.
