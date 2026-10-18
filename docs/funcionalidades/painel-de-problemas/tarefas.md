# Painel de problemas: tarefas

**Pronto quando:** uma rodada com erros de `tsc` e `eslint` mostra cada um na aba Problemas; o clique abre o arquivo na linha; mandar dois marcados ao agente envia só os dois; nos dois sistemas.

---

## [x] 24.1 Leitores

- **Frente:** A · **Tamanho:** M · **Depende de:** [links no terminal](../links-no-terminal/tarefas.md) 21.1

**O que fazer**

- `src/core/checks/problems.ts`: leitores por ferramenta e o genérico; escolha pelo comando.

**Pronto quando:** testes com saídas reais gravadas em `tests/core/fixtures/problems/`, de cada ferramenta, com cores e sem.

---

## [x] 24.2 Ler enquanto roda

- **Frente:** A · **Tamanho:** P · **Depende de:** 24.1

**O que fazer**

- `ToolRunner` alimenta o leitor linha a linha; `problems` no `CheckResult`, com limite de 500.

**Pronto quando:** teste com um comando que escreve 10 mil linhas: memória estável e 500 problemas.

---

## [x] 24.3 Aba Problemas

- **Frente:** B · **Tamanho:** M · **Depende de:** 24.2

**O que fazer**

- Aba no painel, agrupada por arquivo, com marcar; abrir na linha com sublinhado no editor; esmaecer quando o agente volta a trabalhar.
- Prompt de fábrica "Corrigir problemas" e a variável `{problemas}`.

**Pronto quando:** e2e com uma verificação falsa que imprime erros de tsc.

---

## [x] 24.4 README e evidências

- **Frente:** C · **Tamanho:** P · **Depende de:** 24.3

**O que fazer**

- README, dentro de "Verificações ao fim do turno". Evidências em `evidences/images/painel-de-problemas/`.

**Pronto quando:** PR com README e telas.
