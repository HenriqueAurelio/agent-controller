# 0008 — Teste em Linux: Docker + WSL2

- **Status:** Aceita
- **Data:** 2026-10-12

## Contexto

O produto precisa rodar em Windows e Linux, e a máquina de desenvolvimento é Windows 10 (build 19045). É preciso testar o Linux sem uma segunda máquina.

## Decisão

Usar os dois, cada um para o que faz bem:

- **Docker** para build e testes do core em Node (PTY, git, IPC), sem interface. A mesma imagem serve ao CI.
- **WSL2 com WSLg** para abrir a interface gráfica de verdade e testar manualmente.
- **CI no GitHub Actions** com runners Windows e Ubuntu, rodando build e testes a cada push.
- Testes e2e de fumaça com Playwright (suporte a Electron), em Linux com display virtual (xvfb).
- Validação final em uma máquina Linux real, que já está disponível.

## Alternativas consideradas

- **Só Docker.** Não exibe a GUI sem configuração extra de display.
- **Só WSL2.** Funciona, mas o ambiente não é reproduzível nem serve ao CI.
- **Máquina virtual completa.** Mais fiel, porém pesada para o ciclo diário; fica reservada para a validação final.
- **Dual boot.** Interrompe o fluxo de trabalho.

## Consequências

- O core precisa ser testável sem interface, o que obriga a mantê-lo em módulos Node que não dependem do Electron.
- Ambiente Linux reproduzível e idêntico ao do CI.
- Diferenças entre os sistemas aparecem cedo, a cada push.

## Riscos e mitigação

| Risco | Mitigação |
|---|---|
| Notificações nativas não aparecem de forma confiável no WSLg | Validar a tarefa 3.5 em Linux real ou VM antes do release |
| WSLg não representa todos os desktops (GNOME, KDE, Wayland, X11) | Teste manual em pelo menos uma distro real antes do release |
| PTY dentro de container se comportar diferente de um host real | Rodar a mesma suíte do core também no WSL2 |
| Disco do projeto montado no WSL (`/mnt/g`) é lento e não emite eventos de arquivo confiáveis | Clonar o repositório dentro do sistema de arquivos do WSL para testar o file watcher |
