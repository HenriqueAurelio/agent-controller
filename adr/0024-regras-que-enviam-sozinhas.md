# 0024 — Regras que enviam sozinhas (encadear sessões)

- **Status:** Aceita
- **Data:** 2026-10-17
- **Amplia:** [ADR 0015](0015-app-escreve-no-terminal-a-pedido.md) (o app escreve no terminal; a fila entrega) e [ADR 0023](0023-passagem-de-trabalho-por-arquivo.md) (passagem de trabalho por arquivo). É a funcionalidade 19 de [`docs/funcionalidades`](../docs/funcionalidades/encadear-sessoes/README.md).

## Contexto

O revisor automático resolve autor → revisor. Os fluxos reais têm mais passos (planejar, implementar, escrever testes, revisar) e voltas (o revisor achou problemas, o autor corrige). Montar isso à mão é ficar de babá entre as sessões. Mas uma regra que **envia texto a um agente sozinha** gasta créditos sem a pessoa olhar: precisa de freios.

## Decisão

### Regras num grupo, com poucos gatilhos

- As regras ficam **com o grupo** (`SessionGroup.flow = { rules, paused }`), em `sessions.json`. Não entram na exportação de preferências: são coisas que enviam sozinhas, como as verificações.
- Uma regra é `{ id, from, when, prompt, to, confirm, maxRounds }`: "quando **from** `when`, mandar `prompt` para **to**". `from` e `to` são sessões do **mesmo grupo**. Gatilhos, só quatro: o turno terminou, as verificações passaram, as verificações falharam, a sessão escreveu o arquivo de volta. Sem condição composta.
- O texto vem com as variáveis dos prompts de hoje e quatro a mais: `{diff_do_turno}` (arquivo com o diff do último turno da origem), `{saida}` (o arquivo de volta da origem), `{sessao_origem}` e `{saida_destino}`. Esta última não estava no desenho: sem ela o destino não saberia onde escrever a resposta que uma regra `fileWritten` seguinte espera. O "arquivo de volta" de cada sessão é o `revisao.md` da pasta dela em `~/.agent-controller/handoffs/<id>/` (ADR 0023); o diálogo mostra o caminho de cada uma para a pessoa pedir ao agente que escreva ali.

### Quem entrega: a fila de prompts

O `FlowEngine` (`src/core/handoff`) não escreve no terminal: põe o texto na **fila de prompts do destino** (`queue.add`). Assim a regra herda da ADR 0015 que o texto só vai com o agente livre (nada de colar em cima de um turno, de uma permissão ou de uma pergunta) e que ele entra com Enter.

### Freios

1. **Confirmar antes, de fábrica.** A regra só **prepara** o envio (o texto já com as variáveis preenchidas); a pessoa aprova num clique, na barra lateral (`→ destino ✓` na linha da origem) ou no diálogo. Desmarcado, envia sozinha. Um envio preparado da mesma regra substitui o anterior: o mais novo tem o trabalho mais recente.
2. **Limite de voltas.** Toda regra que fecha um ciclo (o destino alcança a origem de novo pelas regras) tem `maxRounds`, de 1 a 10 (3 de fábrica). Ao chegar nele, o fluxo **para** e o histórico diz qual regra parou. A contagem recomeça quando uma regra fora de qualquer ciclo dispara (uma nova rodada do fluxo) e quando a pessoa retoma.
3. **Parar o fluxo.** Um botão no cabeçalho do grupo suspende todas as regras (`paused`, guardado com o grupo). O fluxo também para sozinho quando uma sessão que participa de uma regra pede permissão ou faz uma pergunta (estado `aguardando` confirmado que não é o "pronto" de uma sessão ociosa): a pessoa responde e retoma.
4. **Só estado confirmado.** Um fim de turno que veio só de silêncio, ou sem sinal confirmado do agente, não dispara regra.
5. **Sessão removida** leva embora as regras e os envios preparados que a citavam.

### O arquivo de volta como gatilho

`fileWritten` usa o `HandoffService.waitForReview` (ADR 0023), com uma opção nova, `since`: só vale um arquivo gravado depois de a espera começar. Uma resposta de antes de ligar o fluxo, ou de uma rodada anterior, não dispara de novo. O app olha o arquivo a cada 500 ms **apenas** das sessões que têm uma regra `fileWritten` num fluxo ligado.

### O que fica de fora

- O revisor automático (ADR 0023) **continua sendo o `ReviewerService`**, que sabe ler e mostrar as observações. O modelo "Autor e revisor" cria as duas regras equivalentes, mas não migra os pares já existentes: os dois mecanismos convivem, e um par não deve ser montado nos dois ao mesmo tempo.
- Envios preparados e histórico ficam **em memória** (os 40 últimos eventos por grupo); as regras e o estado parado, não. Fechar o app descarta o que estava esperando aprovação.
- Regra com prompt guardado: o editor aceita texto; para usar um prompt guardado, copie o texto dele.

## Consequências

- O custo de um fluxo é o de vários turnos de agente: por isso a aprovação é o padrão e o limite de voltas é obrigatório.
- Quem lê `sessions.json` de uma versão anterior não tem `flow`; o campo é opcional e o que não for válido é descartado ao carregar (nunca um erro).
- Um fluxo ligado com regra `fileWritten` faz uma leitura de `stat` a cada 500 ms por sessão de origem; sem regra desse tipo, nenhum processo ou timer novo.
