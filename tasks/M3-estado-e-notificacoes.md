# M3 — Estado e notificações

**Objetivo:** o app sabe, por sessão, se o agente está trabalhando, esperando ou se terminou, e avisa o usuário.

**Marco pronto quando:** nos dois agentes e nos dois sistemas, um pedido de permissão vira "aguardando você" em até 2 segundos e o fim do turno vira "terminou"; o aviso falso do Codex não aparece; a notificação nativa leva à sessão certa.

**Referência obrigatória:** a tabela de validação da [ADR 0011](../adr/0011-perfis-de-agente.md), que descreve o comportamento real de cada sinal.

---

## [x] 3.1 Máquina de estados e agregador de sinais

- **Frente:** A · **Tamanho:** M · **Depende de:** 2.1
- **Situação em 2026-10-13:** Pronta. `src/core/sessions/SignalAggregator.ts`, com testes de tabela.

**O que fazer**

- Estados: `parada`, `iniciando`, `trabalhando`, `aguardando você`, `terminou`, `erro`.
- Tipo `Signal`: sessão, tipo, origem (`hook`, `titulo`, `notify`, `silencio`, `processo`) e horário.
- Agregador que recebe sinais de várias origens e decide o estado, com prioridade configurável por perfil.
- Marcar cada estado como confirmado (origem do próprio agente) ou inferido (silêncio).
- Emitir evento de mudança de estado para o renderer.

**Pronto quando:** testes de tabela cobrem as transições, incluindo sinais conflitantes e fora de ordem.

---

## [x] 3.2 Parser do stream do terminal

- **Frente:** A · **Tamanho:** M · **Depende de:** 1.2
- **Situação em 2026-10-13:** Pronta. `src/core/signals/StreamParser.ts` e `title.ts`. Os títulos dos testes são os gravados dos dois agentes reais; cada sequência é testada partida em todas as posições.

**O que fazer**

- Ler o stream do PTY e extrair: título da janela (OSC 0 e OSC 2), BEL e OSC 9.
- Lidar com sequências partidas entre dois pedaços de dados.
- Normalizar o título: separar o indicador de atividade do texto.
- Regras por perfil que traduzem o título em sinal.

**Pronto quando:** testes com trechos gravados de sessões reais dos dois agentes produzem os sinais esperados.

**Contexto dos testes:**

- Codex: caractere braille girando = trabalhando; `[ ! ] Action Required` ou `[ . ] Action Required` = pedindo permissão; sem indicador = parado.
- Claude Code: `◐` e `◑` alternando = trabalhando; `✳` = parado **ou** pedindo permissão (não distingue).
- Nenhuma sequência OSC 9 foi vista no Codex, mesmo com `tui.notifications=true`.

---

## [x] 3.3 Servidor local de hooks e script agentctl

- **Frente:** A · **Tamanho:** M · **Depende de:** 0.2
- **Situação em 2026-10-13:** Pronta. Os três casos do critério têm teste, nos dois sistemas. O script fica em `~/.agent-controller/bin`.

**O que fazer**

- Servidor no processo principal: named pipe no Windows, unix socket no Linux, pelo módulo `net`.
- Endpoint acessível apenas ao usuário atual.
- Script `agentctl` em `resources/`: lê os argumentos e o stdin, anexa `AGENTCTL_SESSION_ID` e envia ao servidor.
- O script roda pelo runtime do próprio app, sem exigir Node instalado.
- Instalar o script em um caminho fixo por usuário, que não mude entre versões do app.
- Validar o id de sessão recebido e descartar mensagens de sessões desconhecidas.
- O script nunca falha de forma visível para o agente, nem demora: se o app estiver fechado, sai em silêncio.

**Pronto quando:** chamar o script à mão com um id válido gera um sinal na sessão certa; com id inválido, nada acontece; com o app fechado, o script sai com código 0 em menos de 1 segundo.

**Pode começar cedo:** só depende do M0.

---

## [x] 3.4 Adaptador Claude Code

- **Frente:** A · **Tamanho:** M · **Depende de:** 3.1, 3.3
- **Situação em 2026-10-13:** Pronta no Windows: pedido de permissão, fim de turno e cancelamento passam com o Claude Code real, no core e dentro do app. **Validação pendente:** Linux com o agente real (0.4).

**O que fazer**

- Gerar o arquivo de `--settings` do app com os hooks `Stop`, `PermissionRequest`, `Notification` e `SessionStart`.
- Mapear: `SessionStart` → hooks ativos; `PermissionRequest` → aguardando você; `Notification` com `idle_prompt` → aguardando você; `Stop` → terminou.
- Usar o título só para trabalhando ou parado.
- Turno cancelado com Esc não gera `Stop`: resolver pelo título mais o silêncio.

**Pronto quando:** em uma sessão real, pedido de permissão, fim de turno e cancelamento levam aos estados certos.

