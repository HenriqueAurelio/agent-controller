# 0005 — Detecção de "terminou" e "tem dúvida" em três camadas

- **Status:** Aceita
- **Data:** 2026-10-12

## Contexto

O app precisa avisar quando um agente termina ou fica esperando uma resposta. O terminal, porém, só enxerga bytes: não existe um sinal universal de "o agente tem uma dúvida". Como o produto roda qualquer agente, não dá para depender de um único mecanismo. É a parte mais difícil do v1.

## Decisão

Combinar três camadas, da mais confiável para a menos:

1. **Hooks do agente.** O app injeta `AGENTCTL_SESSION_ID` no ambiente de cada sessão e expõe o CLI `agentctl notify --state done|waiting`. O Claude Code chama pelos hooks `Stop` e `Notification`; o Codex, pela opção `notify`. O CLI fala com o app por named pipe no Windows e unix socket no Linux, ambos pelo módulo `net` do Node. O `agentctl` é um script JS executado pelo runtime do próprio app, então não exige Node instalado na máquina.
2. **Sinais do terminal.** BEL e as sequências OSC 9 / OSC 777, interceptadas no stream do PTY.
3. **Heurística genérica.** Saída do processo significa "terminou". Silêncio por N segundos depois de atividade significa "possivelmente aguardando", com N configurável por sessão.

Estados da sessão: rodando, aguardando resposta, terminou, erro. A interface diferencia um estado confirmado (camadas 1 e 2) de um estado inferido (camada 3).

## Alternativas consideradas

- **Só heurística de inatividade.** Funciona com tudo, mas com falsos positivos demais para ser a única fonte.
- **Só hooks.** Preciso, mas deixa de fora qualquer agente sem integração.
- **Analisar o texto da tela procurando prompts.** Frágil: quebra a cada mudança de versão ou de idioma do agente.
- **Usar um LLM para classificar a saída.** Custo e latência incompatíveis com o objetivo de baixo consumo.

## Consequências

- Agentes com hooks têm notificação precisa; os demais têm uma aproximação útil.
- O app precisa de um servidor IPC local e de um segundo binário (`agentctl`).
- Suportar bem um agente novo significa escrever um perfil com seus hooks, sem mexer no core.

## Riscos e mitigação

| Risco | Mitigação |
|---|---|
| Falso positivo de "aguardando" em builds e testes longos e silenciosos | Hooks são o caminho principal; a heurística aparece marcada como "possivelmente" e pode ser desligada ou ajustada por sessão |
| Ligar os hooks exigiria alterar a configuração do agente do usuário | O app não altera: passa os hooks por parâmetro ao abrir o agente, conforme o perfil escolhido ([ADR 0011](0011-perfis-de-agente.md)) |
| Mudança no formato dos hooks entre versões dos agentes | Perfis por agente isolados do core e teste de fumaça por perfil |
| O socket/pipe local aceitar mensagens de outro processo | Endpoint restrito ao usuário atual e validação do `AGENTCTL_SESSION_ID` |
| Excesso de notificações incomodar o usuário | Não notificar a sessão que está em foco; agrupar eventos repetidos |
