# Uso e contexto por sessão

- **Estado:** implementada (tokens, contexto e uso do plano do Codex). O custo em dinheiro ficou de fora; veja [O que ficou de fora](#o-que-ficou-de-fora).
- **Substitui:** a proposta [uso e custo](../../funcionalidades/uso-e-custo/README.md), que previa a status line do Claude Code. A leitura do arquivo da conversa dispensa mexer na configuração do agente.
- **Código:** leitores em [`src/core/agents/usage.ts`](../../../src/core/agents/usage.ts), leitura incremental em [`TranscriptTail.ts`](../../../src/core/sessions/TranscriptTail.ts) e [`UsageTracker.ts`](../../../src/core/sessions/UsageTracker.ts).

## O problema

Com várias sessões abertas, não dava para saber quanto cada uma já gastou, nem quando o contexto de uma está quase cheio e o agente vai compactar a conversa e esquecer detalhes. Cada agente mostra isso do seu jeito, dentro do próprio terminal, e só para quem está olhando aquela sessão.

## Como fica

- **Na lista de sessões**, ao lado do agente, a parte do contexto que a conversa ocupa (`38%`). A marca fica âmbar a partir de 80%.
- **Passando o mouse**, o detalhe: contexto ocupado e tamanho da janela, tokens de saída, tokens novos de entrada, tokens lidos do cache e, no Codex, quanto do limite do plano já foi usado.
- Sem número confiável, a marca não aparece. Isso vale para uma sessão que ainda não respondeu nada, para um modelo cuja janela o app não conhece e para um arquivo que não foi achado.

## De onde vêm os números

Os dois agentes gravam a conversa num arquivo, uma linha JSON por evento. O app lê **só o que foi acrescentado** desde a última leitura: logo depois de cada hook do agente, a cada 5 s enquanto ele trabalha e uma última vez quando o turno termina.

| | Claude Code | Codex |
|---|---|---|
| Arquivo | `transcript_path`, que todo hook do Claude Code recebe | `transcript_path` do hook, se houver; senão, o `rollout-…-<id>.jsonl` dos últimos 7 dias em `~/.codex/sessions` (ou `CODEX_HOME`), pelo id da conversa (`SessionStart` ou `notify`) |
| Linha lida | `type: "assistant"` com `message.usage`; cada bloco da resposta repete o mesmo `message.id`, que conta uma vez só | `event_msg` com `payload.type: "token_count"`, que já traz os totais |
| Contexto ocupado | entrada + cache criado + cache lido + saída da última resposta | `last_token_usage.total_tokens` |
| Janela | pela família do modelo: 1M nos atuais, 200K nos anteriores ao 4.6 | `model_context_window`, gravado pelo próprio Codex |
| Uso do plano | não gravado | `rate_limits.primary.used_percent` |
| Fica de fora | linhas de subagentes (`isSidechain`) | |

Conferido com Claude Code 2.1 e Codex 0.163 instalados nesta máquina.

O que é de cada agente fica no adaptador dele (`src/core/agents`). Fora dali existe só o tipo comum `SessionUsage`, em `src/shared/session.ts`.

## Custo

A leitura não carrega o arquivo inteiro na memória. Ela guarda só a posição no arquivo, as somas e a lista dos ids de mensagem já contados. Um arquivo longo lido pela primeira vez vai em pedaços de 1 MB, com uma pausa entre eles para não travar o processo principal.

Medido no Windows 10 com o maior arquivo de conversa desta máquina (11 MB, 3 931 linhas), em 3 rodadas:

| | Tempo | CPU |
|---|---|---|
| Primeira leitura, do arquivo inteiro | 112 a 124 ms, em pedaços de 1 MB | 109 a 141 ms |
| Cada leitura seguinte, sem nada novo | 0,2 ms (mediana) | |

Com a leitura a cada 5 s enquanto o agente trabalha, isso dá menos de 0,01% de um núcleo por sessão.

## O que ficou de fora

- **Custo em dinheiro.** O Claude Code não grava custo no arquivo, e o preço por token varia por modelo e por tipo de cache. O preço de escrita no cache, por exemplo, não está na tabela de referência usada aqui. Mostrar um valor estimado com uma tabela incompleta levaria a número errado. A maioria das contas, além disso, é por assinatura, em que o limite do plano importa mais que o preço. Fica para quando houver uma tabela de preços confiável e editável nas preferências.
- **Uso do plano no Claude Code.** O arquivo da conversa não traz o limite; só a status line do Claude Code o recebe.
- **Total do dia por agente**, previsto na proposta antiga: pede guardar histórico entre sessões.

## Testes

- `tests/core/usage.test.ts`:
  - leitores dos dois agentes, com linhas copiadas de arquivos reais: mensagem repetida, subagente, linha cortada no meio;
  - janela de contexto por modelo;
  - leitura incremental: linha incompleta, caractere de vários bytes cortado entre duas escritas, arquivo substituído;
  - avisos do `UsageTracker` só quando algo muda;
  - busca do rollout do Codex pelo id, incluindo um id que tenta sair da pasta.
- `tests/core/sessionManager.test.ts`: um hook com `transcript_path` leva tokens e contexto à lista; iniciar o agente de novo apaga os números da conversa anterior.
- `tests/e2e/uso-e-contexto.spec.ts`: um hook com `transcript_path` aponta para um arquivo de conversa. A marca aparece na lista, muda quando o arquivo cresce e fica âmbar acima de 80%.
- `tests/e2e/evidences-uso-e-contexto.spec.ts` (só com `EVIDENCES=1`): a lista antes e depois, com três sessões em 12%, 63% e 91%.
