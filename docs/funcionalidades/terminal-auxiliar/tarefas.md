# Terminal auxiliar: tarefas

**Pronto quando:** numa sessão com o agente trabalhando, o atalho abre um shell na mesma pasta, ele roda comandos sem interferir no agente, e fechar a sessão encerra os dois; nos dois sistemas e dentro da meta de memória.

---

## [ ] 8.1 PTY auxiliar no core

- **Frente:** A · **Tamanho:** M · **Depende de:** nada

**O que fazer**

- `SessionManager.openAux(sessionId)` / `closeAux`: PTY com o shell do usuário (a mesma resolução do comando do agente), na pasta da sessão, sem adaptador.
- Encerrar com `killTree` ao fechar o auxiliar, a sessão ou o app.
- `changeFolder` fecha o auxiliar (ele está na pasta antiga), com aviso.

**Pronto quando:** testes do core: abre, recebe entrada, fecha, morre junto com a sessão. Windows e Docker.

---

## [ ] 8.2 IPC

- **Frente:** A · **Tamanho:** P · **Depende de:** 8.1

**O que fazer**

- `terminal:*` aceitam o id do auxiliar; o main recusa ids que não existem.
- Canais `aux:open`, `aux:close`; estado `auxOpen` na sessão.

**Pronto quando:** teste de validação dos ids.

---

## [ ] 8.3 Interface

- **Frente:** B · **Tamanho:** M · **Depende de:** 8.2

**O que fazer**

- Segundo terminal no `TerminalArea`, com divisória arrastável; posição no editor de layout (embaixo ou ao lado).
- Atalho novo em `src/shared/shortcuts.ts`; botão no topo da sessão; comando na paleta.
- Rótulo e borda distintos; foco visível.

**Pronto quando:** e2e abre o auxiliar, roda `echo` e confere a saída, e o terminal do agente não recebe nada.

---

## [ ] 8.4 Medição, ADR e README

- **Frente:** C · **Tamanho:** P · **Depende de:** 8.3

**O que fazer**

- `npm run measure` com 10 sessões e um auxiliar; resultado na ADR 0009 se mudar a tabela.
- ADR; README (seção "Terminal auxiliar", tabela de atalhos, limitações).

**Pronto quando:** PR com medição, ADR, README e evidências.
