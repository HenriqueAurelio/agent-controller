# Checkpoints por turno: tarefas

**Pronto quando:** depois de três turnos que mudam arquivos, a pessoa vê o que só o último mudou, volta ao fim do primeiro turno e desfaz a volta, sem que o índice, a branch e o `git log` mudem; nos dois sistemas.

---

## [ ] 14.1 Tirar a foto

- **Frente:** C · **Tamanho:** M · **Depende de:** nada

**O que fazer**

- `src/core/git/CheckpointService.ts`: `snapshot(folder, sessionId)` com índice temporário, `write-tree`, `commit-tree` e `update-ref`. Não grava nada se a árvore for igual à do checkpoint anterior.
- Limite de tamanho por arquivo, com a lista do que ficou de fora.

**Pronto quando:** teste do core num repositório temporário confere que o índice, `HEAD` e `git log` ficam iguais, e que arquivos ignorados ficam de fora.

---

## [ ] 14.2 Listar, voltar e podar

- **Frente:** C · **Tamanho:** M · **Depende de:** 14.1

**O que fazer**

- `list`, `restore` (com foto antes) e `prune` (quantidade e idade).
- Arquivos novos desde o checkpoint são removidos na volta; ignorados, nunca.
- "Repositório ocupado" como na ADR 0018.

**Pronto quando:** testes de voltar e desfazer a volta, com arquivo novo, arquivo apagado, renomeado e binário. Rodar também em `npm run test:core:docker`.

---

## [ ] 14.3 Gatilho e IPC

- **Frente:** A · **Tamanho:** P · **Depende de:** 14.2

**O que fazer**

- Foto no fim do turno que mudou arquivos, antes das verificações.
- Canais `checkpoints:*` e a `DiffBase` `checkpoint`, com o id validado no main.

**Pronto quando:** teste do `SessionManager` com o fim de turno disparando a foto uma vez só.

---

## [ ] 14.4 Linha do tempo e "Comparar com"

- **Frente:** B · **Tamanho:** M · **Depende de:** 14.3

**O que fazer**

- **O turno anterior** em "Comparar com"; o diálogo da linha do tempo com par de turnos, voltar e desfazer.
- A oferta de avisar o agente depois de voltar, pelo `terminal:sendText`.
- Poda e espaço ocupado em Preferências → Sessões; pergunta ao fechar a sessão.

**Pronto quando:** e2e com três turnos falsos: compara, volta e desfaz.

---

## [ ] 14.5 ADR, README e evidências

- **Frente:** C · **Tamanho:** P · **Depende de:** 14.4

**O que fazer**

- ADR nova, citando a 0018. README: "Linha do tempo e checkpoints", com a diferença para o `/rewind`.
- Evidências em `evidences/images/checkpoints/`.

**Pronto quando:** PR com ADR, README e telas.
