# 0011 — Perfis de agente: Claude Code e Codex

- **Status:** Aceita
- **Data:** 2026-10-12
- **Revisão:** 2026-10-12, perfis reduzidos a Claude Code e Codex; resultados dos testes com o Codex incluídos

## Contexto

O usuário precisa escolher qual IA roda em cada sessão. Cada agente tem um comando diferente para abrir e uma forma diferente de avisar que terminou.

Também ficou decidido que o app não altera arquivos de configuração de outros programas: os hooks são passados na hora de abrir o agente.

## Decisão

- Ao criar uma sessão, **o usuário escolhe o perfil de agente**.
- O v1 tem **apenas dois perfis: Claude Code e Codex**. Comando personalizado, outras IAs e shell puro ficam fora do v1.
- Cada perfil é um dado, não código: define o comando de abertura, os parâmetros extras que ligam os avisos e quais camadas de detecção da [ADR 0005](0005-deteccao-de-estado-em-tres-camadas.md) se aplicam.
- O app abre o agente já com os avisos ligados **por parâmetro de linha de comando**. Nenhum arquivo do usuário ou do agente é alterado.
- O app **nunca escreve** na configuração de outro programa no v1.
- O perfil escolhido fica salvo com a sessão e aparece na barra lateral.

### Perfil Codex

- "Terminou": parâmetro `-c notify=[...]`, que dispara o evento `agent-turn-complete`.
- "Tem dúvida": hook `PermissionRequest` passado por `-c hooks...`. O Codex só executa hooks confiados, então **o usuário confirma a confiança uma vez, pelo próprio Codex**. O app orienta esse passo na primeira sessão.
- O app **nunca** usa `--dangerously-bypass-hook-trust`.
- Enquanto o hook não estiver confiado, ou se a validação abaixo falhar: sinais do terminal e silêncio.

### Perfil Claude Code

- Parâmetro `--settings` com um arquivo do próprio app contendo os hooks.
- "Terminou": hook `Stop`.
- "Tem dúvida": hook `PermissionRequest`, que dispara no instante do pedido. O hook `Notification` serve de confirmação e cobre o caso "parado esperando você" (`idle_prompt`).
- Não há tela de confiança de hooks: o usuário não precisa fazer nada.

## Validação feita em 2026-10-12

Testes na máquina de desenvolvimento (Windows 10), com Codex CLI 0.158.0 já autenticado, em modo não interativo (`codex exec`).

| O que foi testado | Resultado |
|---|---|
| `-c notify=[...]` passado por parâmetro | **Funciona.** O comando é chamado ao fim do turno, com um JSON contendo `type: agent-turn-complete`, o id da sessão do Codex, a pasta e a última mensagem |
| Variável `AGENTCTL_SESSION_ID` chega ao comando de aviso | **Funciona**, tanto no `notify` quanto nos hooks |
| Hooks passados por `-c hooks.<Evento>=[...]` | **Aceitos** pela configuração, inclusive com `--strict-config` |
| Hooks sem confiança prévia | **Não executam, e sem nenhum erro.** O Codex exige que o hook seja "confiado" antes |
| Hooks com `--dangerously-bypass-hook-trust` | **Executam:** `SessionStart`, `UserPromptSubmit`, `PreToolUse` e `Stop` dispararam, recebendo JSON pelo stdin |
| `notify` sem confiança prévia | **Funciona.** Não passa pelo mecanismo de confiança |
| Hook `PermissionRequest` no modo não interativo | Não se aplica: esse modo força `approval: never` |

### Segunda rodada: Codex interativo dentro de um PTY

Feita no mesmo dia com node-pty 1.1.0 e xterm headless, dirigindo o Codex por um script.

