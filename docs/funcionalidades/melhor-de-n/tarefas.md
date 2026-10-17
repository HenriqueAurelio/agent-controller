# Melhor de N: tarefas

**Pronto quando:** um experimento com três tentativas (dois Claude Code e um Codex) cria as cópias e o grupo, manda o prompt às três, compara arquivos e verificações, e "ficar com esta" deixa uma sessão e remove as outras cópias sem apagar nenhuma branch; nos dois sistemas.

---

## [ ] 17.1 `ExperimentService`

- **Frente:** A · **Tamanho:** M · **Depende de:** nada

**O que fazer**

- `src/shared/experiments.ts` e `src/core/experiments/ExperimentService.ts`: criar N cópias e sessões num grupo, enviar o prompt quando cada agente fica pronto, persistir o experimento.
- `keep(experimentId, sessionId)`: fecha as outras sessões com a remoção da cópia, respeitando as regras de hoje (não remove cópia com mudança sem commit; diz quais).

**Pronto quando:** testes do core com worktrees temporárias e um agente falso.

---

## [ ] 17.2 Comparação

- **Frente:** C · **Tamanho:** M · **Depende de:** 17.1

**O que fazer**

- `compare(experimentId)`: por tentativa, `numstat` contra a base, a lista de arquivos e o resumo das verificações.
- A união dos arquivos de todas as tentativas, para escolher o que ver lado a lado.

**Pronto quando:** testes com tentativas que mudam arquivos diferentes, e uma que não mudou nada.

---

## [ ] 17.3 IPC e diálogo de criação

- **Frente:** B · **Tamanho:** M · **Depende de:** 17.1

**O que fazer**

- Canais `experiments:*`, com validação de N (1 a 4), pasta e base.
- Diálogo **Novo experimento**, com o aviso de uso multiplicado.

**Pronto quando:** e2e cria um experimento de duas tentativas com shell falso.

---

## [ ] 17.4 Tela de comparação e "ficar com esta"

- **Frente:** B · **Tamanho:** M · **Depende de:** 17.2, 17.3

**O que fazer**

- Tabela de tentativas; diff do arquivo escolhido em cada tentativa, contra a mesma base.
- **Ficar com esta**, com confirmação e a lista das cópias que não puderam ser removidas.

**Pronto quando:** e2e compara e fica com uma tentativa.

---

## [ ] 17.5 ADR, medição, README e evidências

- **Frente:** C · **Tamanho:** P · **Depende de:** 17.4

**O que fazer**

- ADR nova. `npm run measure` com quatro tentativas.
- README: "Experimentos (melhor de N)". Evidências em `evidences/images/melhor-de-n/`.

**Pronto quando:** PR com ADR, medição, README e telas.
