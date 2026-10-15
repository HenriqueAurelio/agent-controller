# Comentar no diff: tarefas

**Pronto quando:** a pessoa comenta três linhas em dois arquivos, clica **Enviar ao agente**, confere o prompt e ele chega ao agente como uma mensagem só, com caminho e linha de cada comentário; nos dois agentes e nos dois sistemas.

---

## [ ] 3.1 Modelo e montagem do prompt

- **Frente:** A · **Tamanho:** P · **Depende de:** nada

**O que fazer**

- `src/shared/review.ts`: `ReviewComment { id, file, startLine, endLine, snippet, text, createdAt, stale }`.
- `src/core/review/prompt.ts`: `buildReviewPrompt(comments, template)`, agrupando por arquivo e ordenando por linha. Trecho de código cortado em tamanho fixo.
- Modelo de fábrica nos três idiomas em `src/shared/i18n`.

**Pronto quando:** `tests/core/reviewPrompt.test.ts` com um comentário, vários arquivos, intervalo de linhas, trecho longo e texto com crases.

---

## [ ] 3.2 ReviewStore e IPC

- **Frente:** A · **Tamanho:** M · **Depende de:** 3.1

**O que fazer**

- `src/core/review/ReviewStore.ts`: comentários por sessão, persistidos com `JsonStore` em `review/<sessionId>.json`; apagados quando a sessão é removida.
- Canais `review:list`, `review:add`, `review:update`, `review:remove`, `review:changed` (evento). Validação no main: arquivo dentro do repositório, linhas positivas, texto com limite.

**Pronto quando:** testes do core para persistência, limites e remoção junto com a sessão.

---

## [ ] 3.3 Comentar no Monaco

- **Frente:** B · **Tamanho:** M · **Depende de:** 3.2

**O que fazer**

- No iframe do diff: **+** na margem do lado direito; clique abre uma *view zone* com caixa de texto; seleção de várias linhas.
- Marcador na margem para linhas com comentário; clicar abre para editar ou apagar.
- Protocolo novo em `src/renderer/src/lib/diffProtocol.ts` entre o iframe e o painel.
- Marcar "desatualizado" quando o trecho guardado não bate mais com o texto do arquivo.

**Pronto quando:** e2e cria, edita e apaga um comentário; ele sobrevive a trocar de arquivo.

---

## [ ] 3.4 Aba Revisão

- **Frente:** B · **Tamanho:** P · **Depende de:** 3.3

**O que fazer**

- Aba no painel com a lista de comentários (arquivo, linha, texto); clicar leva ao lugar.
- Contagem no botão do painel.
- **Limpar revisão**, com confirmação.

**Pronto quando:** e2e navega pela lista até o comentário certo.

---

## [ ] 3.5 Enviar ao agente

- **Frente:** B · **Tamanho:** P · **Depende de:** 3.1, 3.4, [biblioteca de prompts](../biblioteca-de-prompts/tarefas.md) 6.2

**O que fazer**

- **Enviar ao agente** monta o prompt com `buildReviewPrompt` e manda pelo `terminal:sendText` (colagem em bloco, enviar quando terminar, "Enviar com Enter" já existem).
- Diálogo de pré-visualização, editável. Comentários descartados depois de enviar.

**Pronto quando:** e2e com o shell falso dos testes recebe o prompt da revisão entre os marcadores de bracketed paste.

---

## [ ] 3.6 Smoke com os agentes reais (só com autorização)

- **Frente:** C · **Tamanho:** P · **Depende de:** 3.5

**O que fazer**

- Roteiro em `tests/smoke`: o agente cria um arquivo, a revisão comenta duas linhas, envia, o agente aplica. Conferir que chegou como uma mensagem.

**Pronto quando:** resultado gravado em `tools/agent-probe/results/` para Claude Code e Codex.

---

## [ ] 3.7 README e evidências

- **Frente:** C · **Tamanho:** P · **Depende de:** 3.5

**O que fazer**

- README: seção "Revisar e pedir ajustes".
- Evidências na pasta `evidences/images/revisao/`.

**Pronto quando:** PR com ADR, README e telas.