| O que foi testado | Resultado |
|---|---|
| Codex interativo rodando em PTY criado pelo node-pty | **Funciona**, com a tela reconstruída corretamente pelo xterm headless |
| Pedido de confiança para hooks passados por parâmetro | **Aparece.** Tela "Hooks need review" com três opções: revisar, confiar em todos, continuar sem confiar |
| Hook `PermissionRequest` depois de confiado | **Dispara** no momento em que o Codex pede permissão, com o id da sessão e o nome da ferramenta |
| Confiança persiste entre sessões | **Sim.** Na execução seguinte, com os mesmos hooks, não houve novo pedido |
| Onde a confiança fica gravada | Em `~/.codex/config.toml`, seção `[hooks.state]`, como um hash do comando do hook. Quem grava é o Codex, não o app |
| Título da janela (sequência OSC 0) | **Carrega o estado**, sem hook nenhum: spinner enquanto trabalha, `[ ! ] Action Required` piscando quando pede permissão, texto sem spinner quando para |
| `notify` no modo interativo | **Dispara, mas com um falso positivo:** cerca de 3 s após o primeiro prompt chega um `agent-turn-complete` de um turno interno que gera o título da tarefa, com `thread-id` diferente do da sessão |
| `tui.notifications=true` (OSC 9) | Nenhuma sequência OSC 9 foi emitida nos testes |
| Hook `Stop` no modo interativo | Não observado: todos os turnos interativos foram cancelados antes do fim |

Consequências práticas desses resultados:

- O comando do hook precisa ser **idêntico em todas as sessões**, senão o hash muda e o Codex pede confiança de novo. A sessão é identificada pela variável `AGENTCTL_SESSION_ID`, nunca por texto no comando. Uma atualização do app que mude o caminho do script invalida a confiança.
- O `notify` precisa de filtro: ignorar eventos cujo `input-messages` seja o prompt interno de geração de título, ou cujo `thread-id` não seja o da sessão.
- O Codex pergunta se confia na pasta quando ela é nova. O caminho precisa ser passado na forma longa: com o nome curto do Windows (`HENRIQ~1`) a confiança salva não foi reconhecida e a pergunta voltou.
- `codex exec` fica esperando o stdin fechar; ao abri-lo por um processo é preciso fechar o stdin ou usar um PTY.
- Encerrar o PTY com `kill()` no Windows gerou o erro `AttachConsole failed` do node-pty. O encerramento precisa de um caminho gracioso antes do kill (tarefa 1.4).
- O node-pty 1.1.0 instalou com binário pré-compilado no Windows, sem compilar nada. Isso vale para o Node puro; dentro do Electron ainda não foi testado.

Os testes gravaram confiança de pasta e de hooks no `config.toml` do Codex; o arquivo foi restaurado ao estado anterior ao fim.

### Terceira rodada: Claude Code

Feita no mesmo dia com Claude Code 2.1.296 no Windows, em modo não interativo (`claude -p`) e interativo dentro de um PTY.

| O que foi testado | Resultado |
|---|---|
| Hooks passados por `--settings <arquivo>` | **Funcionam** nos dois modos, sem tela de confiança de hooks |
| Variável `AGENTCTL_SESSION_ID` chega aos hooks | **Funciona** |
| Hook `Stop` ao fim do turno | **Dispara**, com a última mensagem do agente |
| Hook `PermissionRequest` | **Dispara no mesmo segundo** em que o pedido de permissão aparece, com o nome da ferramenta |
| Hook `Notification` com `permission_prompt` | **Dispara cerca de 6 s depois** do pedido |
| Hook `Notification` com `idle_prompt` | **Dispara 60 s depois** de o agente parar esperando entrada |
| Hooks `SessionStart`, `UserPromptSubmit`, `PreToolUse` | Disparam |
| Turno cancelado com Esc | O hook `Stop` **não** dispara |
| Título da janela (OSC 0) | `◐`/`◑` alternando enquanto trabalha, `✳` quando para. **Não distingue** "terminou" de "pedindo permissão": nos dois casos mostra `✳` |
| Pergunta de confiança na pasta | Aparece em pasta nova, com "No, exit" selecionado por padrão |
| Modo de permissão | A configuração do usuário estava em modo automático, e nesse modo o pedido de permissão não aparece. O teste do pedido precisou de `--permission-mode default` |

Consequências práticas:

