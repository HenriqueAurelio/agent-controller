# Operações de git no painel: tarefas

**Pronto quando:** a pessoa marca dois de três arquivos, faz commit com uma mensagem, descarta o terceiro e o recupera com Desfazer, sem sair do app.

**Antes de tudo:** decidir se a ADR 0012 é revista (proposta completa) ou se entra só o stage (tarefas 9.1 e 9.3).

---

## [ ] 9.1 GitWriteService: stage e unstage

- **Frente:** C · **Tamanho:** P · **Depende de:** a decisão acima

**O que fazer**

- `src/core/git/GitWriteService.ts` com `stage(files)`, `unstage(files)`, separado do `GitService`.
- `ChangesService` passa a informar o que está em stage (o `--porcelain=v2` já traz).

**Pronto quando:** testes com repositório temporário: arquivo novo, modificado, removido, renomeado; nome com espaço e acento. Windows e Docker.

---

## [ ] 9.2 Commit e descartar com cópia

- **Frente:** C · **Tamanho:** M · **Depende de:** 9.1

**O que fazer**

- `commit(message)` com a mensagem pelo stdin; hooks do repositório rodam; prazo.
- `discard(file)`: copia o arquivo atual para `descartados/<data>/<caminho>` e então restaura (ou remove, se não rastreado); `undoDiscard(id)` devolve a cópia.
- Limpeza das cópias com mais de 30 dias ao iniciar o app.

**Pronto quando:** testes de descartar e desfazer, inclusive arquivo não rastreado e arquivo binário; commit com hook que falha.

---

## [ ] 9.3 IPC e interface

- **Frente:** B · **Tamanho:** M · **Depende de:** 9.1 (9.2 para commit e descartar)

**O que fazer**

- Canais `git:stage`, `git:unstage`, `git:commit`, `git:discard`, `git:undoDiscard`, validados no main.
- Lista do painel: caixa de stage por arquivo, separação "em stage" / "fora".
- Rodapé: mensagem e **Commit**, com a lista do que entra.
- Menu do arquivo: **Descartar mudanças**, confirmação, aviso com **Desfazer**.
- Confirmação extra com o agente trabalhando.

**Pronto quando:** e2e do cenário completo do "pronto quando" acima.

---

## [ ] 9.4 ADR, README e DECISOES-E-RISCOS

- **Frente:** C · **Tamanho:** P · **Depende de:** 9.3

**O que fazer**

- ADR que substitui a parte da 0012; item 2.2 de `DECISOES-E-RISCOS.md`; limitações do README.

**Pronto quando:** PR com ADR, README e evidências.
