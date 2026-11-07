# 0034 — Controle pela linha de comando e por MCP, com um socket local e um token

- **Status:** Aceita
- **Data:** 2026-11-03
- **Funcionalidade:** controle por CLI ou MCP (`docs/proximas-versoes.md`, v0.6, item 18)

## Contexto

Hoje só a janela abre sessões e manda prompts. Um script (abrir três sessões e mandar a mesma tarefa) e um agente que quer delegar (abrir outra sessão, mandar uma parte do trabalho e esperar o resultado) não têm por onde entrar. CompozyOS, Superset e cmux oferecem os dois caminhos: uma linha de comando e um servidor MCP.

O app já tem um canal parecido: o `agentctl`, que os hooks dos agentes chamam para mandar sinais ao app por um socket local (ADR dos sinais). Esse canal só recebe sinais de uma sessão conhecida e nunca responde. O controle precisa de pergunta e resposta, e de uma porta que se ache sem estar dentro de uma sessão.

## Decisão

- **Um comando `aurelium`**, instalado pelo app ao lado do `agentctl` (`~/.agent-controller/bin`, `aurelium.cmd` no Windows), que roda com o próprio runtime do app (`ELECTRON_RUN_AS_NODE`): não precisa de Node instalado.
  - Comandos: `list`, `status`, `new <pasta>`, `send`, `wait` e `read`.
  - Os códigos de saída servem a scripts: 0 deu certo, 1 erro, 2 o `wait` esgotou o tempo.
- **`aurelium mcp`:** os mesmos comandos como ferramentas de um servidor MCP por stdin e stdout (`list_sessions`, `new_session`, `send_prompt`, `wait_session`, `read_screen`). Qualquer agente que aceite MCP registra o servidor com uma linha.
- **Um socket próprio**, separado do dos hooks: socket Unix com permissão `0600` numa pasta `0700`, ou named pipe no Windows, que só o dono, SYSTEM e administradores abrem. O nome é aleatório a cada execução.
- **Um token** aleatório de 24 bytes a cada execução. Cada pedido traz o token, que é comparado em tempo constante. O socket e o token ficam em `aurelium.json`, ao lado do comando, gravado com `0600` a cada início do app. Quem não lê esse arquivo não fala com o app, mesmo que adivinhe o nome do socket.
- **O core decide; o main liga.** `src/core/control` tem:
  - o protocolo (uma linha JSON por conexão, respondida com uma linha);
  - o servidor;
  - o serviço que traduz cada comando em ações no `SessionManager`, com os argumentos validados ali.

  O main cria a sessão, conferindo que a pasta existe, e escreve as mensagens no idioma do app. A interface, o preload e o contrato de IPC não mudam.
- **O `wait` espera o turno que o texto começou.**
  - Depois de um `send`, a sessão conta como ocupada até o agente dizer que começou (ou por 20 s, se ele não disser). Assim, o `wait` logo depois do `send` não devolve o "terminou" de antes.
  - Silêncio não é fim de turno: valem `terminou`, `aguardando` confirmado pelo agente, `erro` e o processo parado.
  - Quem desiste do `wait` (Ctrl+C) fecha a conexão, e a espera acaba no app.
- **Fora desta versão:**
  - criar a sessão numa cópia isolada (worktree);
  - responder permissões;
  - parar ou remover sessões.

  São ações que mudam ou descartam trabalho, e entram quando houver uso que peça.

## Consequências

- Scripts e agentes abrem sessões, mandam prompts e esperam por elas. Um agente dentro de uma sessão pode delegar a outra.
- Qualquer processo do mesmo usuário que leia `aurelium.json` controla o app. É o mesmo poder que esse processo já tem: rodar os próprios agentes com a conta da pessoa. Outro usuário da máquina não abre o socket nem lê o arquivo.
- O app precisa estar aberto: com ele fechado, o comando diz isso e sai com 1. Manter as sessões sem a janela é o item 15 (core em processo próprio).
- As descrições das ferramentas MCP ficam em inglês no script, porque são lidas pelo modelo, não pela pessoa. As mensagens que a pessoa lê vêm do app, no idioma dela.
