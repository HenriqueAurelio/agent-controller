# 0007 — Escopo do v1

- **Status:** Aceita
- **Data:** 2026-10-12

## Contexto

Há muitas direções possíveis para um administrador de agentes. O v1 precisa resolver as dores originais (muitas janelas, consumo de recursos, falta de aviso, insegurança sobre o que o agente alterou) e ser entregue em poucas semanas.

## Decisão

**Entra no v1:**

- Sessões nomeadas, cada uma com pasta de trabalho e um agente escolhido pelo usuário: Claude Code ou Codex ([ADR 0011](0011-perfis-de-agente.md)).
- Barra lateral com estado por sessão: rodando, aguardando resposta, terminou, erro.
- Notificação do sistema e badge quando um agente termina ou tem dúvida.
- "See changes": lista de arquivos modificados e diff lado a lado.
- Windows e Linux.

**Fica fora do v1:**

- Sessões que sobrevivem ao fechamento do app ([ADR 0006](0006-persistencia-json-sem-daemon.md)).
- Outros agentes, comando personalizado e shell puro.
- Sessões remotas ou por SSH.
- Split panes.
- Orquestração entre agentes.
- Reverter ou aceitar mudanças por trecho.
- macOS.

## Ordem de entrega

M0 Fundação → M1 Terminal → M2 Sessões nomeadas formam o caminho crítico. Depois do M2, M3 (Notificações) e M4 (See changes) são independentes e podem andar em paralelo. M5 (Consumo de recursos) e M6 (Empacotamento) fecham o ciclo.

Estimativa para uma pessoa: 12 a 15 semanas, conforme o detalhamento em `PLANO.md` (o esboço inicial falava em 6 a 8).

## Alternativas consideradas

- **Incluir macOS.** Electron suporta, mas adiciona uma terceira plataforma para testar e assinar.
- **Incluir revert por arquivo no "See changes".** Útil, porém uma ação destrutiva pede mais cuidado de UX do que cabe no prazo.

## Consequências

- Cada item do escopo responde diretamente a uma dor declarada.
- Itens fora do escopo não devem ser inviabilizados pela arquitetura, mas também não recebem código especulativo.

## Riscos e mitigação

| Risco | Mitigação |
|---|---|
| Crescimento de escopo durante o desenvolvimento | Qualquer item novo exige uma ADR que substitua esta |
| Estouro de prazo | Ordem de corte definida: primeiro a tarefa 4.6 (diff desde o início da sessão), depois a 5.3 (CPU/RAM por sessão) |
| Usuários esperarem revert no painel de diff | Deixar claro na interface que o painel é somente leitura |
