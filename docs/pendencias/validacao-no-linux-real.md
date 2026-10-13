# Validação na máquina Linux real

Fecha a **tarefa 6.3**, que não pode ser cortada. O Docker e o WSL já cobrem quase tudo; esta validação existe para o que eles não mostram: notificações do sistema, foco de janela, instaladores em uma máquina de verdade e a memória com placa de vídeo.

## O que levar

Os instaladores saem do CI a cada tag (ver [`primeira-release.md`](primeira-release.md)). Enquanto não há tag, dá para gerar na própria máquina Linux:

```bash
sudo bash tools/wsl-setup.sh system   # compilador, bibliotecas e Node 22
bash tools/wsl-setup.sh user          # Claude Code e Codex
npm ci && npm run dist                # gera dist/*.deb e dist/*.AppImage
```

Os dois agentes precisam estar logados nessa máquina (`claude` e `/login`; `codex login`).

## Roteiro

1. **Instalar o `.deb`** (`sudo apt install ./agent-controller-<versão>.deb`) e abrir o app pelo menu do sistema. Conferir ícone e nome.
2. **Rodar o AppImage** (`chmod +x` e executar). No Docker ele só foi testado extraído, porque contêiner não tem FUSE.
3. **Roteiro completo com cada agente:** criar sessão, mandar um prompt, ver "trabalhando" e "terminou"; pedir algo que exija permissão e ver "aguardando você"; abrir o "See changes" depois de o agente editar um arquivo.
4. **Notificações**, que nenhum teste automático enxerga de verdade:
   - Com a janela do app em segundo plano, o aviso de "terminou" aparece na área de notificações.
   - O aviso de "aguardando você" também.
   - Clicar no aviso traz a janela para a frente e abre a sessão certa.
   - A sessão que está em foco não gera aviso.
5. **Fechar o app com um agente rodando:** aparece a confirmação com a lista das sessões, e depois de confirmar não sobra processo (`pgrep -af "claude|codex"`).
6. **Roteiros automáticos:** `npm run test:smoke` e `npm run build && npm run test:smoke:app`.
7. **Memória:** `npm run measure -- --exe "/opt/Agent Controller/agent-controller"`. É o primeiro número de Linux que vale: os do Docker somam páginas compartilhadas e desenham por software. Registrar na [ADR 0009](../../adr/0009-meta-de-consumo-de-recursos.md).

## Feito quando

O roteiro passa, os problemas encontrados estão corrigidos ou registrados, a ADR 0009 tem a medição do Linux real, e a tarefa 6.3 está marcada em `tasks/M6-empacotamento.md`.
