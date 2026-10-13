# M1 — Terminal

**Objetivo:** um terminal que roda Claude Code e Codex sem diferença perceptível para um terminal comum.

**Marco pronto quando:** os dois agentes rodam uma tarefa completa no Windows e no Linux, com redimensionamento; fechar a sessão não deixa processo órfão; a tela volta idêntica depois de desmontar e remontar o terminal.

---

## [x] 1.1 PtyManager

- **Frente:** A · **Tamanho:** M · **Depende de:** 0.3
- **Situação em 2026-10-13:** Pronta. `src/core/pty/PtyManager.ts`; testes passam no Windows e no Linux (Docker).

**O que fazer**

- Módulo em `src/core/pty` com `create`, `write`, `resize`, `kill` e eventos `data` e `exit`.
- Cada PTY tem um id; o manager guarda o mapa de PTYs vivos.
- Normalizar a pasta de trabalho para a forma longa no Windows antes de abrir o processo.
- Injetar variáveis de ambiente por sessão (`AGENTCTL_SESSION_ID`).
- Não herdar variáveis internas do próprio app para o processo filho.

**Pronto quando:** testes automáticos criam um PTY, executam um comando, leem a saída, redimensionam e recebem o `exit`, nos dois sistemas.

**Contexto:** nos testes, passar a pasta com nome curto do Windows (`HENRIQ~1`) fez o Codex não reconhecer a confiança já salva.

---

## [x] 1.2 Stream do PTY para o renderer

- **Frente:** B · **Tamanho:** M · **Depende de:** 1.1, 0.2
- **Situação em 2026-10-13:** Pronta. Lotes de 8 ms para o terminal visível e 250 ms para os montados em segundo plano; a leitura do PTY pausa acima de 256 mil caracteres pendentes. Teste do core com 4 MB de saída e e2e de enxurrada passam nos dois sistemas.

**O que fazer**

- Canal de IPC que leva os dados do PTY ao renderer e a entrada do teclado de volta.
- Agrupar os dados em lotes por intervalo curto, em vez de uma mensagem por pedaço.
- Backpressure: pausar a leitura do PTY quando o renderer não está dando conta.
- Um ponto de derivação por onde o parser de sinais (tarefa 3.2) lê o mesmo stream.

**Pronto quando:** um comando que despeja muita saída (`yes`, ou um `cat` de arquivo grande) não trava a interface nem faz a memória crescer sem limite.

---

## [x] 1.3 Componente de terminal

- **Frente:** B · **Tamanho:** M · **Depende de:** 1.2
- **Situação em 2026-10-13:** Pronta no Windows, com os dois agentes reais desenhando a interface deles dentro do app. **Validação pendente:** os agentes reais no Linux (depende da 0.4) e uma conferência visual do redimensionamento com um agente aberto. No lugar do canvas, que o xterm.js 6 não tem mais, a queda do WebGL é para o renderizador DOM.

**O que fazer**

- Componente React que hospeda uma instância de xterm.js fora do ciclo de render (instância imperativa em um ref).
- Addons: WebGL com queda para canvas, ajuste de tamanho, links clicáveis.
- Copiar e colar com os atalhos de cada sistema; colagem com várias linhas.
- Propagar o redimensionamento ao PTY, com debounce.
- Tema claro e escuro e fonte monoespaçada configurável.

**Pronto quando:** Claude Code e Codex abrem, recebem um prompt, desenham a interface deles sem artefatos e continuam corretos ao redimensionar a janela, nos dois sistemas.

---

## [x] 1.4 Encerramento de sessão e árvore de processos

- **Frente:** A · **Tamanho:** M · **Depende de:** 1.1
- **Situação em 2026-10-13:** Pronta. Ctrl+C duas vezes, espera, depois `taskkill /T /F` ou sinal para o grupo, mais uma varredura dos descendentes listados antes do encerramento. Teste com filho e neto passa nos dois sistemas; os roteiros com agentes reais conferem que não sobra órfão.

**O que fazer**

- Encerramento em etapas: pedido gracioso (Ctrl+C / sinal), espera curta, depois encerramento forçado.
- Matar a árvore inteira: `taskkill /T /F` no Windows, sinal para o process group no Linux.
- Ao fechar o app, encerrar todas as sessões pelo mesmo caminho.
- Tratar o erro `AttachConsole failed` do node-pty no Windows sem derrubar o processo principal.

**Pronto quando:** um teste automático abre uma sessão que cria processos filhos e netos, fecha a sessão e verifica que nenhum deles sobrou, nos dois sistemas.

**Não cortável:** processos órfãos atingem direto a dor de consumo que motivou o produto.

---

## [x] 1.5 Histórico no processo principal

- **Frente:** A · **Tamanho:** M · **Depende de:** 1.2
- **Situação em 2026-10-13:** Pronta. `src/core/history/ScreenHistory.ts`. O e2e desmonta e remonta um terminal e compara a tela. Com o terminal visual desmontado, é este terminal sem tela que responde às consultas do agente.

**O que fazer**

- Uma instância de xterm headless por sessão, no processo principal, alimentada pelo mesmo stream.
- Serializar o estado da tela (addon de serialização) para repovoar um terminal visual recém-montado.
- Manter o tamanho do headless em sincronia com o do terminal visual.
- Expor o texto da tela atual para uso em testes e diagnóstico.

**Pronto quando:** desmontar e remontar o terminal visual de uma sessão com o Claude Code aberto devolve a mesma tela, com cores e posição do cursor.

**Contexto:** o xterm headless reconstruiu corretamente a tela dos dois agentes nos testes de 2026-10-12. Esta tarefa é a base da 5.1.
