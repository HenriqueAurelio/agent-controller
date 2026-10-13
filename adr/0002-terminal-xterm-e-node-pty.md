# 0002 — Terminal: xterm.js + node-pty

- **Status:** Aceita
- **Data:** 2026-10-12
- **Revisão:** 2026-10-12, portable-pty (Rust) trocado por node-pty após a [ADR 0010](0010-shell-do-app-electron.md)

## Contexto

Cada sessão precisa se comportar como um cmd comum: o usuário roda qualquer agente (Claude Code, Codex, um shell puro) sem que o app precise conhecê-lo. Agentes são TUIs pesadas, com cores, cursor, redimensionamento e entrada interativa, então é preciso um pseudo-terminal de verdade e não apenas captura de stdout.

## Decisão

- No processo principal, **node-pty**, que usa ConPTY no Windows e PTY Unix no Linux atrás da mesma API.
- Na interface, **xterm.js** como emulador de terminal, com o renderer WebGL.
- A saída do PTY vai para o renderer por IPC, com buffer e backpressure.
- O histórico de cada sessão fica no processo principal (xterm headless), de modo que o terminal visual pode ser desmontado e remontado.
- Ao fechar a sessão, a árvore inteira de processos é encerrada: `taskkill /T` no Windows, sinal para o process group no Linux.

## Alternativas consideradas

- **Pipes de stdin/stdout sem PTY (`child_process`).** Quebra qualquer agente interativo.
- **Embutir um terminal externo (Windows Terminal, etc.).** Não há como fazer isso de forma portável.

## Consequências

- Qualquer programa de linha de comando funciona sem integração específica.
- O processo principal enxerga todos os bytes da sessão, o que viabiliza a detecção de estado da [ADR 0005](0005-deteccao-de-estado-em-tres-camadas.md).
- É a mesma combinação usada pelo VS Code, com muitos casos de borda já resolvidos.

## Riscos e mitigação

| Risco | Mitigação |
|---|---|
| ConPTY trata redimensionamento e algumas sequências de escape de forma diferente do Linux | Testar com o próprio Claude Code e outras TUIs pesadas nos dois sistemas desde o M1 |
| Agente em segundo plano gerando saída em volume trava a UI | Backpressure no stream e throttle para sessões não visíveis (tarefas 1.2 e 5.2) |
| Processos filhos órfãos continuam consumindo recursos após fechar a sessão | Tarefa 1.4 dedicada, com teste automatizado que verifica a árvore de processos |
| node-pty é módulo nativo e quebra a cada troca de versão do Electron | Ver [ADR 0010](0010-shell-do-app-electron.md) |
