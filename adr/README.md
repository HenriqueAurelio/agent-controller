# Architecture Decision Records

Registro das decisões de arquitetura do agent-controller. Cada arquivo traz o contexto, a decisão, as alternativas descartadas, as consequências e os riscos ligados àquela decisão.

| # | Decisão | Status |
|---|---|---|
| [0001](0001-shell-do-app-tauri-2.md) | Shell do app: Tauri 2 | Substituída pela 0010 |
| [0002](0002-terminal-xterm-e-node-pty.md) | Terminal: xterm.js + node-pty | Aceita |
| [0003](0003-ui-react-typescript-vite.md) | UI: React + TypeScript + Vite | Aceita |
| [0004](0004-diff-monaco-e-git-cli.md) | See changes: Monaco diff + binário git | Aceita |
| [0005](0005-deteccao-de-estado-em-tres-camadas.md) | Detecção de "terminou" e "tem dúvida" em três camadas | Aceita |
| [0006](0006-persistencia-json-sem-daemon.md) | Persistência em JSON, sem daemon | Aceita |
| [0007](0007-escopo-do-v1.md) | Escopo do v1 | Aceita |
| [0008](0008-teste-em-linux-docker-e-wsl2.md) | Teste em Linux: Docker + WSL2 | Aceita |
| [0009](0009-meta-de-consumo-de-recursos.md) | Meta de consumo de recursos | Aceita |
| [0010](0010-shell-do-app-electron.md) | Shell do app: Electron | Aceita |
| [0011](0011-perfis-de-agente.md) | Perfis de agente: Claude Code e Codex | Aceita |

## Status

- **Proposta**: recomendada, aguardando confirmação.
- **Aceita**: em vigor.
- **Substituída**: trocada por outra ADR (indicar qual).

## Nova ADR

Copie a estrutura de uma existente, use o próximo número e adicione a linha na tabela acima. Uma ADR aceita não é editada para inverter a decisão: cria-se uma nova que a substitui. Ajustes que apenas acompanham outra decisão são feitos no próprio arquivo, com uma linha de **Revisão** no cabeçalho.
