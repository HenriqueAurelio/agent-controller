# Responder sem abrir a sessão: tarefas

**Pronto quando:** com duas sessões pedindo permissão, a pessoa permite uma e nega a outra pela barra lateral, sem abrir nenhuma, e os dois agentes seguem como se ela tivesse digitado; nos dois agentes e nos dois sistemas.

---

## [ ] 12.1 Sondagem: o pedido e as teclas de cada agente (só com autorização)

- **Frente:** A · **Tamanho:** P · **Depende de:** nada

**O que fazer**

- Em `tools/agent-probe`, gravar o payload de `PermissionRequest` do Claude Code e do Codex para Bash, Edit e uma ferramenta MCP.
- Anotar as teclas de cada opção do menu e se a tela muda entre a versão testada e a atual.
- Testar a decisão pelo próprio hook do Claude Code e anotar o que o terminal mostra enquanto o hook espera.

**Pronto quando:** resultado em `tools/agent-probe/results/`, com a escolha entre tecla e hook escrita na ADR.

---

## [ ] 12.2 `PermissionAsk` no adaptador

- **Frente:** A · **Tamanho:** M · **Depende de:** 12.1

**O que fazer**

- `src/shared/session.ts`: `PermissionAsk { id, tool, target, choices }`.
- `ClaudeAdapter` e `CodexAdapter` montam o pedido a partir do hook; o alvo vem de `tool_input` (comando, `file_path`, nome da ferramenta MCP), sempre cortado.
- As teclas de cada escolha ficam no perfil do agente (`profiles.ts`).

**Pronto quando:** testes do core para Bash, Edit, MCP e um payload sem `tool_input`.

---

## [ ] 12.3 Responder no `SessionManager`

- **Frente:** A · **Tamanho:** M · **Depende de:** 12.2

**O que fazer**

- O pedido aberto de cada sessão é descartado quando o estado sai de "aguardando" ou chega outro.
- `answerPermission(sessionId, askId, choice)`: confere o `askId` e a tela (`ScreenHistory`) e só então escreve. Devolve `answered`, `stale` ou `unsupported`.
- Canal `sessions:answerPermission`, com validação no main e o erro como `UserError` com chave de i18n.

**Pronto quando:** testes com pedido velho, pedido trocado e tela que não mostra mais o menu.

---

## [ ] 12.4 Barra lateral e atalhos

- **Frente:** B · **Tamanho:** M · **Depende de:** 12.3

**O que fazer**

- Segunda linha na sessão com ferramenta, alvo, **✓** e **✕**; `Alt+Y` e `Alt+N` na sessão focada (editáveis em Preferências → Atalhos).
- Aviso "O pedido mudou" quando a resposta volta `stale`.
- Preferência para desligar os botões.

**Pronto quando:** e2e com um shell falso que imita o menu recebe a tecla certa, e não recebe nada depois que o pedido muda.

---

## [ ] 12.5 Ações na notificação

- **Frente:** C · **Tamanho:** P · **Depende de:** 12.3

**O que fazer**

- `src/main/notifications.ts`: botões **Permitir** e **Negar** onde o sistema suporta; sem suporte, o comportamento de hoje.

**Pronto quando:** testado à mão no Windows e no Linux (GNOME), com o resultado no PR.

---

## [ ] 12.6 Smoke, README e evidências

- **Frente:** C · **Tamanho:** P · **Depende de:** 12.4, 12.5

**O que fazer**

- Roteiro de smoke com os dois agentes reais (só com autorização).
- README: "Responder a um pedido sem abrir a sessão". Evidências em `evidences/images/responder-sem-abrir/`.

**Pronto quando:** PR com ADR, README e telas.
