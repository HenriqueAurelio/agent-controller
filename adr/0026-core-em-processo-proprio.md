# 0026 — Core em processo próprio

- **Status:** Proposta
- **Data:** 2026-10-31
- **Mudaria:** a [ADR 0006](0006-persistencia-json-sem-daemon.md), na fase 2 (os processos deixariam de morrer com o app). O plano completo está em [`docs/v2/core-em-processo-proprio`](../docs/v2/core-em-processo-proprio/README.md).

## Contexto

O processo principal do Electron cuida da janela e roda o core inteiro. Um trabalho longo do core atrasa a janela, e fechar o app encerra todos os agentes. O Maestro (herdr) e o CompozyOS (daemon em Go) mantêm as sessões num processo separado da janela.

Depois dos PRs #44 a #47, o JavaScript do processo principal gasta de 2% a 6% de um núcleo com 6 sessões. O IPC responde em menos de 2 ms no p95, mesmo numa rajada de saída.

## Decisão proposta

1. **Fase 1:** o core roda num `utilityProcess`. O main fica com o que é do Electron (janela, diálogos, notificações, métricas). A saída dos terminais vai do core para a interface por um `MessageChannelMain`, sem passar pelo main. Os outros canais continuam validados no main e são repassados ao core.
2. **Fase 2:** o core passa a ser um processo independente, ao qual a janela se conecta por named pipe ou socket. Fechar a janela pode deixar os agentes rodando, por escolha explícita. O core encerra sozinho sem sessões e sem janela.
3. **Fase 3:** o core avisa "aguardando você" com a janela fechada.

## Alternativas consideradas

- **Só o PTY num processo à parte.** A interpretação de cada byte (histórico, sinais) continuaria no main, e cada byte passaria por uma mensagem a mais. Não resolve nada que importe.
- **Worker thread para o histórico.** Testado em 2026-10-30 e descartado: o histórico custava 1,9% do CPU do main, e o problema real era outro (corrigido no PR #46).
- **Reescrever o app em Rust.** Resolveria a memória, mas é outro produto.

## Consequências

- Mais um processo (uns 30 a 50 MB), a medir contra a [ADR 0009](0009-meta-de-consumo-de-recursos.md).
- `src/main/app.ts` e `src/main/ipc.ts` se dividem em uma casca Electron e um host do core. O `src/core` não muda de regra: continua sem Electron.
- Na fase 2, um processo do app pode continuar rodando com a janela fechada; isso precisa estar sempre visível (bandeja) e ser escolha da pessoa.

## Critério para aceitar

A pessoa dona do produto decide se as sessões devem sobreviver a fechar a janela. Sem a fase 2, a fase 1 sozinha não paga o custo da mudança.
