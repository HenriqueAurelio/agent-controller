# Uso e custo por sessão

- **Estado:** proposta, escolhida para a primeira leva. A primeira tarefa é uma sondagem: os campos abaixo precisam ser conferidos nas versões instaladas antes de qualquer código.
- **ADR:** nova, "De onde vem o uso de cada agente".

## O problema

Com várias sessões abertas, a pessoa não sabe quanto cada uma está gastando, nem quando o contexto de uma está quase cheio (e o agente vai compactar e esquecer coisas). Cada agente mostra isso do seu jeito, dentro do próprio terminal, e só para quem está olhando aquela sessão.

## A ideia

Na barra lateral e no topo da sessão, uma linha discreta: **tokens do turno, custo acumulado e contexto ocupado** (barra que fica âmbar perto de 80%). Num painel **Uso**, o total do dia por sessão e por agente.

## De onde vêm os números (a conferir na sondagem)

| | Claude Code | Codex |
|---|---|---|
| Caminho provável | A *status line*: o Claude Code chama um comando com um JSON da sessão (custo, modelo, contexto) a cada atualização. O app já passa um arquivo `--settings` próprio ([`commandLine.ts`](../../../src/core/agents/commandLine.ts)); a status line entraria nele, apontando para o `agentctl`, que repassa ao app como já faz com os hooks | Os eventos de contagem de tokens que o Codex grava no arquivo da conversa (`~/.codex/sessions/…`), lidos pelo id da conversa (o mesmo do plano de [retomar a conversa](../../planos/retomar-conversa.md)) |
| Custo em dinheiro | Informado pelo agente | Calculado pelo app a partir de uma tabela de preços por modelo, marcado como "estimado" |

Regra que não muda: **o app não altera a configuração do agente** ([DECISOES-E-RISCOS 4.3](../../../DECISOES-E-RISCOS.md)). A status line vai no `--settings` do app, por parâmetro. Se a pessoa já tem uma status line própria, o app não pode apagá-la: o `agentctl` chama a dela e devolve a saída (a confirmar na sondagem se o `--settings` sobrescreve ou mescla).

Como nos sinais de estado, o que vem de cada agente fica no **adaptador**; fora de `src/core/agents` existe só um tipo comum, `UsageSnapshot { inputTokens, outputTokens, costUsd?, costEstimated, contextUsedPct?, model? }`.

## Riscos

| Risco | Como fica |
|---|---|
| Formato interno do agente mudar | Tudo no adaptador, com `lastTestedVersion`; sem dado, a linha some em vez de mostrar errado |
| Conflitar com a status line do usuário | Encadear, nunca substituir; se não der, fica desligado para quem tem uma |
| Custo do Codex errado | Mostrado como estimado, com a tabela de preços visível e editável |
| Ler arquivos grandes do Codex | Leitura incremental do fim do arquivo, sem carregar tudo |
| Memória | Só números por sessão; nenhuma janela nova |