**Contexto dos testes:** `PermissionRequest` dispara no mesmo segundo do pedido; `Notification` com `permission_prompt` chega cerca de 6 s depois; `idle_prompt` chega 60 s depois de o agente parar. Em modo automático de permissão, o pedido quase nunca aparece.

---

## [x] 3.5 Adaptador Codex

- **Frente:** A · **Tamanho:** M · **Depende de:** 3.1, 3.2, 3.3
- **Situação em 2026-10-13:** Pronta no Windows: com e sem hooks confiados, e sem nenhum "terminou" falso, com o Codex real. Achado novo: o Codex gira o spinner ao carregar, e isso deixou de contar como turno (ADR 0011). A prioridade segue a opção 1 da decisão 1.1, ainda sem o seu "de acordo". **Validação pendente:** Linux com o agente real (0.4).

**O que fazer**

- Título como fonte de estado: trabalhando, aguardando você (`Action Required`), parado.
- `notify` como confirmação de "terminou", **filtrando** o turno interno de geração de título: descartar eventos cujo `thread-id` não é o da sessão ou cujo `input-messages` é o prompt interno de título.
- Hooks opcionais (`PermissionRequest`, `SessionStart`) passados por `-c`.
- Detectar se os hooks estão confiados: sem `SessionStart` recebido após a abertura, estão inativos.
- Mostrar na sessão quando o modo com hooks está desligado, com orientação sobre a tela "Hooks need review".
- Nunca usar `--dangerously-bypass-hook-trust`.

**Pronto quando:** em uma sessão real, o pedido de permissão vira "aguardando você" com e sem hooks confiados; nenhum "terminou" falso aparece nos primeiros segundos do primeiro prompt.

**Depende da decisão 1.1** do `DECISOES-E-RISCOS.md`, apenas na prioridade entre título e hooks. Os dois caminhos são implementados de qualquer forma.

**Não cortável:** o filtro do aviso falso. Os hooks opcionais são o terceiro item da ordem de corte.

---

## [x] 3.6 Reserva: silêncio e saída do processo

- **Frente:** A · **Tamanho:** P · **Depende de:** 3.1
- **Situação em 2026-10-13:** Pronta. Relógio simulado nos testes; o padrão é 20 s, ajustável nas preferências.

**O que fazer**

- Sinal de silêncio: N segundos sem saída depois de um período de atividade, com N configurável.
- Sinal de processo: saída com código 0 → terminou; outro código → erro.
- O silêncio só decide o estado quando não há sinal confirmado recente.

**Pronto quando:** testes com relógio simulado cobrem o silêncio; um agente que encerra sozinho leva a sessão a "terminou" ou "erro".

---

## [x] 3.7 Notificações e indicadores

- **Frente:** B · **Tamanho:** M · **Depende de:** 3.1, 2.3
- **Situação em 2026-10-13:** Pronta. O e2e cobre, nos dois sistemas: avisar a sessão fora de foco, não avisar a que está em foco, badge e clique levando à sessão. No Windows a notificação nativa aparece de fato (verificado no app empacotado). **Validação pendente:** ver a notificação e clicar nela em um Linux real (6.3).

**O que fazer**

- Notificação nativa do sistema ao entrar em "aguardando você" e "terminou", com o nome da sessão.
- Clicar na notificação traz a janela para frente e seleciona a sessão.
- Indicador de estado e badge na barra lateral, com distinção visual entre confirmado e "possivelmente".
- Não notificar a sessão que está em foco com a janela ativa.
- Agrupar avisos repetidos da mesma sessão.
- Preferências: ligar e desligar por tipo de aviso e som.

**Pronto quando:** com a janela em segundo plano, os dois tipos de aviso aparecem e o clique leva à sessão certa, no Windows e em um Linux real.

**Atenção:** notificações não aparecem de forma confiável no WSLg. A validação em Linux é feita na máquina real.

---

## [x] 3.8 Testes de fumaça por perfil

- **Frente:** A · **Tamanho:** M · **Depende de:** 3.4, 3.5
- **Situação em 2026-10-13:** Pronta. `npm run test:smoke` (o core com o agente real) e `npm run test:smoke:app` (dentro do app). Resultados do Windows em `tools/agent-probe/results/`. Desfaz o que grava na configuração dos agentes.

**O que fazer**

- Transformar os scripts de `tools/agent-probe/` em testes: abrir o agente real em um PTY, enviar um prompt, verificar a sequência de estados.
- Um roteiro por perfil: fim de turno normal, pedido de permissão, cancelamento.
- Rodar sob demanda, fora do CI comum, porque usam conta e consomem créditos.
- Usar uma pasta temporária e desfazer o que os testes gravarem na configuração dos agentes.

**Pronto quando:** um comando roda os roteiros dos dois perfis e aponta qual sinal falhou; o resultado é registrado por versão de agente.

**Contexto:** os testes manuais de 2026-10-12 gravaram confiança de pasta e de hooks na configuração do Codex, e confiança de pasta na do Claude Code.
