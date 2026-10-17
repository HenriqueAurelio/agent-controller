# Buscar no projeto: tarefas

**Pronto quando:** `Ctrl+Shift+F`, `console.log`, só em `src/**`, mostra os resultados por arquivo, o clique abre na linha, e mandar três resultados marcados ao agente envia a lista; no instalador do Windows e no AppImage.

---

## [ ] 25.1 Decisão e empacotamento

- **Frente:** C · **Tamanho:** P · **Depende de:** nada

**O que fazer**

- Medir o instalador com `@vscode/ripgrep` (Windows, `.deb` e AppImage) e escrever a ADR.
- `asarUnpack` do binário e o caminho dele em desenvolvimento e empacotado.

**Pronto quando:** ADR aprovada e o binário rodando dos dois instaladores.

---

## [ ] 25.2 `SearchService`

- **Frente:** A · **Tamanho:** M · **Depende de:** 25.1

**O que fazer**

- `rg --json` com as opções e os filtros; resultados em lotes; limite; prazo; cancelamento com `killTree`; reserva com `git grep`.

**Pronto quando:** testes do core com expressão inválida, cancelamento, limite e a reserva sem `rg`. Rodar também em `npm run test:core:docker`.

---

## [ ] 25.3 IPC

- **Frente:** A · **Tamanho:** P · **Depende de:** 25.2

**O que fazer**

- `search:start`, `search:cancel` e o evento `search:results`, no tipo, na lista e no handler, com validação.

**Pronto quando:** testes de validação dos filtros.

---

## [ ] 25.4 Aba Buscar

- **Frente:** B · **Tamanho:** M · **Depende de:** 25.3

**O que fazer**

- Caixa, opções, resultados por arquivo com destaque, marcar e "Mandar ao agente"; `Ctrl+Shift+F`.

**Pronto quando:** e2e numa pasta de teste.

---

## [ ] 25.5 README e evidências

- **Frente:** C · **Tamanho:** P · **Depende de:** 25.4

**O que fazer**

- README: "Buscar no projeto". Evidências em `evidences/images/buscar-no-projeto/`.

**Pronto quando:** PR com ADR, README e telas.
