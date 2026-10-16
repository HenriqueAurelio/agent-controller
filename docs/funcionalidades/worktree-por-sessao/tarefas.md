# Worktree por sessão: tarefas

**Pronto quando:** duas sessões criadas como cópias isoladas do mesmo repositório trabalham em branches diferentes, cada painel mostra só o que é seu, e fechar uma sessão com mudanças não apaga nada.

**Situação em 2026-10-16:** todas as tarefas prontas ([ADR 0017](../../../adr/0017-sessoes-em-worktree.md)). `src/core/git/WorktreeService.ts`, `SessionManager.createInWorktree` e `remove(id, { worktree })`, a base `branchBase` do `ChangesService`; testes em `tests/core/worktree.test.ts` e `tests/e2e/worktree.spec.ts`. A pasta das cópias e o comando de preparação ficaram no `sessions.json` (`AppData.worktrees`), fora da exportação.

---

## [x] 5.1 WorktreeService

- **Frente:** C · **Tamanho:** M · **Depende de:** nada

**O que fazer**

- `src/core/git/WorktreeService.ts`: `create`, `list`, `status`, `remove`, com `git worktree add -b`, `git worktree list --porcelain`, `git status --porcelain`, `git worktree remove` (sem `--force`).
- Validar o nome da branch (`git check-ref-format --branch`) e que a pasta de destino não existe.
- Erros como `UserError`.

**Pronto quando:** `tests/core/worktreeService.test.ts` com repositórios temporários: criar, listar, recusar remover com mudança, remover limpa; nomes com espaço e acento. Windows e Docker.

---

## [x] 5.2 Sessão com worktree

- **Frente:** A · **Tamanho:** M · **Depende de:** 5.1

**O que fazer**

- `Session.worktree` em `src/shared/session.ts`, validado na leitura do `sessions.json`.
- `SessionManager.create` com `{ worktree: { branch, base } }`: cria a cópia, roda o comando de preparação (se houver) pelo shell do usuário, e só então inicia o agente.
- `remove` com `{ worktree: 'keep' | 'remove' }`.
- `duplicate` de uma sessão com cópia: abre na mesma cópia (não cria outra), com aviso.

**Pronto quando:** testes do `SessionManager` para criar, falhar ao criar, fechar mantendo, fechar removendo.

---

## [x] 5.3 Comparar com a base

- **Frente:** C · **Tamanho:** P · **Depende de:** 5.2

**O que fazer**

- `ChangesService`: base nova `'branchBase'`, com `git merge-base` e `git diff <merge-base>`.
- Opção no seletor "Comparar com", só para sessões em cópia.

**Pronto quando:** teste com dois commits na branch e um arquivo sem commit.

---

## [x] 5.4 Interface

- **Frente:** B · **Tamanho:** M · **Depende de:** 5.2

**O que fazer**

- `NewSessionDialog`: caixa "Cópia isolada", nome da branch (sugerido), base.
- Topo da sessão: branch e ícone.
- Diálogo ao fechar: manter ou remover, com a lista de mudanças quando houver.
- Preferências → Sessões: pasta das cópias, comando de preparação, lista de cópias com tamanho e botão para remover.
- IPC novo validado no main: `worktrees:list`, `worktrees:remove`.

**Pronto quando:** e2e cria duas sessões isoladas, muda um arquivo em cada pelo shell falso, e cada painel mostra só o seu.

---

## [x] 5.5 ADR e README

- **Frente:** C · **Tamanho:** P · **Depende de:** 5.4

**O que fazer**

- ADR "Sessões em worktree"; README (seção "Cópia isolada"); limitações atualizadas (o app agora cria e remove worktrees, mas não faz commit nem push).

**Pronto quando:** PR com ADR, README e evidências.
