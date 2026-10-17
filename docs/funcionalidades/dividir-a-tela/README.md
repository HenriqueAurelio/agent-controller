# Dividir a tela

- **Estado:** proposta, leva 2.
- **ADR:** nova, "Mais de um terminal visível". Revê o limite do `TerminalPool` e passa pela meta da [ADR 0009](../../../adr/0009-meta-de-consumo-de-recursos.md).

## O problema

A janela mostra uma sessão por vez. Quem acompanha um agente implementando e outro revisando fica alternando com `Ctrl+1` e `Ctrl+2`, e perde o que um escreveu enquanto olhava o outro. O [layout](../../../README.md#layout) já posiciona o painel e o terminal auxiliar, mas não duas sessões.

## A ideia

Dividir a área do terminal em **dois ou quatro** espaços, cada um com uma sessão. O foco vai de um para o outro pelo teclado, e cada espaço tem o topo da sua sessão.

## Como fica para quem usa

- **Dividir à direita** e **Dividir abaixo** (paleta, menu da sessão, `Ctrl+\`), ou arrastar uma sessão da barra lateral para a borda do terminal.
- Até **4 espaços**: dois lado a lado, dois em cima e embaixo, ou 2×2. A divisória pode ser arrastada.
- O espaço com foco tem a borda acesa. `Ctrl+Alt+setas` muda o foco, e `Ctrl+1` … `Ctrl+9` abre a sessão no espaço com foco.
- O painel de mudanças e o terminal auxiliar pertencem ao espaço com foco, e seguem o layout escolhido dentro dele.
- **Fechar o espaço** (o **×** no topo dele) não fecha a sessão: ela só deixa de estar à vista.
- A divisão fica guardada e volta ao reabrir o app.
- A notificação "a sessão que você está olhando não avisa" passa a valer para todas as sessões à vista.

## Onde entra na arquitetura

- **Renderer:** `TerminalArea.tsx` deixa de ter um terminal à vista e passa a ter uma árvore de espaços (`SplitLayout` em `shared/layout.ts`, guardada com as preferências de layout). O `TerminalPool` monta todos os à vista, mais os dois recentes: `MAX_MOUNTED` passa de 3 para "à vista + 2", com um teto de 6.
- **Main e core:** `sessions:select` passa a aceitar a lista das sessões à vista (`sessions:setVisible(ids)`), porque a política de notificação (`NotificationPolicy`) e o `terminal:setVisible` dependem disso.
- Nada muda no core das sessões.

## Riscos

| Risco | Como fica |
|---|---|
| Memória: cada xterm à vista custa | Teto de 4 à vista; `npm run measure` com 4 espaços, contra a meta |
| Atalhos de hoje mudarem de sentido | `Ctrl+1…9` continua abrindo a sessão; o que muda é só onde |
| Tamanho do PTY em espaços pequenos | Cada terminal ajusta o próprio tamanho (`terminal:resize`), com mínimo de 40 colunas |
