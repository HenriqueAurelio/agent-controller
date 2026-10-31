# Só a sessão visível recebe saída

- **Estado:** implementada.
- **Código:** `park`, `unpark` e `setVisible` em [`SessionManager.ts`](../../../src/core/sessions/SessionManager.ts); o evento `terminal:resync` em [`terminalHost.ts`](../../../src/renderer/src/lib/terminalHost.ts).
- **Depende de:** [eco imediato](../eco-imediato/README.md), que mexe na mesma função de envio.

## O problema

A interface mantém até 3 terminais montados: o da sessão aberta e os 2 últimos vistos ([`terminalPool.ts`](../../../src/renderer/src/lib/terminalPool.ts)). Os 2 escondidos continuavam recebendo a saída do agente, em lotes a cada 250 ms, e o xterm de cada um interpretava tudo, mesmo sem desenhar. O processo principal já interpreta os mesmos bytes no histórico ([`ScreenHistory`](../../../src/core/history/ScreenHistory.ts)), então era trabalho em dobro para quem não está olhando.

## O que muda

Um terminal montado que sai da tela fica **estacionado**: o agente continua rodando, o histórico continua em dia, mas a interface não recebe nada.

Ao voltar para a sessão:

- **Nada chegou enquanto estava escondida:** o terminal volta como estava, sem redesenho.
- **Chegou saída:** o processo principal manda a tela inteira do histórico (`terminal:resync`), e a interface troca o conteúdo do terminal por ela. É o mesmo conteúdo que um terminal desmontado recebe ao ser montado de novo; só o xterm e o elemento são reaproveitados.

Por que a tela inteira e não só o que faltou: a saída pode trazer perguntas ao terminal (a posição do cursor, por exemplo). Com o terminal estacionado, quem responde é o histórico; se a interface recebesse depois os mesmos bytes, responderia de novo, e a segunda resposta cairia como texto digitado no agente. A tela que vem do histórico já não tem perguntas.

O lote de 250 ms para terminais escondidos deixou de existir.

## O que muda para quem usa

- **O que você vê não muda.** Ao voltar para uma sessão que trabalhou escondida, a tela já aparece em dia.
- **A rolagem volta para o fim.** Se você tinha subido o terminal de uma sessão e trocou de sessão, ao voltar ele estará no fim, como acontece hoje com uma sessão que saiu das 3 montadas.
- **A seleção de texto não sobrevive à troca** quando a sessão escreveu enquanto estava escondida.

## Como foi medido

Windows 10. "Antes" é o build com o [eco imediato](../eco-imediato/README.md), base desta funcionalidade; rodadas alternadas.

**CPU** (`tools/perf/compare.mjs`, 6 sessões, média de 3 rodadas, % de um núcleo):

| Cenário | Antes | Depois | Interface: antes → depois |
|---|---|---|---|
| Parado | 4,3 | 4,3 | 2,8 → 2,9 |
| Carga no fundo | 19 | **11,2** | 11 → 3,5 |
| Carga à vista | 37,2 | **30,6** | 23,2 → 17,4 |
| Rajada | 46,9 | **37,7** | 27,2 → 18,6 |

Em "carga no fundo", as 6 sessões trabalham e uma sétima, quieta, está à vista; 2 das que trabalham estão montadas e escondidas. A memória nesse cenário caiu de 452 para 412 MB.

**Troca de sessão** (`tools/perf/switch.mjs`): duas sessões trabalhando, 20 trocas entre elas, cada uma depois de 600 ms fora da tela. O tempo vai do clique na lista até o terminal desenhado com o que a sessão escreveu enquanto estava escondida.

| Troca (ms) | Antes | Depois |
|---|---|---|
| Mediana | 27,6 e 28 | 42,9 e 43,4 |
| p95 | 34,1 e 45,2 | 64,6 e 64,4 |

A troca ficou cerca de 15 ms mais lenta, por redesenhar a tela a partir do histórico, e continua abaixo de um décimo de segundo.

## Testes

- `tests/core/sessionManager.test.ts`:
  - um terminal escondido não recebe nada e, ao voltar, recebe a tela com o que perdeu, e depois a saída normal;
  - um terminal que não perdeu nada volta sem redesenho;
  - com o terminal escondido, o histórico responde à pergunta da posição do cursor.
- `tests/e2e/so-a-sessao-visivel.spec.ts`: uma sessão escreve enquanto outra está na tela; o terminal escondido não mostra o texto, e ao voltar para ela o texto aparece.
