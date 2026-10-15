# 0014 — Verificações do projeto ao fim do turno

- **Status:** Aceita
- **Data:** 2026-10-15
- **Emenda:** [ADR 0007](0007-escopo-do-v1.md), que não previa o app rodando comandos do projeto, e [ADR 0012](0012-see-changes-permite-editar.md), na parte em que o app não escreve no terminal do agente. O resto das duas continua valendo.

## Contexto

"Terminou" diz que o agente parou, não que o trabalho está certo. Com várias sessões abertas, a pessoa precisa voltar a cada uma, abrir outro terminal e rodar `npm test` e `npm run lint` para saber se pode seguir. É a proposta 4 de [`docs/funcionalidades`](../docs/funcionalidades/verificacoes-pos-turno/README.md).

## Decisão

### O que roda e quando

- Cada **pasta** pode ter uma lista de **verificações**: comandos de uma linha (`npm run lint`, `npm test`), com nome, limite de tempo e se rodam sozinhos ao fim do turno.
- Quando o agente de uma sessão **termina um turno** (o estado passa a "terminou"), o app roda as verificações daquela pasta marcadas para isso. Não roda se nada mudou na pasta desde a última rodada completa: o app compara o commit atual, o que o `git status` lista e o tamanho e a data de cada arquivo listado. Fora de um repositório não há como saber, e elas rodam.
- **O agente voltou a trabalhar:** a rodada em andamento é cancelada, com a árvore de processos, porque o resultado já estaria velho.
- **Rodar agora** roda todas as verificações da pasta, inclusive as que não rodam sozinhas.
- No máximo **duas sessões** rodam verificações ao mesmo tempo; as outras esperam na fila.

### Como roda

- Cada verificação roda **no shell do usuário**, iniciado como o comando de uma sessão ([ADR 0013](0013-comando-do-usuario-no-lugar-do-agente.md)): PowerShell com o perfil no Windows, `$SHELL -i` no Linux. Assim valem o `PATH` e os aliases da pessoa.
- Sem terminal (sem PTY), com `CI=1` no ambiente, e uma por vez dentro da rodada. O app guarda só o final da saída (200 mil caracteres) e tira dela as sequências de cor.
- No Windows, o script chega ao PowerShell por `-Command`, decodificando-se sozinho, e não por `-EncodedCommand` como o comando de uma sessão. Com a saída num pipe, o `-EncodedCommand` faz o PowerShell escrever os próprios erros e a barra de progresso ("Preparando módulos para primeiro uso") em CLIXML, e na página de código do console; foi o que o primeiro smoke mostrou chegando ao agente. Pelo `-Command`, com a saída em UTF-8 e o progresso desligado, chega texto.
- Nenhum processo fica residente: cada comando é um processo, encerrado ao fim, no limite de tempo ou ao cancelar.

### O que é guardado

- As verificações ficam por pasta no `sessions.json`, **fora das preferências**. Por isso não vão no arquivo de exportação: importar configurações nunca traz comandos que o app vai rodar sozinho.
- O resultado da última rodada fica só na memória, enquanto o app está aberto.
- Nada roda antes de a pessoa salvar a lista. O app só **sugere** comandos a partir dos scripts do `package.json` (`lint`, `typecheck`, `check`, `test`, com o gerenciador do lockfile).

### Mandar o erro ao agente

- Quando uma rodada falha, **Mandar o erro ao agente** cola no prompt do agente o que falhou: o comando, o motivo e as últimas 60 linhas da saída de cada verificação que falhou, no idioma da interface.
- É a primeira vez que o app escreve no terminal do agente por conta própria. Só acontece **por um clique**, nunca sozinho, e **sem Enter**: a pessoa confere no terminal e envia.
- O texto vai **numa linha só**, com `⏎` onde havia quebra de linha, dentro de uma colagem em bloco (*bracketed paste*). Medido com o Claude Code 2.1.300 no Windows: o ConPTY tira os marcadores da colagem, e com eles o que separa uma quebra de linha de um Enter. Um texto curto com quebras era enviado na hora da colagem; um longo ficava preso, e nem o Enter o enviava. Sem quebra nenhuma, só o Enter da pessoa envia, em qualquer agente e sistema.
- O texto é limpo antes: caracteres de controle e qualquer sequência que pudesse encerrar a colagem antes da hora saem.

