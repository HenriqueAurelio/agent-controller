# Architecture Decision Records

Registro das decisões de arquitetura do agent-controller. Cada arquivo traz o contexto, a decisão, as alternativas descartadas, as consequências e os riscos ligados àquela decisão.

| # | Decisão | Status |
|---|---|---|
| [0001](0001-shell-do-app-tauri-2.md) | Shell do app: Tauri 2 | Substituída pela 0010 |
| [0002](0002-terminal-xterm-e-node-pty.md) | Terminal: xterm.js + node-pty | Aceita |
| [0003](0003-ui-react-typescript-vite.md) | UI: React + TypeScript + Vite | Aceita |
| [0004](0004-diff-monaco-e-git-cli.md) | See changes: Monaco diff + binário git | Aceita, emendada pela 0012 e pela 0019 |
| [0005](0005-deteccao-de-estado-em-tres-camadas.md) | Detecção de "terminou" e "tem dúvida" em três camadas | Aceita |
| [0006](0006-persistencia-json-sem-daemon.md) | Persistência em JSON, sem daemon | Aceita |
| [0007](0007-escopo-do-v1.md) | Escopo do v1 | Aceita, emendada pela 0013, pela 0014, pela 0016 e pela 0019 |
| [0008](0008-teste-em-linux-docker-e-wsl2.md) | Teste em Linux: Docker + WSL2 | Aceita |
| [0009](0009-meta-de-consumo-de-recursos.md) | Meta de consumo de recursos | Aceita |
| [0010](0010-shell-do-app-electron.md) | Shell do app: Electron | Aceita |
| [0011](0011-perfis-de-agente.md) | Perfis de agente: Claude Code e Codex | Aceita, emendada pela 0013 |
| [0012](0012-see-changes-permite-editar.md) | "See changes" permite editar o arquivo | Aceita, emendada pela 0014 e pela 0017; a parte das operações de git foi substituída pela 0018 |
| [0013](0013-comando-do-usuario-no-lugar-do-agente.md) | Comando do usuário no lugar do executável do agente | Aceita |
| [0014](0014-verificacoes-ao-fim-do-turno.md) | Verificações do projeto ao fim do turno | Aceita, emendada pela 0015 |
| [0015](0015-app-escreve-no-terminal-a-pedido.md) | O app escreve no terminal do agente a pedido do usuário | Aceita, ampliada pela 0020 e revista pela fila de prompts |
| [0016](0016-terminal-auxiliar.md) | Terminal auxiliar ao lado do agente | Aceita |
| [0017](0017-sessoes-em-worktree.md) | Sessões em worktree | Aceita |
| [0018](0018-operacoes-de-git-no-painel.md) | Operações de git no painel de mudanças | Aceita |
| [0019](0019-realce-textmate-e-temas.md) | Realce TextMate e temas de cores no painel de mudanças | Aceita |
| [0020](0020-responder-permissao-fora-do-terminal.md) | Responder ao pedido de permissão fora do terminal | Aceita |
| [0021](0021-refs-proprias-no-repositorio.md) | O app grava refs próprias no repositório do usuário (checkpoints por turno; revê a 0018) | Aceita |
| [0022](0022-experimentos-melhor-de-n.md) | Experimentos: o mesmo pedido em várias cópias (melhor de N) | Aceita |
| [0023](0023-passagem-de-trabalho-por-arquivo.md) | Passagem de trabalho entre sessões por arquivo (o revisor automático) | Aceita |
| [0024](0024-regras-que-enviam-sozinhas.md) | Regras que enviam sozinhas (encadear sessões) | Aceita |
| [0025](0025-tarefas-como-origem-das-sessoes.md) | Tarefas como origem das sessões (quadro de tarefas) | Aceita |
| [0026](0026-core-em-processo-proprio.md) | Core em processo próprio (sessões que sobrevivem à janela) | Proposta |

## Status

- **Proposta**: recomendada, aguardando confirmação.
- **Aceita**: em vigor.
- **Substituída**: trocada por outra ADR (indicar qual).

## Nova ADR

Copie a estrutura de uma existente, use o próximo número e adicione a linha na tabela acima. Uma ADR aceita não é editada para inverter a decisão: cria-se uma nova que a substitui. Ajustes que apenas acompanham outra decisão são feitos no próprio arquivo, com uma linha de **Revisão** no cabeçalho.
