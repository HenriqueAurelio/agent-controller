# 0022 — Experimentos: o mesmo pedido em várias cópias

- **Status:** Aceita
- **Data:** 2026-10-17
- **Amplia:** [ADR 0017](0017-sessoes-em-worktree.md) (cada tentativa é uma sessão em worktree) e [ADR 0015](0015-app-escreve-no-terminal-a-pedido.md) (o app escreve o pedido no terminal do agente). É a funcionalidade 17 de [`docs/funcionalidades`](../docs/funcionalidades/melhor-de-n/README.md).

## Contexto

O mesmo pedido, feito duas vezes, sai diferente, e Claude Code e Codex também resolvem cada um do seu jeito. Comparar era criar as sessões à mão, uma cópia para cada, colar o mesmo prompt em todas e olhar os painéis um a um.

## Decisão

### Um experimento é um grupo de sessões comuns

- Um experimento tem de 1 a 4 tentativas (`ATTEMPTS_MAX`), cada uma com agente e, se quiser, comando próprio. O `ExperimentService` (`src/core/experiments`) só junta o que já existe: `SessionManager.createInWorktree` para a cópia, a branch (`ac/<nome>-<n>`) e o comando de preparo; um grupo da lista (`SessionGroup.experimentId` marca o grupo); e `sendText` para o pedido.
- As cópias são feitas **uma depois da outra**: o comando de preparo (`npm ci`) de cada uma ocupa a máquina, e assim o limite de execuções simultâneas vale sem fila nova. Se uma tentativa falha, as já criadas são fechadas, o grupo some, o erro sobe. As cópias e as branches ficam (o app nunca apaga branch, [ADR 0017](0017-sessoes-em-worktree.md)).
- O experimento (`id`, nome, pedido, base, grupo, tentativas, quando o pedido foi enviado e quando o primeiro turno acabou) fica em `experiments.json`, ao lado das demais preferências. Tentativa cuja sessão foi fechada à mão sai do experimento; sem tentativas, o experimento some.
- Cada tentativa é uma sessão como as outras: dá para conversar com ela, ver o painel de mudanças, rodar as verificações do fim do turno. A pessoa pode continuar mexendo antes de escolher.

### O pedido vai quando o agente está pronto

O app inicia os agentes (a interface só inicia o da sessão em vista) e manda o pedido, com Enter, quando o estado confirmado é "pronto" (mesma regra da fila de prompts, `readyForQueue`), e **1,5 s depois do início**: o agente avisa que está pronto um pouco antes de o campo de texto estar, e um texto colado nessa janela se perde. O pedido que não chegou aparece na tabela ("aguardando o agente ficar pronto"). Se o app fechar antes do envio, o pedido não é reenviado: sessões voltam paradas, e mandar texto a um agente que a pessoa ainda não viu abrir seria pior que não mandar.

### Comparar contra a mesma base

- A base é resolvida **uma vez**, na criação (`baseCommit`): a branch de origem pode andar depois, e as tentativas continuam sendo comparadas com a mesma árvore. A comparação é `git diff --numstat` da árvore de trabalho contra esse commit mais os arquivos não rastreados, de modo que o que o agente commitou também conta. Nada é gravado no repositório.
- O diff de um arquivo é o texto unificado em cada tentativa (`experiments:diff`). O nome vem da interface, então só se lê um arquivo que a tentativa de fato mudou (a lista do `numstat`); qualquer outro nome volta como "não mexeu". Acima de 200 KB só a tabela vale (`too-large`); binário idem.
- A interface busca a comparação a cada 3 s enquanto está aberta: ela acompanha o estado atual das tentativas sem canal de eventos novo.

### "Ficar com esta" respeita as regras de hoje

`keep` fecha as outras sessões com `remove(worktree: 'remove')`: a cópia com mudança sem commit, ou em uso por outra sessão, **não** é removida. Essa sessão continua aberta (parada) e a resposta a lista, com a pasta e o motivo; chamar `keep` de novo depois de limpá-la termina o serviço. Sem pendências, o experimento e o grupo acabam e a escolhida segue como sessão comum. Branches nunca são apagadas.

### IPC

`experiments:create`, `experiments:compare`, `experiments:diff`, `experiments:keep`, todos validados no main (N de 1 a 4, perfil conhecido, comando de uma linha, pasta, base e pedido com limites). O preload não muda.

## Consequências

- **Custo multiplicado por N:** o diálogo diz "N tentativas = N× o uso dos agentes". Nada impede a pessoa de criar vários experimentos (limite de 50).
- **Disco:** N cópias, cada uma com seu `node_modules` se houver comando de preparo; as cópias aparecem em Preferências → Sessões, e "ficar com esta" remove o resto.
- **Memória:** são N agentes e N terminais como em qualquer N sessões; nenhum processo ou monitor novo fica residente (o serviço só escuta eventos do `SessionManager`). Os terminais seguem o `TerminalPool`.
- **Codex e Claude Code lado a lado** funcionam porque nada fora de `src/core/agents` sabe qual agente roda: a tentativa só guarda o perfil.
