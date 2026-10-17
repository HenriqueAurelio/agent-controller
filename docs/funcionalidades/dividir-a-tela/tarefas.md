# Dividir a tela: tarefas

**Pronto quando:** duas sessões lado a lado recebem saída ao mesmo tempo, o foco troca pelo teclado, nenhuma das duas gera notificação, a divisão volta ao reabrir o app, e a memória com quatro espaços fica dentro do medido; nos dois sistemas.

---

## [ ] 28.1 Modelo da divisão

- **Frente:** B · **Tamanho:** P · **Depende de:** nada

**O que fazer**

- `SplitLayout` em `shared/layout.ts`, com `sanitizeSplit` (até 4 folhas, sessões que existem).
- Persistência junto do layout.

**Pronto quando:** testes de `sanitizeSplit` com entradas inválidas e sessões removidas.

---

## [ ] 28.2 Sessões à vista no main

- **Frente:** A · **Tamanho:** P · **Depende de:** nada

**O que fazer**

- `sessions:setVisible(ids)` no lugar do uso de `sessions:select` para notificação; `NotificationPolicy` com várias sessões à vista.

**Pronto quando:** testes da política com duas sessões à vista.

---

## [ ] 28.3 `TerminalArea` com espaços

- **Frente:** B · **Tamanho:** M · **Depende de:** 28.1, 28.2

**O que fazer**

- Árvore de espaços com divisórias arrastáveis; foco; arrastar sessão para a borda; painel e auxiliar no espaço com foco.
- `TerminalPool` com "à vista + 2", teto de 6.
- Atalhos `Ctrl+\` e `Ctrl+Alt+setas`.

**Pronto quando:** e2e com dois shells falsos lado a lado.

---

## [ ] 28.4 ADR, medição, README e evidências

- **Frente:** C · **Tamanho:** P · **Depende de:** 28.3

**O que fazer**

- `npm run measure` com 1, 2 e 4 espaços. ADR nova.
- README, em "Layout". Evidências em `evidences/images/dividir-a-tela/`.

**Pronto quando:** PR com ADR, medição, README e telas.