### Avisos

- Na barra lateral e no botão **Verificações** do topo da sessão: ✓ (tudo passou), ✗ N (quantas falharam), … (na fila ou rodando), – (cancelada).
- Uma rodada **ao fim do turno** que falha gera um aviso do sistema ("Verificações falharam: 1 de 2."), com as mesmas regras do aviso de fim de turno: não para a sessão que está à vista, e só com o aviso de "terminou" ligado.

## Alternativas consideradas

- **Guardar as verificações nas preferências.** Iriam no arquivo de exportação, e um arquivo importado faria o app rodar comandos novos sem a pessoa ver.
- **Rodar sem shell, com os argumentos separados.** Mais previsível, mas `npm test` e um alias do usuário dependem do `PATH` e do perfil do shell; seria preciso traduzir cada comando.
- **Rodar a cada turno, sem comparar o estado da pasta.** Mais simples, mas um turno que só respondeu uma pergunta rodaria a suíte de testes inteira de novo.
- **Mandar o erro ao agente sozinho, sem clique.** Fecharia o ciclo sem a pessoa, mas o app passaria a conduzir o agente, e uma verificação mal configurada faria o agente girar em falso gastando a conta.
- **Mostrar a saída num terminal de verdade (xterm).** Cores e formatação exatas, mas um terminal a mais por sessão custa memória ([ADR 0009](0009-meta-de-consumo-de-recursos.md)); texto puro basta para ler o erro.

## Consequências

- O app passa a rodar comandos do projeto, que a pessoa escolheu, sem que ela os digite a cada vez. Isso entra no item 3.6 de [`DECISOES-E-RISCOS.md`](../DECISOES-E-RISCOS.md).
- O contrato de IPC ganhou `checks:get`, `checks:configure`, `checks:run`, `checks:cancel`, `checks:sendFailure` e o evento `checks:changed`. O renderer manda o id da sessão, nunca um comando para rodar ou um texto para o terminal; a lista de verificações é validada no main com as mesmas regras do comando de uma sessão.
- `src/core/tools/ToolRunner.ts` roda uma ferramenta do projeto com prazo e limite de saída; é a peça que o formatador ao salvar (proposta 1) vai reaproveitar.

## Riscos e mitigação

| Risco | Mitigação |
|---|---|
| Testes pesados em várias sessões derrubarem a máquina | No máximo duas rodadas ao mesmo tempo; limite de tempo por verificação; cancelamento quando o agente volta a trabalhar |
| Um comando que pede algo no terminal travar | Sem terminal, com `CI=1`; o limite de tempo encerra a árvore de processos |
| Rodar código do repositório | Só os comandos que a pessoa salvou; nada vem do arquivo de exportação nem roda por ser sugerido |
| Texto colado ser enviado antes da hora, ou não ser enviado pelo Enter | Uma linha só, em colagem em bloco, sem Enter; caracteres de controle removidos. Conferido com o Claude Code 2.1.300 (pelo `claude-personal`) e o Codex 0.162.1 reais no `npm run test:smoke` (roteiro `checks.smoke.ts`) |
| A saída da verificação vir suja do PowerShell (CLIXML, acentos trocados) | Script por `-Command`, progresso desligado, saída em UTF-8; teste em `tests/core/shellCommand.test.ts` |
| Saída enorme | Só o final é guardado; ao agente vão as últimas 60 linhas de cada verificação que falhou |
| Memória | Processos só durante a rodada; nenhum terminal novo. Conferido com `npm run measure` |
