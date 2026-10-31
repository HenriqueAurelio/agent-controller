# Eco imediato

- **Estado:** implementada.
- **Código:** `flushDelay` e `scheduleFlush` em [`SessionManager.ts`](../../../src/core/sessions/SessionManager.ts).
- **Medição:** [`tools/perf/echo.mjs`](../../../tools/perf/echo.mjs) (`npm run measure:echo`).

## O problema

A saída de um terminal à vista vai para a interface em lotes, um a cada 8 ms, para não mandar uma mensagem de IPC por pedaço que o PTY entrega. O lote também atrasava o eco da digitação: a tecla ia ao shell na hora, mas a letra só voltava à tela no fim da janela de 8 ms. Medido com 3 sessões trabalhando ao lado, a mediana do eco era 9 ms.

## O que muda

O lote passou a ser contado a partir do último envio, não da chegada da saída:

- **Terminal quieto há mais de 8 ms:** a saída nova vai na hora. É o caso do eco de uma tecla.
- **Saída chegando logo depois de um envio:** espera o que falta para completar os 8 ms, como antes.
- **Terminal montado e fora da tela:** continua em lotes de 250 ms.

O ritmo máximo continua sendo um envio a cada 8 ms; só o primeiro de uma sequência deixou de esperar. O CompozyOS faz o mesmo com um limite de tamanho (pedaços de menos de 1 KB vão na hora). Aqui o limite é de tempo, porque um pedaço grande depois de um silêncio também não tem por que esperar.

## Como foi medido

Windows 10, 3 sessões com a carga de `tools/perf/tui-load.cjs` e uma quarta à vista, 60 teclas por rodada, com 80 ms entre elas, como alguém digitando. O tempo vai do envio da tecla pela interface até a chegada da saída com a letra.

| Eco (ms) | Antes | Depois |
|---|---|---|
| Mediana | 9,1 e 9,2 | 0,7 e 0,8 |
| p95 | 16,7 e 11 | 7,2 e 5 |
| Máximo | 50,7 e 42,8 | 9,5 e 9,8 |

Duas rodadas de cada lado. O CPU com 6 sessões não mudou além do ruído (`tools/perf/compare.mjs`, no PR).

## Testes

`tests/core/sessionManager.test.ts`:

- `flushDelay`: a saída depois de um silêncio vai na hora; a que vem logo depois espera o resto do quadro; fora da tela o ritmo é o lento.
- Com uma enxurrada num terminal à vista, nunca saem dois lotes com menos de um quadro entre eles.
