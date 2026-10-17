# Histórico do arquivo: tarefas

**Pronto quando:** o histórico de um arquivo renomeado mostra os commits de antes do nome novo; comparar com um deles funciona; a autoria mostra as linhas não commitadas como tal; nos dois sistemas.

---

## [ ] 27.1 `HistoryService`

- **Frente:** C · **Tamanho:** M · **Depende de:** nada

**O que fazer**

- `log(file)` com `--follow`, limite de 200; `blame(file)` com `--porcelain --contents -`.
- `DiffBase` `commit`, com validação do `sha`.

**Pronto quando:** testes do core com renomeação, arquivo novo, linha não commitada e `sha` inválido. Rodar também em `npm run test:core:docker`.

---

## [ ] 27.2 IPC

- **Frente:** A · **Tamanho:** P · **Depende de:** 27.1

**O que fazer**

- `git:log` e `git:blame` no tipo, na lista e no handler; a base nova no `git:diff`.

**Pronto quando:** testes de validação.

---

## [ ] 27.3 Histórico e autoria no painel

- **Frente:** B · **Tamanho:** M · **Depende de:** 27.2

**O que fazer**

- Lista de commits; diff de um commit; "Comparar com este commit".
- Autoria como decorações do Monaco, com dica; `Ctrl+Alt+B`; preferência guardada.

**Pronto quando:** e2e num repositório de teste com três commits.

---

## [ ] 27.4 README e evidências

- **Frente:** C · **Tamanho:** P · **Depende de:** 27.3

**O que fazer**

- README, em "Ver o que o agente alterou". Evidências em `evidences/images/historico-do-arquivo/`.

**Pronto quando:** PR com README e telas.
