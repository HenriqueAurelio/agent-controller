# Revisor automático: tarefas

**Pronto quando:** uma sessão com revisor termina um turno que passa nas verificações; o revisor recebe o diff do turno, escreve as observações, a sessão principal mostra "Revisão pronta", e a pessoa devolve duas delas ao agente; nos dois agentes e nos dois sistemas.

---

## [ ] 18.1 `HandoffService`

- **Frente:** A · **Tamanho:** M · **Depende de:** [checkpoints](../checkpoints-por-turno/tarefas.md) 14.2

**O que fazer**

- Pasta da passagem em `~/.agent-controller/handoffs/<id>/`, com o diff do turno e um limite de tamanho.
- Envio do prompt pelo caminho do `terminal:sendText`; vigia do arquivo de volta, com prazo.
- Limpeza das passagens com mais de 30 dias.

**Pronto quando:** testes do core com arquivo de volta que chega, que não chega e que chega pela metade (escrito aos poucos).

---

## [ ] 18.2 Ler as observações

- **Frente:** A · **Tamanho:** P · **Depende de:** nada

**O que fazer**

- `src/core/handoff/review.ts`: `parseReview(markdown)` → `{ file?, line?, text }[]`, tolerante a variações de lista e de separador.

**Pronto quando:** testes com saídas reais copiadas dos dois agentes.

---

## [ ] 18.3 Ligar o revisor à sessão

- **Frente:** A · **Tamanho:** M · **Depende de:** 18.1, 18.2

**O que fazer**

- `reviewer:set` (sessão existente ou nova, só leitura), gatilho no fim do turno com verificações verdes, `reviewer:runNow`.
- Prompt de fábrica "Revisar o turno" nos três idiomas.

**Pronto quando:** teste do `SessionManager` com o gatilho, e com o revisor fechado no meio.

---

## [ ] 18.4 Interface

- **Frente:** B · **Tamanho:** M · **Depende de:** 18.3

**O que fazer**

- **Revisor** no topo da sessão; **🔍** no revisor; **Revisão pronta (n)**; lista com marcar e "Devolver ao agente".
- Encaixe com comentar no diff, quando ele existir.

**Pronto quando:** e2e com dois shells falsos, um fazendo o papel do revisor e escrevendo o arquivo.

---

## [ ] 18.5 Sondagem, ADR, README e evidências

- **Frente:** C · **Tamanho:** P · **Depende de:** 18.4

**O que fazer**

- Sondagem (só com autorização): modo só leitura do Codex; os dois agentes seguindo a instrução do arquivo de volta.
- ADR "Passagem de trabalho entre sessões por arquivo". README e evidências em `evidences/images/revisor/`.

**Pronto quando:** PR com ADR, README e telas.
