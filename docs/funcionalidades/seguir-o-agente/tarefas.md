# Seguir o agente: tarefas

**Pronto quando:** com **Seguir** ligado, o painel abre cada arquivo que o agente edita, no trecho mudado, e pausa quando a pessoa clica em outro arquivo; no Claude Code pelo hook, no Codex pela reserva; nos dois sistemas.

---

## [ ] 26.1 Sondagem (só com autorização)

- **Frente:** A · **Tamanho:** P · **Depende de:** nada

**O que fazer**

- Gravar o `PostToolUse` do Claude Code para as ferramentas de edição; procurar no Codex um hook que diga o arquivo do `apply_patch`.

**Pronto quando:** resultado em `tools/agent-probe/results/`.

---

## [ ] 26.2 `edited(file)` nos adaptadores

- **Frente:** A · **Tamanho:** M · **Depende de:** 26.1

**O que fazer**

- `PostToolUse` no `--settings` do Claude Code; leitura no `ClaudeAdapter`.
- Reserva pelo `RepoWatcher` durante "Trabalhando", ignorando o que o `.gitignore` cobre.
- Evento `session:edited`.

**Pronto quando:** testes do core com os payloads da sondagem e com a reserva.

---

## [ ] 26.3 Seguir no painel

- **Frente:** B · **Tamanho:** M · **Depende de:** 26.2

**O que fazer**

- Botão **Seguir**; troca de arquivo com espera de um segundo; `revealRange` e destaque; pausa com interação ou com algo não salvo; **Voltar a seguir**.

**Pronto quando:** e2e com o shell falso escrevendo em três arquivos: o painel segue, pausa no clique e retoma.

---

## [ ] 26.4 ADR, smoke, README e evidências

- **Frente:** C · **Tamanho:** P · **Depende de:** 26.3

**O que fazer**

- ADR do hook novo. Smoke com os dois agentes (só com autorização).
- README: "Seguir o agente". Evidências em `evidences/images/seguir-o-agente/`.

**Pronto quando:** PR com ADR, README e telas.
