# 0001 — Shell do app: Tauri 2

- **Status:** Substituída pela [ADR 0010](0010-shell-do-app-electron.md) em 2026-10-12. Mantida como histórico.
- **Data:** 2026-10-12

## Contexto

O produto nasce de duas dores: administrar muitas janelas e terminais de agentes ao mesmo tempo, e o consumo alto de recursos que isso causa na máquina. O administrador não pode virar mais um processo pesado. Ele precisa rodar em Windows e Linux com a mesma base de código.

## Decisão

Usar **Tauri 2**: backend em Rust e interface renderizada pelo webview do sistema (WebView2 no Windows, WebKitGTK no Linux).

## Alternativas consideradas

- **Electron.** Caminho mais batido para este tipo de app (node-pty, mesmo motor do VS Code, comportamento idêntico entre sistemas). Descartado como primeira opção porque embarca um Chromium inteiro e gasta mais memória, que é justamente a dor a resolver.
- **TUI no terminal (estilo tmux).** Mais leve de todos, mas não comporta um diff lado a lado parecido com o VS Code.
- **App nativo por plataforma.** Duas bases de código; inviável para um v1.

## Consequências

- Menor uso de RAM e instalador pequeno.
- O core (PTY, git, IPC) fica em Rust, testável sem interface.
- A equipe precisa de Rust além de TypeScript.
- A interface roda em dois motores diferentes (Chromium no Windows, WebKit no Linux), então tudo precisa ser validado nos dois.

## Riscos e mitigação

| Risco | Mitigação |
|---|---|
| O renderer WebGL do xterm.js costuma falhar no WebKitGTK | Implementar o fallback para canvas/DOM já na tarefa 1.3 e testar no Linux desde o M1 |
| Diferenças de CSS e de APIs web entre WebView2 e WebKitGTK | CI com build e teste de fumaça nos dois sistemas a partir do M0 |
| WebKitGTK ausente ou antigo em algumas distros | Declarar a dependência no .deb e oferecer AppImage |

## Critério de revisão

Se o M1 mostrar que o terminal no WebKitGTK não chega a um nível aceitável (renderização ou latência de digitação), reavaliar Electron antes de seguir para o M2. O custo de troca nesse ponto ainda é baixo.
