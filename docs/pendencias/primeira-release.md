# Primeira release: instalar em máquina limpa e publicar

Fecha a **tarefa 6.1**.

## Como está

- A tag `v0.1.0` foi criada em 2026-10-13 a partir da branch `v1`. O workflow `.github/workflows/release.yml` rodou com sucesso no Windows e no Ubuntu: testes do core, empacotamento e os e2e no app empacotado.
- Ele criou uma release **em rascunho** com os três instaladores: `agent-controller-0.1.0-setup.exe`, `agent-controller-0.1.0.AppImage` e `agent-controller-0.1.0.deb`.
- O `.deb` já foi instalado e testado em Docker; o instalador do Windows foi gerado e o app dele testado nesta máquina, que não é uma máquina limpa.

## O que falta

1. Em `github.com/HenriqueAurelio/agent-controller/releases`, baixar os instaladores do rascunho.
2. **Windows limpo** (sem Node nem o repositório): rodar o `setup.exe`, passar pelo aviso de aplicativo não reconhecido, abrir o app, criar uma sessão e ver o terminal do agente.
3. **Linux limpo:** o mesmo com o `.deb` e com o AppImage. Coincide com os passos 1 e 2 de [`validacao-no-linux-real.md`](validacao-no-linux-real.md).
4. Se tudo abrir, publicar o rascunho. Se a branch `v1` ainda não estiver na `main`, fazer o merge antes.

Para acompanhar execuções pelo terminal, sem o `gh`: `bash tools/ci-status.sh <branch ou tag>`.

## Feito quando

Os três instaladores da release instalam em máquina limpa e abrem um terminal, e a tarefa 6.1 está marcada em `tasks/M6-empacotamento.md`.
