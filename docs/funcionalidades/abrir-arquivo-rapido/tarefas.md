# Abrir arquivo rápido: tarefas

**Pronto quando:** `Ctrl+P`, `sesmgr`, `Enter` abre `SessionManager.ts`; `nome:42` abre na linha; num repositório de 50 mil arquivos a caixa abre em menos de 500 ms; nos dois sistemas.

---

## [x] 22.1 `FileIndex`

- **Frente:** C · **Tamanho:** P · **Depende de:** nada

**O que fazer**

- `git ls-files -co --exclude-standard -z` no repositório; varredura com limite fora dele ou com ocultos.
- Vários repositórios na pasta: um índice por repositório, com o prefixo da pasta de cada um.

**Pronto quando:** testes do core com e sem git, com ocultos e com o limite.

---

## [x] 22.2 Correspondência aproximada

- **Frente:** B · **Tamanho:** P · **Depende de:** nada

**O que fazer**

- `src/renderer/src/lib/fuzzy.ts`: pontuação por início de palavra, `camelCase`, `_`, `-` e `/`; destaque das letras encontradas.

**Pronto quando:** testes da função com os casos do VS Code (`sesmgr`, `ipcts`, `s/c/git`).

---

## [x] 22.3 A caixa

- **Frente:** B · **Tamanho:** P · **Depende de:** 22.1, 22.2

**O que fazer**

- Componente no estilo da paleta; recentes e mudados quando vazia; `:linha`.
- Atalho em `shared/shortcuts.ts`; canal `files:index`.

**Pronto quando:** e2e abre um arquivo pela caixa e na linha pedida.

---

## [x] 22.4 Medição, README e evidências

- **Frente:** C · **Tamanho:** P · **Depende de:** 22.3

**O que fazer**

- Tempo e memória com 50 mil arquivos. README: "Abrir arquivo rápido". Evidências em `evidences/images/abrir-arquivo-rapido/`.

**Pronto quando:** PR com a medição, README e telas.
