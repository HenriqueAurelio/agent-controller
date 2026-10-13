# Primeira release pelo CI

Fecha a **tarefa 6.1**: os três instaladores (NSIS, AppImage e `.deb`) saindo do CI a cada tag.

## Como está

- Os três instaladores já foram gerados e testados localmente: o do Windows nesta máquina, os do Linux em Docker.
- O workflow `.github/workflows/release.yml` gera os instaladores a cada tag `v*`, roda os testes neles e anexa tudo a uma release em rascunho. **Ele nunca rodou**, porque nenhuma tag foi criada.
- O workflow `ci.yml`, que roda em todo push, também empacota e publica os instaladores como artefatos da execução. Ele já passou na branch `v1`, nos dois sistemas.

## O que fazer

O CI da branch `v1` já está verde. Com o código na `main`:

```bash
git tag v0.1.0
git push origin v0.1.0
```

Depois, em `github.com/HenriqueAurelio/agent-controller/releases`, conferir que a release em rascunho tem os três arquivos, baixar e instalar em uma máquina limpa de cada sistema.

Para acompanhar pelo terminal, sem o `gh`: `bash tools/ci-status.sh` mostra as últimas execuções e os passos que falharam, usando a credencial que o git já tem.

## Feito quando

Os três instaladores saem do CI, instalam em máquina limpa e abrem um terminal, e a tarefa 6.1 está marcada em `tasks/M6-empacotamento.md`.
