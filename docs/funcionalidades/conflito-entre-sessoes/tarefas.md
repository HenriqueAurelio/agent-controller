# Conflito entre sessões: tarefas

**Pronto quando:** duas sessões em cópias diferentes do mesmo repositório mudam o mesmo arquivo, e as duas mostram o aviso; com o mesmo trecho, o aviso diz "provável conflito"; nos dois sistemas.

---

## [ ] 15.1 `OverlapService`

- **Frente:** C · **Tamanho:** M · **Depende de:** nada

**O que fazer**

- Agrupar sessões por `--git-common-dir`; cruzar arquivos mudados (sem commit e desde a base).
- Sobreposição de hunks com `git diff -U0` nos arquivos em comum.
- Lista de arquivos ignorados pelo aviso.

**Pronto quando:** testes do core com duas worktrees: mesmo arquivo, mesmo trecho, trechos diferentes, lockfile e caminho com maiúsculas trocadas no Windows (`it.runIf`). Rodar também em `npm run test:core:docker`.

---

## [ ] 15.2 Gatilho e IPC

- **Frente:** A · **Tamanho:** P · **Depende de:** 15.1

**O que fazer**

- Recalcular no aviso do `RepoWatcher` e no fim do turno, com teto de frequência por repositório.
- `overlaps` no `SessionView`; canal `git:overlaps`.

**Pronto quando:** teste com relógio falso confere o teto de frequência.

---

## [ ] 15.3 Interface

- **Frente:** B · **Tamanho:** P · **Depende de:** 15.2

**O que fazer**

- **⚠ n** na barra lateral; marca no arquivo do painel com a outra sessão e o atalho para abrir.
- Preferências: ligar e desligar, contar sessões paradas, arquivos ignorados.

**Pronto quando:** e2e com duas sessões em worktrees de um repositório de teste.

---

## [ ] 15.4 README, medição e evidências

- **Frente:** C · **Tamanho:** P · **Depende de:** 15.3

**O que fazer**

- `npm run measure` com 10 sessões no mesmo repositório, comparado com a `main`.
- README, dentro de "Cópia isolada". Evidências em `evidences/images/conflito-entre-sessoes/`.

**Pronto quando:** PR com a medição, README e telas.
