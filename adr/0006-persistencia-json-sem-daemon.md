# 0006 — Persistência em JSON, sem daemon

- **Status:** Aceita
- **Data:** 2026-10-12

## Contexto

O usuário nomeia sessões e associa cada uma a uma pasta e a um comando. Isso precisa estar lá na próxima abertura do app. A questão é o que acontece com os processos quando o app fecha.

## Decisão

- Persistir apenas a **configuração**: nome, pasta, comando, shell e layout, em um arquivo JSON no diretório de config do usuário.
- Os **processos morrem com o app**. Ao reabrir, as sessões voltam listadas e paradas, e o usuário as reinicia.
- Não há daemon nem serviço em segundo plano no v1.

## Alternativas consideradas

- **Daemon que mantém os PTYs vivos (modelo tmux).** Sessões sobreviveriam ao fechamento, mas é um processo residente a mais, com ciclo de vida, atualização e IPC próprios. Contraria o objetivo de consumo e dobra a complexidade do v1.
- **SQLite.** Desnecessário para uma lista pequena de sessões.
- **Persistir o scrollback em disco.** Ocupa espaço e pode gravar segredos exibidos no terminal.

## Consequências

- Nenhum processo residente: nada do app continua rodando depois que a janela fecha.
- Fechar o app interrompe os agentes em execução; o app pede confirmação quando há sessões rodando.
- O arquivo é legível e editável à mão.

## Riscos e mitigação

| Risco | Mitigação |
|---|---|
| Fechar o app por engano e perder um agente no meio da tarefa | Confirmação ao fechar com sessões ativas |
| Arquivo corrompido por escrita interrompida | Escrita atômica (arquivo temporário + rename) e backup da versão anterior |
| Mudança de formato entre versões | Campo de versão do schema desde o primeiro release |
| Comandos salvos conterem segredos | Guardar o comando como digitado, sem variáveis de ambiente; documentar no README |

## Critério de revisão

Se sessões persistentes virarem o pedido principal dos usuários, abrir uma nova ADR para o daemon.