- No Claude Code, os hooks são o sinal principal e bastam; o título só serve para "trabalhando ou não".
- No Codex é o inverso: o título distingue os três estados, e os hooks exigem confiança.
- Por isso o app trata os sinais por perfil, e não com uma regra única.
- Um turno cancelado não gera `Stop`: o estado "parado" nesse caso vem do título ou do silêncio.

Os testes deixaram a pasta temporária marcada como confiável na configuração do Claude Code e três sessões de teste no histórico.

Os scripts usados nas três rodadas estão em `tools/agent-probe/` (`drive.js` dirige um agente dentro de um PTY; `logger.js` registra as chamadas de hook).

### Quarta rodada: os dois perfis rodando pelo código do app

Feita em 2026-10-13, no Windows 10, com as mesmas versões (Claude Code 2.1.296, Codex CLI 0.158.0). Desta vez quem abriu os agentes foi o próprio app: os roteiros de `npm run test:smoke` (o core dirigindo o agente real) e `npm run test:smoke:app` (o app empacotado). O resultado por versão fica em `tools/agent-probe/results/`.

| Roteiro | Claude Code | Codex |
|---|---|---|
| Abrir e ficar pronto | Passa | Passa |
| Fim de turno | Passa: `terminou` pelo hook `Stop` | Passa: `terminou` pelo `notify` |
| Pedido de permissão | Passa: `aguardando você` pelo hook `PermissionRequest`, no mesmo segundo | Passa: pelo título (`Action Required`) sem hooks confiados, e pelo hook quando confiados |
| Cancelamento com Esc | Passa: `terminou` pelo título, 2 s depois | Passa: `terminou` pelo título, menos de 1 s depois |
| Aviso falso do turno de título (Codex) | — | Não aparece |
| Processos órfãos ao fechar a sessão | Nenhum | Nenhum |
| Um turno dentro do app empacotado | Passa | Passa |

O que esta rodada mostrou de novo, e como o app trata:

| Achado | Tratamento |
|---|---|
| **O Codex gira o spinner do título por 1 a 2 s enquanto carrega**, antes de qualquer prompt. Pelo título, isso é idêntico a um turno | O adaptador só considera que há um turno depois que o usuário envia algo pelo terminal (texto e Enter). Antes disso, spinner é carregamento |
| **O texto do turno interno de título** é: `Generate a concise, single-line task title of at most 36 characters […] User prompt:` seguido do prompt do usuário. Ele chega pelo `notify` com outro `thread-id`, às vezes antes e às vezes depois do aviso verdadeiro | Filtro pelo texto exato, e não por palavras soltas: o usuário pode pedir ao agente que "gere um título". Além disso, um `notify` que chega com o título ainda girando só vale se o título parar em até 1,5 s |
| **O hook `SessionStart` do Codex só dispara no primeiro prompt**, não na abertura. O `session_id` dele é o `thread-id` dos avisos verdadeiros | A detecção de "hooks não confiados" começa a contar no primeiro prompt, não na abertura |
| **JSON com aspas não atravessa um `.cmd`** no Windows: o `cmd.exe` quebra o argumento. O `notify` do Codex passa o JSON por argumento | No Windows o `notify` chama o executável do app com `--agentctl`, sem shell. Os hooks, que mandam o JSON pela entrada padrão, continuam pelo `agentctl.cmd` |
| **Um `.cmd` com caminho acentuado falha**, porque o `cmd.exe` lê o arquivo na página de código do console. Nomes de usuário com acento são comuns | O `agentctl.cmd` não contém nenhum caminho com acento: acha o script pela própria pasta e usa a forma curta (8.3) do executável |
| **O comando do hook precisa funcionar em qualquer shell** (cmd, PowerShell, bash) e a pasta do usuário pode ter espaço | O comando usa a forma curta do caminho, com barras normais e sem aspas |
| **O Codex mostra "Update available" antes de tudo** quando há versão nova, e o Claude Code pergunta a confiança por pasta exata (não herda da pasta-pai) | Nada a fazer no app: o usuário responde no terminal. A sessão aparece como "aguardando você" |
| **O Codex trata Enter logo após uma rajada de teclas como parte de uma colagem**, e não envia | Só afeta testes automatizados, que esperam antes do Enter |
| **Sem um terminal respondendo, o agente trava na abertura**: os dois perguntam a posição do cursor ao terminal | Quando o terminal visual da sessão não está montado, quem responde é o terminal sem tela do processo principal |

