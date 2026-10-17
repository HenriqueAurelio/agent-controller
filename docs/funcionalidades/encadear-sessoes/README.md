# Encadear sessões

- **Estado:** concluída (leva 1). O smoke com os agentes reais (Claude Code e Codex) não foi rodado; os testes usam shells no lugar dos agentes.
- **ADR:** a do [revisor automático](../revisor-automatico/README.md) ("Passagem de trabalho entre sessões por arquivo", [0023](../../../adr/0023-passagem-de-trabalho-por-arquivo.md)), mais uma nova, [0024, "Regras que enviam sozinhas"](../../../adr/0024-regras-que-enviam-sozinhas.md).
- **Como ficou, onde mudou do desenho:** além dos quatro canais, `flows:discard` (descartar um envio preparado). Ganhou a variável `{saida_destino}` (onde o destino escreve a resposta). Os modelos criam as regras no editor, sem salvar; o "Autor e revisor" cria as duas regras equivalentes, mas o `ReviewerService` continua existindo (não foi migrado). Envios preparados e histórico ficam em memória.

## O problema

O revisor automático resolve um caso: autor → revisor. Os fluxos reais têm mais passos: quem planeja → quem implementa → quem escreve os testes → quem revisa. Também há voltas: o revisor achou problemas, então o autor corrige. Montar isso à mão é ficar de babá entre as sessões.

## A ideia

**Regras** num grupo de sessões, no formato "quando **A** fizer **X**, mandar **isto** para **B**". O revisor automático vira uma regra pronta. A pessoa monta o resto.

```
Quando "planejar"      terminar                      → mandar a "implementar": "Siga o plano em {saida}"
Quando "implementar"   terminar e verificações ✓     → mandar a "revisar":     "Revise o diff em {diff_do_turno}"
Quando "revisar"       escrever o arquivo de volta   → mandar a "implementar": "Corrija: {saida}"   (no máximo 3 voltas)
```

## Como fica para quem usa

- No cabeçalho do grupo, **Fluxo** abre a lista de regras. Cada regra tem:
  - **De:** uma sessão do grupo.
  - **Quando:** terminou o turno · as verificações passaram · as verificações falharam · escreveu o arquivo de volta.
  - **Mandar:** um prompt guardado ou um texto, com as variáveis de hoje e mais três: `{diff_do_turno}` (caminho do arquivo com o diff), `{saida}` (caminho do arquivo de volta da sessão de origem) e `{sessao_origem}`.
  - **Para:** outra sessão do grupo.
  - **Confirmar antes:** de fábrica, a regra só **prepara** o envio, e a pessoa aprova com um clique na barra lateral. Desmarcado, envia sozinha.
- **Limite de voltas:** toda regra que fecha um ciclo (A → B → A) tem um máximo, 3 de fábrica. Ao chegar nele, o fluxo para e avisa.
- **Parar o fluxo:** um botão no grupo suspende todas as regras. Elas também param sozinhas quando alguma sessão do fluxo pede permissão ou faz uma pergunta.
- **Modelos prontos:** "Autor e revisor" (o revisor automático), "Plano → implementação → revisão".
- Na barra lateral, uma seta fina liga as sessões do fluxo, e o envio preparado aparece como "Pronto para mandar a “revisar” ✓".

## Onde entra na arquitetura

- **Core:** `src/core/handoff/FlowEngine.ts`. Escuta os eventos que já existem (fim de turno no `SignalAggregator`, rodada no `CheckService`, arquivo de volta no `HandoffService`) e entrega pela [fila de prompts](../fila-de-prompts/README.md) da sessão de destino. Assim a regra herda dela o "só anda com `done`" e o "pausa com pergunta".
- As regras ficam com o grupo, em `sessions.json`. Não vão no arquivo de exportação das preferências: são coisas que enviam sozinhas, como as verificações.
- **IPC:** `flows:get`, `flows:set`, `flows:pause`, `flows:approve`, e o evento `flows:changed`.

## Riscos

| Risco | Como fica |
|---|---|
| Ciclo infinito gastando créditos | Limite de voltas obrigatório; "confirmar antes" de fábrica |
| Regra disparar sobre um estado estimado | Sessões sem sinal do agente não disparam regras |
| Fluxo difícil de entender | A seta na barra lateral e um histórico do que cada regra mandou e quando |
| Escopo crescer até virar um motor de workflow | Só os quatro gatilhos acima, e destino dentro do mesmo grupo; nada de condição composta no v1 |
