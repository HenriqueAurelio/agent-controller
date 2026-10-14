# Tarefas do v1

Um arquivo por marco. Cada tarefa traz a frente responsável, o tamanho, as dependências, o que fazer e o critério de pronto. A visão geral, a arquitetura e a ordem de corte estão no [`PLANO.md`](../PLANO.md).

| Marco | Arquivo | Tarefas | Objetivo |
|---|---|---|---|
| M0 | [M0-fundacao-e-provas.md](M0-fundacao-e-provas.md) | 6 | Projeto de pé e incertezas técnicas provadas |
| M1 | [M1-terminal.md](M1-terminal.md) | 5 | Terminal que roda os dois agentes |
| M2 | [M2-sessoes-e-perfis.md](M2-sessoes-e-perfis.md) | 5 | Sessões nomeadas com perfil de agente |
| M3 | [M3-estado-e-notificacoes.md](M3-estado-e-notificacoes.md) | 8 | Estado por sessão e avisos |
| M4 | [M4-see-changes.md](M4-see-changes.md) | 6 | Ver o que o agente alterou |
| M5 | [M5-consumo-de-recursos.md](M5-consumo-de-recursos.md) | 4 | Ficar abaixo de 450 MB |
| M6 | [M6-empacotamento.md](M6-empacotamento.md) | 4 | Instaladores e lançamento |

## Legenda

- **Frente:** A = core e agentes, B = interface, C = git, infra e entrega.
- **Tamanho:** P = até 1 dia, M = 2 a 3 dias.
- **Estado:** `[ ]` a fazer, `[~]` em andamento, `[x]` pronta. Ao pegar uma tarefa, marque `[~]` e ponha seu nome ao lado do título.

## Tarefas por frente

| Frente | Tarefas |
|---|---|
| A. Core e agentes | 0.3, 0.4, 1.1, 1.4, 1.5, 2.2, 2.5, 3.1, 3.2, 3.3, 3.4, 3.5, 3.6, 3.8 |
| B. Interface | 0.2, 1.2, 1.3, 2.3, 2.4, 3.7, 4.2, 4.3, 4.5, 5.1 |
| C. Git, infra e entrega | 0.1, 0.5, 0.6, 2.1, 4.1, 4.4, 4.6, 5.2, 5.3, 5.4, 6.1, 6.2, 6.3, 6.4 |

## Regras que valem para toda tarefa

- TypeScript, com lint e testes passando no CI no Windows e no Ubuntu.
- Lógica em `src/core/` tem teste automático e não importa Electron.
- O renderer não acessa Node; tudo passa pelo contrato de `src/shared/`.
- Comportamento verificado nos dois sistemas.
- Se a tarefa contrariar uma ADR, a ADR é revista antes do merge.