A prioridade dos sinais do Codex seguiu a opção 1 da decisão 1.1 de `DECISOES-E-RISCOS.md` (título principal, hooks como reforço), que é a recomendada e a que funciona sem o usuário fazer nada. Ela é um dado do perfil: inverter é trocar dois números em `src/core/agents/profiles.ts`.

### Linux

| O que foi testado | Resultado |
|---|---|
| Todo o `core/` com um agente simulado (títulos, hooks pelo `agentctl`, socket Unix restrito ao usuário, árvore de processos, git) | **Passa**, em Docker (Debian 12) |
| O app empacotado: sessões, terminal, estado pelo título, decisão de notificar, painel de mudanças | **Passa**, em Docker com display virtual, a partir do `.deb` instalado. A notificação em si é interceptada no teste: se ela aparece de fato na área de trabalho do Linux fica para a máquina real (tarefa 6.3) |
| Claude Code e Codex reais no Linux (tarefa 0.4) | **Não testado.** Exige os dois agentes instalados e logados em um Linux, o que não havia nesta máquina (o WSL não tem Node nem os agentes). O roteiro está pronto: `npm run test:smoke` |

**Não validado:** os dois perfis reais no Linux; e o hook `Stop` do Codex no modo interativo (o app não depende dele: o fim de turno do Codex vem do `notify` e do título).

## Alternativas consideradas

- **Incluir comando personalizado e shell puro.** Permitiria qualquer IA, mas com aviso apenas aproximado; retirado do v1 para manter o foco em dois agentes bem suportados.
- **Detectar o agente pelo comando digitado.** Frágil (aliases, wrappers, caminhos completos) e tira a escolha do usuário.
- **O app editar a configuração do agente.** Automático, mas mexe em arquivo que não é dele; descartado.

## Consequências

- Só dois agentes para testar e manter no v1; os dois têm mecanismo de aviso próprio.
- Suportar um agente novo depois é acrescentar um perfil, sem mexer no core.
- No Codex, "terminou" já está resolvido sem nenhuma permissão especial.
- No Codex, "tem dúvida" exige um passo manual de confiança por máquina, na primeira vez.
- A camada de silêncio da ADR 0005 deixa de ser o caminho de agentes desconhecidos e passa a ser só a reserva para quando o aviso preciso faltar.

## Riscos e mitigação

| Risco | Mitigação |
|---|---|
| Hooks do Codex não confiados falham em silêncio: o app acharia que estão ligados | O app nunca assume; mostra o aviso como "confirmado" só depois de receber o primeiro evento daquela sessão |
| `--dangerously-bypass-hook-trust` libera todos os hooks habilitados naquela execução, inclusive os de um repositório que o usuário não revisou | Decidido não usar; a confiança é dada pelo usuário no próprio Codex |
| O usuário escolher "continuar sem confiar" no pedido do Codex | O app percebe pela ausência do evento `SessionStart` e avisa que o modo preciso está desligado |
| O título da janela do Codex não é um contrato documentado e pode mudar de formato ou de idioma entre versões | Tratar como sinal complementar; teste de fumaça por versão do Codex |
| Atualização do app muda o caminho do script do hook e invalida a confiança já dada | Instalar o script em um caminho fixo por usuário, fora da pasta versionada do app |
| No Claude Code em modo automático, quase não há pedidos de permissão, e o "tem dúvida" passa a significar "parou esperando você" | Usar o `Notification` com `idle_prompt` e o `Stop` para esse caso |
| Mudança de parâmetros ou de formato entre versões dos agentes | Perfis isolados do core, teste de fumaça por perfil e versão mínima declarada |
