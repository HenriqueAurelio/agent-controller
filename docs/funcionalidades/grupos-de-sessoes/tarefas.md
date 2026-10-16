# Grupos de sessões: tarefas

**Pronto quando:** a pessoa cria o grupo `XXX-REPO` com as sessões do repositório, recolhe, move sessões para dentro e para fora (arrastando, pela paleta e pelo teclado), cria uma sessão nova já no grupo, e tudo volta igual depois de reabrir o app.

---

## [x] 10.1 Modelo, core e persistência

- **Frente:** A · **Tamanho:** P · **Depende de:** nada

**O que fazer**

- `SessionGroup` e `Session.groupId` em `src/shared/session.ts`; `NewSessionInput.groupId`.
- `SessionManager`: `createGroup`, `updateGroup` (nome, recolhido, sessões exatas), `removeGroup` (as sessões ficam), `reorderGroups`, `setGroup`; a ordem da lista mantém as sessões de cada grupo juntas; `duplicate` mantém o grupo.
- `AppData.groups`, validado na leitura (`sanitizeGroups`), e `groupId` de grupo desconhecido descartado.

**Pronto quando:** testes em `tests/core/sessionManager.test.ts` (grupos) e `tests/core/store.test.ts`.

---

## [x] 10.2 IPC

- **Frente:** A · **Tamanho:** P · **Depende de:** 10.1

**O que fazer**

- `sessions:setGroup`, `groups:create`, `groups:update`, `groups:remove`, `groups:reorder` no tipo, na lista e no handler, com os argumentos validados no main.
- `SessionsSnapshot.groups`.

**Pronto quando:** `npm run typecheck` e o e2e da 10.3.

---

## [x] 10.3 Interface

- **Frente:** B · **Tamanho:** M · **Depende de:** 10.2

**O que fazer**

- Barra lateral: cabeçalho de grupo (recolher, contagem, aguardando, **+**, **✎**, **×**), arrastar sessões e grupos, faixa para tirar do grupo, teclado; layouts em cima e embaixo.
- `GroupDialog`: nome e sessões, com sugestão a partir da pasta da sessão aberta.
- `NewSessionDialog`: campo **Grupo**. Paleta: novo grupo, editar grupo, mover e tirar a sessão.
- Textos em pt-BR, en e es.

**Pronto quando:** `tests/e2e/groups.spec.ts`.

---

## [x] 10.4 README e evidências

- **Frente:** C · **Tamanho:** P · **Depende de:** 10.3

**O que fazer**

- Seção "Grupos de sessões" no README; atalhos da barra lateral atualizados.
- Evidências em `tests/e2e/evidences.spec.ts` (`grupos/`).

**Pronto quando:** PR com as evidências antes × depois.
