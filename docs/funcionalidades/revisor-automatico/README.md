# Revisor automático

- **Estado:** concluída (leva 1). O smoke com os agentes reais (Claude Code e Codex) não foi rodado: o modo só leitura do Codex (`--sandbox read-only`) e os dois agentes seguindo a instrução do arquivo de volta seguem sem sondagem; os testes usam um agente falso e dois shells.
- **ADR:** [0023, "Passagem de trabalho entre sessões por arquivo"](../../../adr/0023-passagem-de-trabalho-por-arquivo.md). A [encadear sessões](../encadear-sessoes/README.md) reaproveita essa mesma ADR.
- **Como ficou, onde mudou do desenho:** além dos três canais, `reviewer:set` também desliga e troca o gatilho. O par vive em `reviewers.json`; a sessão revisada mostra "Revisão pronta (n)" no cabeçalho e 🔍 na lista, e o revisor leva 🔍. O botão **Revisor** abre um diálogo só (escolher, ver as observações, marcar, devolver, revisar agora, tirar). "Devolver ao agente" abre o diálogo de envio de hoje com as observações marcadas já escritas, no formato `- arquivo:linha — texto`. A resposta é dada como escrita quando o arquivo para de mudar por 1,5 s. O prompt "Revisar o turno" entra na lista de fábrica; quem já tinha a lista o usa pelo de fábrica até restaurar. Sem verificações configuradas, o gatilho é o fim do turno com checkpoint novo. O encaixe com "comentar no diff" fica para quando ele existir.

## O problema

Pedir ao mesmo agente que revise o próprio trabalho rende pouco: ele já está convencido de que está certo. Uma segunda sessão, com contexto limpo, revisa melhor. Hoje isso dá trabalho: copiar o diff, colar na outra sessão, ler a resposta e levar de volta o que importa.

## A ideia

Uma sessão pode ter um **revisor**: outra sessão, que pode ser de outro agente. Quando a sessão principal termina um turno, e as verificações passam, o app manda ao revisor o que aquele turno mudou. O revisor escreve as observações num arquivo combinado, e o app as mostra na sessão principal, prontas para devolver ao agente.

## Como fica para quem usa

- No topo da sessão, **Revisor → Escolher** liga uma sessão revisora, que pode ser nova (o app cria, na mesma pasta, só para ler) ou uma que já existe. O revisor fica no mesmo grupo, marcado com **🔍**.
- **Quando revisar:** a cada turno que mudou arquivos e passou nas verificações (de fábrica), ou só quando a pessoa clicar **Revisar agora**.
- **O que o revisor recebe:** um prompt guardado ("Revisar o turno", editável em Preferências → Prompts) com o caminho de um arquivo que tem o diff do turno. O diff vai em arquivo, não colado no terminal.
- **O que volta:** o prompt pede que o revisor escreva as observações em `~/.agent-controller/handoffs/<id>/revisao.md`. Quando o arquivo aparece, a sessão principal mostra **Revisão pronta (4)**.
- **Devolver ao agente:** abre as observações, deixa marcar quais valem e manda as marcadas ao agente principal, pelo diálogo de envio de hoje. Quando [comentar no diff](../comentar-no-diff/README.md) existir, cada observação com arquivo e linha vira um comentário no lugar certo.
- **Não há volta sozinha:** o app não manda a revisão ao agente principal por conta própria. Quem fecha o ciclo é a pessoa (ou uma regra explícita de [encadear sessões](../encadear-sessoes/README.md)).

## Onde entra na arquitetura

- **"O que o turno mudou"** vem dos [checkpoints por turno](../checkpoints-por-turno/README.md): o diff entre o checkpoint anterior e o atual. Sem checkpoints (fora do git), não há revisor.
- **Core:** `src/core/handoff/HandoffService.ts` cria a pasta da passagem, grava o diff, manda o prompt pelo envio de hoje e vigia o arquivo de volta (com prazo; sem resposta em 15 minutos, desiste e avisa). `src/core/handoff/review.ts` lê o Markdown das observações num formato simples e tolerante: `- arquivo:linha — texto`, com linhas sem arquivo também aceitas.
- **IPC:** `reviewer:set`, `reviewer:runNow`, `reviewer:result`, e o evento `reviewer:changed`.
- **Permissões do revisor:** o revisor criado pelo app abre no modo só leitura do agente, se o agente tiver um (`--permission-mode plan` no Claude Code; no Codex, o equivalente a conferir na sondagem). Ele precisa de permissão para escrever só o arquivo de volta, que fica fora do repositório.

## Riscos

| Risco | Como fica |
|---|---|
| Revisor escrever no repositório | Modo só leitura onde o agente tem; o arquivo de volta fica fora do repositório |
| Revisor não escrever o arquivo (ignora a instrução) | Prazo e aviso; a pessoa lê o terminal do revisor |
| Custo dobrado a cada turno | Gatilho "só quando eu clicar" disponível; aviso ao ligar |
| Diff enorme | Arquivo com limite de tamanho; acima, só a lista de arquivos e a instrução de ler com o git |
