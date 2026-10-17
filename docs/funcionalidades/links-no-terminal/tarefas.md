# Links no terminal: tarefas

**Pronto quando:** `Ctrl+clique` em `src/x.ts:12:3` no terminal do agente abre o arquivo na linha 12, um caminho de fora da pasta não vira link, e `http://localhost:3000` abre o navegador; nos dois sistemas.

---

## [x] 21.1 `findLocations`

- **Frente:** A · **Tamanho:** P · **Depende de:** nada

**O que fazer**

- `src/shared/locations.ts`: os formatos acima, com posições na linha.

**Pronto quando:** `tests/core/locations.test.ts` com saídas reais de tsc, eslint, vitest, pytest, cargo e go, e caminhos de Windows e Linux.

---

## [x] 21.2 `files:locate`

- **Frente:** A · **Tamanho:** P · **Depende de:** 21.1

**O que fazer**

- Resolver relativo à pasta da sessão; recusar o que sai dela (inclusive por link simbólico); devolver o caminho relativo e se é arquivo.

**Pronto quando:** testes com `..`, link simbólico, nome curto 8.3 (`it.runIf` no Windows) e maiúsculas trocadas.

---

## [x] 21.3 Provedor de links e abrir na linha

- **Frente:** B · **Tamanho:** M · **Depende de:** 21.2

**O que fazer**

- `registerLinkProvider` nos terminais do agente e auxiliar, com `Ctrl` (`Cmd` não se aplica: Windows e Linux).
- Abrir o painel em "Arquivos" com `revealLine`; links também na saída das verificações.

**Pronto quando:** e2e com o shell falso imprimindo um caminho: o clique abre o arquivo na linha.

---

## [x] 21.4 README e evidências

- **Frente:** C · **Tamanho:** P · **Depende de:** 21.3

**O que fazer**

- README, em "Atalhos" e "Ver o que o agente alterou". Evidências em `evidences/images/links-no-terminal/`.

**Pronto quando:** PR com README e telas.
