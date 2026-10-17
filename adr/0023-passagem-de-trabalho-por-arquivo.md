# 0023 — Passagem de trabalho entre sessões por arquivo

- **Status:** Aceita
- **Data:** 2026-10-17
- **Amplia:** [ADR 0015](0015-app-escreve-no-terminal-a-pedido.md) (o app escreve no terminal do agente) e [ADR 0021](0021-refs-proprias-no-repositorio.md) (os checkpoints dão o diff do turno). É a funcionalidade 18 de [`docs/funcionalidades`](../docs/funcionalidades/revisor-automatico/README.md); a [19, encadear sessões](../docs/funcionalidades/encadear-sessoes/README.md), reaproveita o mesmo mecanismo.

## Contexto

Pedir ao mesmo agente que revise o próprio trabalho rende pouco: ele já está convencido de que está certo. Uma segunda sessão, com o contexto limpo, revisa melhor, mas levar o diff de uma sessão à outra e o resultado de volta era trabalho manual. O app já sabe escrever texto no terminal de um agente (ADR 0015) e já sabe o que cada turno mudou (ADR 0021); faltava o caminho dos dois sentidos.

## Decisão

### O que vai e o que volta passa por arquivos, não pelo terminal

- Um diff não cabe num terminal: colado, ele atravessa o PTY, as marcas de colagem e a tela do agente, e o agente ainda o recebe como se a pessoa tivesse digitado. O app grava o diff num arquivo e manda **só o caminho dele**, num prompt curto, pelo mesmo `sendText` da ADR 0015.
- A passagem tem uma pasta, `~/.agent-controller/handoffs/<id>/` (nos testes, dentro da pasta de dados do app), **fora de qualquer repositório**: o revisor não precisa escrever no projeto para responder. `<id>` é o id da sessão revisada. Dentro: `diff.patch` (o que o app escreve) e `revisao.md` (o que o revisor escreve).
- O `HandoffService` (`src/core/handoff`) é genérico: prepara a pasta (apaga a resposta do pedido anterior, que seria confundida com a nova), lê a resposta e espera por ela. Quem decide *o que* se passa e *a quem* é o `ReviewerService`. O encadeamento (funcionalidade 19) usa a mesma pasta e o mesmo `HandoffService`, com outra regra por cima.

### Quando a resposta "chegou"

O app olha o arquivo a cada 500 ms (polling: `fs.watch` tem diferenças demais entre Windows, Linux e as pastas do WSL2 para valer o risco) e dá a resposta como escrita quando o arquivo existe, **não está vazio e deixou de mudar por 1,5 s**. Um agente que escreve aos poucos não é lido pela metade. Sem resposta em 15 minutos, o app desiste e a sessão mostra "o revisor não escreveu o arquivo": a pessoa lê o terminal do revisor. Passagens com mais de 30 dias são apagadas ao abrir o app.

### O diff do turno

É a diferença entre os dois últimos checkpoints da sessão (`CheckpointService.latestPair`), por `git diff <árvore> <árvore>`. Sem repositório git, ou sem checkpoints, não há revisor (o diálogo diz isso). Até 200 KB o arquivo é o patch inteiro; acima disso o arquivo traz a lista de arquivos (`--name-status`) e o comando `git diff <de> <até> -- <arquivo>` para o revisor ler um por um (as árvores existem no repositório enquanto o checkpoint existir).

### O revisor

- **Quem revisa:** uma sessão que já existe ou uma nova, na mesma pasta e no mesmo grupo (se a sessão revisada não tem grupo, cria-se um para o par). Uma sessão só está em um par, de um lado ou do outro, e não pode revisar a si mesma; isso evita cadeias e laços. O par fica em `reviewers.json`, ao lado das demais preferências; sessões fechadas desfazem o par e a pasta da passagem.
- **Só leitura:** a sessão que o app cria leva `readOnly` e abre no modo só leitura do agente quando ele tem um (`AgentProfile.readOnlyArgs`): `--permission-mode plan` no Claude Code e `--sandbox read-only` no Codex. O modo só leitura **não impede** o revisor de pedir permissão para escrever `revisao.md`, que fica fora do repositório: o pedido aparece como qualquer outro ("responder sem abrir", ADR 0020) e a pessoa o libera uma vez. O flag do Codex segue a documentação do agente e **não foi conferido com o agente real** nesta etapa (a sondagem exige conta e créditos); se a versão instalada não o aceitar, o revisor não abre e a mensagem do próprio agente aparece no terminal dele.
- **Quando:** a cada turno que mudou arquivos (houve um checkpoint novo) e passou nas verificações do fim do turno, ou só em "Revisar agora". Sem verificações configuradas, o gatilho é o fim do turno com checkpoint novo. Verificações que falham não pedem revisão; um turno novo cancela a espera. Um turno que não deixou checkpoint novo não pede nada.
- **Não há volta sozinha:** as observações ficam na sessão revisada ("Revisão pronta (n)"); a pessoa marca as que valem e as manda pelo diálogo de envio de hoje. Nada vai ao agente principal sem ela.
- **O prompt** é o guardado "Revisar o turno" (`review-turn`, em Preferências → Prompts, nos três idiomas). Quem já tinha a lista de prompts antes não o vê até restaurar os de fábrica; enquanto isso vale o de fábrica no idioma atual. `{diff}` e `{revisao}` viram os caminhos; `{pasta}`, `{sessao}` e `{branch}` valem como em qualquer prompt.

### Ler as observações

`parseReview` aceita `- arquivo:linha — texto` e as variações que os agentes escrevem (marcador `*`, `+`, `1.`, `[ ]`; negrito e crases em volta do caminho; `(linha 12)`, `L12`, `12-14`; hífen, travessão ou dois-pontos como separador; barra invertida do Windows). O que não parece lugar vira observação sem arquivo; linhas de continuação e blocos de código ficam com a observação a que pertencem; "Sem observações" vira lista vazia. Limites: 200 observações, 4000 caracteres cada, arquivo lido até 200 KB.

### IPC

`reviewer:set` (liga, troca o gatilho ou desliga), `reviewer:runNow`, `reviewer:result` e o evento `reviewer:changed`. Tudo validado no main: sessão que existe, gatilho conhecido, perfil conhecido, comando de uma linha. `readOnly` não é aceito pelo canal de criar sessão: só o serviço o define. O preload não muda.

## Consequências

- **Custo:** cada revisão é um turno a mais de um agente; com o gatilho "a cada turno", o custo dobra. O diálogo avisa ao ligar.
- **Memória:** nada fica residente além do que já há. O revisor novo só é iniciado no primeiro pedido; o polling roda só enquanto se espera uma resposta.
- **Arquivos fora do repositório:** o revisor lê e escreve em `~/.agent-controller`, fora da pasta do projeto, e um agente em modo só leitura pergunta antes. É o preço de não sujar o repositório do usuário.
- **Risco aceito:** o revisor pode ignorar a instrução e não escrever o arquivo; o prazo e o aviso cobrem isso. Uma resposta antiga que sobrou no disco de uma sessão revisada reaparece como "pronta" quando o app abre de novo, até o próximo pedido.
