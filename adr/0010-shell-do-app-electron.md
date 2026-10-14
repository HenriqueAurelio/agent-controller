# 0010 — Shell do app: Electron

- **Status:** Aceita
- **Data:** 2026-10-12
- **Substitui:** [ADR 0001](0001-shell-do-app-tauri-2.md)

## Contexto

A [ADR 0001](0001-shell-do-app-tauri-2.md) escolheu Tauri 2 por causa do consumo de memória. Ao detalhar, dois fatos mudaram a conta:

- O time conhece apenas JavaScript/TypeScript. Tauri exige Rust para compilar e, na prática, para manter qualquer coisa além do trivial. Evitar Rust dentro do Tauri dependeria de um plugin de terminal mantido pela comunidade, justamente na peça mais crítica do produto.
- A diferença de memória é menor do que a ADR 0001 dava a entender: da ordem de 100 MB (estimativa, sem medição), enquanto os agentes em execução consomem alguns GB. No Windows, o Tauri também usa Chromium (WebView2).

## Decisão

Usar **Electron**, com todo o código em TypeScript:

- **Processo principal (Node):** PTYs, git, IPC dos hooks, persistência.
- **Renderer:** interface React, com `contextIsolation` ligado, `nodeIntegration` desligado e sandbox.
- **Preload:** expõe ao renderer uma API estreita e tipada; nenhum acesso direto a Node.
- **Empacotamento:** electron-builder (NSIS no Windows, AppImage e .deb no Linux).

## Prova: node-pty dentro do Electron empacotado

Feita em 2026-10-13 (tarefa 0.3), com Electron 44.7.0 e node-pty 1.1.0.

| Sistema | Como o binário nativo foi obtido | Resultado |
|---|---|---|
| Windows 10 | **Pré-compilado**, o que vem no pacote do node-pty (`prebuilds/win32-x64`). Nada foi compilado | O app empacotado (NSIS) abre sessões, executa comandos e roda o Claude Code e o Codex |
| Linux (Debian 12, em Docker) | **Compilado pelo `npm ci`**, porque o pacote não traz binário para Linux. Exige `build-essential` e `python3` na máquina de build | O `.deb` instalado e o conteúdo do AppImage abrem sessões e executam comandos |

O `electron-rebuild` não foi necessário em nenhum dos dois: o node-pty 1.1 é um módulo N-API, e o mesmo binário serve ao Node e ao Electron. Por isso o `electron-builder.yml` usa `npmRebuild: false`. Os binários e executáveis auxiliares do node-pty ficam fora do arquivo `asar` (`asarUnpack`).

O risco 3.3 de `DECISOES-E-RISCOS.md` não se materializou. O que resta dele: uma versão futura do node-pty que deixe de ser N-API, ou um Linux de build sem compilador.

## Alternativas consideradas

- **Tauri com lógica em Rust (ADR 0001).** Mais leve, mas o time não conseguiria manter.
- **Tauri com lógica em TypeScript e plugins.** Ainda exige o toolchain de Rust e depende de um plugin de terminal da comunidade não validado.
- **Tauri com um processo Node auxiliar (sidecar).** Soma a complexidade dos dois mundos e perde a vantagem de memória.

## Consequências

- Uma única linguagem no projeto inteiro; qualquer pessoa do time mexe em qualquer parte.
- node-pty e xterm.js são a mesma combinação usada pelo VS Code, o caminho mais testado para terminais.
- O mesmo motor (Chromium) no Windows e no Linux: some o risco de renderização no WebKitGTK.
- Cerca de 100 MB a mais de RAM e instalador em torno de 100 MB.
- A meta de memória da [ADR 0009](0009-meta-de-consumo-de-recursos.md) sobe.

## Riscos e mitigação

| Risco | Mitigação |
|---|---|
| Consumo de memória acima do esperado | Medição cedo (tarefa 5.4), um único renderer para todas as sessões, terminais não visíveis desmontados |
| node-pty é um módulo nativo: precisa ser compilado para a versão exata do Electron em cada sistema | Usar binários pré-compilados quando houver e `electron-rebuild` no CI; fixar a versão do Electron |
| Um renderer comprometido ter acesso à máquina (o app executa comandos por natureza) | `contextIsolation`, sandbox, API de preload mínima, sem carregar conteúdo remoto |
| Atualizações frequentes do Electron por correções de segurança | Fixar a versão principal e atualizar a cada marco |
| O processo principal travar com muita saída de terminal e congelar o app | Se a medição mostrar necessidade, mover os PTYs para um processo utilitário separado |
