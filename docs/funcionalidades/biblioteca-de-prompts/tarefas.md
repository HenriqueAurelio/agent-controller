# Biblioteca de prompts: tarefas

**Pronto quando:** um prompt com `{arquivo}` e `{?pergunta}` sai da paleta preenchido e chega ao agente como uma mensagem só; o mesmo prompt chega a três sessões, cada uma com as suas variáveis, e a que estava trabalhando recebe quando termina.

**Depende de:** nada. A tarefa 6.2 cria o envio ao terminal que [verificações ao fim do turno](../verificacoes-pos-turno/tarefas.md) e [comentar no diff](../comentar-no-diff/tarefas.md) reaproveitam.

---

## [x] 6.1 Modelo, preferências e expansão

- **Frente:** A · **Tamanho:** P · **Depende de:** nada

**O que fazer**

- `src/shared/prompts.ts`: `PromptTemplate { id, name, text }`; `prompts` nas preferências, sanitizado, com limite de quantidade e tamanho; entra na exportação (é texto, não executa nada).
- `src/core/prompts/expand.ts`: `{sessao}`, `{pasta}`, `{branch}`, `{arquivo}`, `{selecao}`; `{?pergunta}` devolvida como lista de campos a preencher; variável desconhecida mantida como está.
- Três prompts de fábrica, nos três idiomas.

**Pronto quando:** `tests/core/promptExpand.test.ts`.

---

## [x] 6.2 Enviar texto ao terminal do agente

- **Frente:** A · **Tamanho:** M · **Depende de:** nada

**O que fazer**

- `terminal:sendText(sessionIds[], { templateId, values } | { text }, { submit })` em `src/shared/ipc.ts` e `src/main/ipc.ts`, validado no main (sessões existentes, tamanho máximo).
- Escrita no PTY com bracketed paste; `submit` acrescenta o Enter. (Feito como na ADR 0014: uma linha só, com `⏎`; o Enter vai 200 ms depois.)
- Fila "enviar quando terminar" por sessão, solta pela transição de estado; cancelável; pendência no estado da sessão (`pendingSend`).
- Expansão por sessão, no main.

**Pronto quando:** teste do core com três sessões em estados diferentes (uma recebe na hora, uma espera o turno, uma é cancelada); teste dos marcadores de bracketed paste no texto escrito.

---

## [x] 6.3 Interface

- **Frente:** B · **Tamanho:** M · **Depende de:** 6.1, 6.2

**O que fazer**

- Preferências → Prompts: lista, editar, criar, apagar, restaurar de fábrica. Preferência "Enviar com Enter".
- Paleta: "Prompt: {nome}"; diálogo de pré-visualização com os campos das `{?perguntas}` e as sessões de destino.
- Menu de contexto do editor do painel: "Mandar ao agente com o prompt…".
- Seleção múltipla na barra lateral (`Ctrl+clique`) e "Enviar prompt às selecionadas".
- Marca de envio pendente na sessão, com cancelar.
- Ação de atalho por prompt em `src/shared/shortcuts.ts`.
- Textos em pt-BR, en e es.

**Pronto quando:** e2e com o shell falso recebe o texto expandido, entre os marcadores, em três sessões.

---

## [ ] 6.4 Smoke com os agentes reais (só com autorização)

- **Frente:** C · **Tamanho:** P · **Depende de:** 6.2

**O que fazer**

- Roteiro em `tests/smoke`: enviar um prompt de três linhas e conferir que o agente recebeu uma mensagem só; enviar com o agente trabalhando e conferir que saiu depois do turno.

**Pronto quando:** resultado gravado em `tools/agent-probe/results/` para Claude Code e Codex.

**Situação:** o roteiro está em `tests/smoke/prompts.smoke.ts`; ainda não rodou, porque usa a conta e os créditos do usuário.

---

## [x] 6.5 ADR e README

- **Frente:** C · **Tamanho:** P · **Depende de:** 6.3

**O que fazer**

- ADR "O app escreve no terminal do agente a pedido do usuário": só por ação explícita, sem Enter de fábrica, com a fila de espera.
- README: seção "Prompts guardados"; item em "Exportar e importar" (os prompts vão no arquivo).

**Pronto quando:** PR com ADR, README e evidências.
