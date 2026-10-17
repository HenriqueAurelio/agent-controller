# Abrir no editor externo: tarefas

**Pronto quando:** com o VS Code escolhido, o botão abre a pasta da sessão e o arquivo do painel na linha do cursor; com Zed e com um comando "Outro" também; nos dois sistemas e no WSL2.

---

## [x] 23.1 Perfis e detecção

- **Frente:** A · **Tamanho:** P · **Depende de:** nada

**O que fazer**

- `src/core/tools/externalEditor.ts`: perfis de VS Code, Cursor, Zed e Windsurf; detecção no `PATH`; montagem dos argumentos.
- Windows: `.cmd` por `cmd.exe` com escape; Linux: execução direta.

**Pronto quando:** testes da montagem de argumentos com espaço, acento e `&`, nos dois sistemas (`it.runIf`).

---

## [x] 23.2 Preferência e IPC

- **Frente:** A · **Tamanho:** P · **Depende de:** 23.1

**O que fazer**

- `externalEditor` em `shared/prefs.ts`, fora da exportação quando for "Outro".
- Canais `editor:detect` e `editor:open`, com o caminho validado.

**Pronto quando:** testes de validação.

---

## [x] 23.3 Botões e atalho

- **Frente:** B · **Tamanho:** P · **Depende de:** 23.2

**O que fazer**

- Botão no topo da sessão e no painel; `Ctrl+Alt+O`; aba em Preferências com o que foi detectado.

**Pronto quando:** e2e com um editor falso (um script que grava os argumentos que recebeu).

---

## [x] 23.4 README e evidências

- **Frente:** C · **Tamanho:** P · **Depende de:** 23.3

**O que fazer**

- README: "Abrir no editor externo", com a nota do WSL2. Evidências em `evidences/images/editor-externo/`.

**Pronto quando:** PR com README e telas.
