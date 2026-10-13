# Agentes reais no Linux (WSL)

Fecha a **tarefa 0.4**: repetir no Linux, com o Claude Code e o Codex de verdade, o que já passa no Windows.

## Como está

O Ubuntu 24.04 do WSL desta máquina foi preparado em 2026-10-13 com `tools/wsl-setup.sh`:

- Node 22, compilador e as bibliotecas que o Electron precisa.
- Claude Code 2.1.296 e Codex CLI 0.162.1, instalados em `~/.local/bin`.
- O repositório em `~/src/agent-controller` (branch `v1`), com as dependências instaladas e os 221 testes do core passando.

O roteiro com o Claude Code real já foi tentado lá: ele abre o agente e passa da pergunta de confiança na pasta, mas todo prompt volta com **"Login expired · Please run /login"**. O Codex não está logado.

## O que falta: o login

Só você pode fazer. Abra o Ubuntu do WSL e rode:

```bash
claude        # dentro dele, digite /login e conclua no navegador; depois saia com /exit
codex login   # conclua no navegador
```

## Depois do login

```bash
cd ~/src/agent-controller
git pull
npm ci
npm run test:smoke
```

São três roteiros por agente (fim de turno, pedido de permissão, cancelamento). Usam a sua conta e gastam alguns turnos curtos. O resultado fica em `tools/agent-probe/results/`, um arquivo por agente, versão e sistema, e precisa ser commitado.

Para o app inteiro, com janela (o WSLg abre a janela):

```bash
npm run build && npm run test:smoke:app
```

## O que observar

- **Codex 0.162.1 é mais novo que a versão testada (0.158.0).** O app deve avisar isso no diálogo de nova sessão, sem bloquear. Se algum roteiro do Codex falhar, a causa mais provável é uma mudança no título da janela ou no texto do turno interno de título; os dois são dados em `src/core/agents/profiles.ts` e `codexAdapter.ts`.
- **O hook `Stop` do Codex** em um turno interativo que termina sozinho nunca foi observado. O relatório lista os hooks recebidos em `hookEvents`.
- Qualquer diferença em relação ao Windows vai para a tabela "Linux" da [ADR 0011](../../adr/0011-perfis-de-agente.md) e vira ajuste no adaptador correspondente.

## Feito quando

Os dois arquivos de resultado do Linux existem com `"ok": true`, a ADR 0011 tem a linha dos agentes reais no Linux preenchida, e a tarefa 0.4 está marcada em `tasks/M0-fundacao-e-provas.md`.
