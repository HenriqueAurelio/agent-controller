# Eco imediato

- **Estado:** implementada.
- **Código:** `flushDelay` e `scheduleFlush` em [`SessionManager.ts`](../../../src/core/sessions/SessionManager.ts).
- **Medição:** [`tools/perf/echo.mjs`](../../../tools/perf/echo.mjs) (`npm run measure:echo`).

## O problema

A saída de um terminal à vista vai para a interface em lotes, um a cada 8 ms, para não mandar uma mensagem de IPC para cada pedaço que o PTY entrega. O lote também atrasava o eco da digitação: a tecla ia ao shell na hora, mas a letra só voltava à tela no fim da janela de 8 ms. Com 3 sessões trabalhando ao lado, a mediana do eco era 9 ms.

## O que muda

Num terminal à vista, a saída vai na hora quando parece o eco de uma tecla, ou seja, quando ela:

- chega até 100 ms depois de uma tecla digitada nesse terminal;
- tem até 1 KB;
- vem depois de pelo menos 8 ms sem envio.

Tudo o mais continua em lotes de 8 ms, e os terminais fora da tela continuam em lotes de 250 ms.

## Por que três condições

A primeira versão mandava na hora qualquer saída depois de um silêncio. O eco caiu do mesmo jeito, mas o CPU com 6 sessões trabalhando e uma à vista subiu de 42% para 46% de um núcleo. A animação do agente também chega em pedaços pequenos, e cada um passou a custar um desenho. A segunda versão, só com o limite de 1 KB (a regra do CompozyOS), teve o mesmo problema. Só com a janela de 100 ms depois de uma tecla o CPU voltou ao de antes.

## Como foi medido

Windows 10, com o app de antes (a `main`) e o de depois, rodadas alternadas.

**Eco:** 3 sessões com a carga de `tools/perf/tui-load.cjs` e uma quarta à vista; 60 teclas por rodada, com 80 ms entre elas, como alguém digitando. O tempo vai do envio da tecla pela interface até a chegada da saída com a letra.

| Eco (ms) | Antes | Depois |
|---|---|---|
| Mediana | 9,4 e 9,4 | 0,8 e 0,8 |
| p95 | 16,1 e 21,4 | 8,9 e 6,1 |
| Máximo | 16,9 e 28,3 | 29,2 e 9,5 |

**CPU** (`tools/perf/compare.mjs`, 6 sessões, média de 3 rodadas, % de um núcleo):

| Cenário | Antes | Depois |
|---|---|---|
| Parado | 9,1 | 8,8 |
| Carga no fundo | 14,8 | 13,7 |
| Carga à vista | 32,6 | 32,2 |
| Rajada | 44,3 | 43,1 |

A diferença de CPU fica dentro do ruído entre rodadas.

## Testes

`tests/core/sessionManager.test.ts`:

- `flushDelay`: o eco de uma tecla vai na hora. Esperam o lote a saída que ninguém digitou, um redesenho maior que 1 KB e o que vem logo depois de um envio. Fora da tela, o ritmo é o lento.
- Com uma enxurrada num terminal à vista, nunca saem dois lotes com menos de um quadro entre eles.
