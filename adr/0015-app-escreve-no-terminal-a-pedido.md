# 0015 — O app escreve no terminal do agente a pedido do usuário

- **Status:** Aceita
- **Data:** 2026-10-16
- **Revisão:** 2026-10-17, a [ADR 0020](0020-responder-permissao-fora-do-terminal.md) acrescenta a resposta a um pedido de permissão, pela tecla do menu do agente.
- **Revisão:** 2026-10-17, a [fila de prompts](../docs/funcionalidades/fila-de-prompts/README.md) (funcionalidade 13): veja "Fila de prompts" abaixo.
- **Emenda:** [ADR 0014](0014-verificacoes-ao-fim-do-turno.md), que criou a colagem no prompt do agente só para "Mandar o erro ao agente". A forma da colagem continua a mesma; esta ADR diz quando mais o app pode usá-la.

## Contexto

Muita gente repete os mesmos pedidos ao agente, e às vezes o mesmo pedido a várias sessões ("rodem os testes e me digam o que quebrou"). É a proposta 6 de [`docs/funcionalidades`](../docs/funcionalidades/biblioteca-de-prompts/README.md): prompts guardados, com variáveis, enviados a uma ou várias sessões.

Até aqui o app só escrevia no terminal do agente o que a pessoa digitava, e o relatório de uma verificação que falhou, por um clique.

## Decisão

### Quando o app escreve

- **Só por uma ação explícita da pessoa**: o botão **Enviar** do diálogo de prompt, ou "Mandar o erro ao agente". Nada é enviado sozinho, nem por importar preferências, nem por um atalho: o atalho de um prompt abre o diálogo, que mostra o texto antes.
- **Sem Enter de fábrica.** O texto fica no prompt do agente. A preferência "Enviar com Enter" (ou a caixa do diálogo, só para aquele envio) acrescenta o Enter, **200 ms depois** da colagem: no Windows, o ConPTY tira os marcadores da colagem, e um Enter na mesma rajada de teclas seria lido como quebra de linha dentro dela.
- **Como na ADR 0014:** uma linha só, com `⏎` no lugar das quebras, dentro de uma colagem em bloco, sem caracteres de controle.

### Espera pelo fim do turno

- Se o agente está **trabalhando**, ou **pedindo uma permissão** ("aguardando você" confirmado por hook ou título, com outro detalhe que não "pronto" ou "parado esperando"), o texto **espera**. Colado numa pergunta de permissão, ele responderia a pergunta.
- A fila é **por sessão**, no `SessionManager`, solta pela mesma transição de estado que já move os avisos. Sai em ordem; um texto enviado com Enter começa um turno novo, e os que vêm depois dele esperam o fim desse.
- A pendência aparece na sessão ("1 envio(s) esperando o turno") e pode ser cancelada. Some se o agente sair.
- **Enviar agora mesmo assim** é uma escolha explícita no diálogo.

### Onde o texto é montado

- As variáveis (`{sessao}`, `{pasta}`, `{branch}`, `{arquivo}`, `{selecao}`, `{?pergunta}`) são preenchidas **no main, por sessão**, com a função pura `src/core/prompts/expand.ts`. O renderer manda o texto do prompt e o que só ele sabe (o arquivo aberto no painel, o trecho selecionado, as respostas); o main valida os tamanhos (seleção até 20 mil caracteres, texto final até 60 mil, até 50 sessões) e só envia se todos os textos ficarem prontos.
- O renderer manda o **texto**, e não só o id do prompt, porque o diálogo deixa a pessoa mudar o texto para aquele envio. Isso não dá ao renderer nada que ele já não tenha: `terminal:input` já escreve no terminal o que a pessoa digita.

### Onde ficam os prompts

- Nas preferências (`prompts`, `promptSubmit`), com limite de quantidade e tamanho. Vão no arquivo de exportação: são texto e não executam nada. Ao contrário das verificações (ADR 0014), que são comandos e ficam fora.
- O atalho de cada prompt fica no próprio prompt; uma combinação que já é de uma ação do app não é aceita.

### Fila de prompts

A fila amplia "espera pelo fim do turno" de um envio pendente para uma lista por sessão (`src/core/prompts/PromptQueue.ts`), e é o único caso em que o app escreve **com Enter sem que a pessoa aperte nada na hora**:

- **A ação explícita é pôr na fila.** O botão **Pôr na fila** do diálogo mostra o texto e a sessão, como o **Enviar**. Dali em diante, cada item vai sozinho, **com Enter** (a fila que espera o Enter da pessoa não anda), e o diálogo diz isso.
- **Só anda com "terminou" confirmado pelo agente**, nunca com "aguardando": uma permissão ou pergunta é da pessoa, e o item espera o próximo fim de turno. Estado estimado pelo silêncio não move a fila; nesse caso, só **Enviar o próximo**.
- **Item com "verificações passaram":** ao fim do turno o app roda as verificações da pasta (ADR 0014) e só envia se todas passarem; se falharem, a fila para.
- **Limite de 20 itens por fila.** Guardada em `queues/<sessionId>.json` (ADR 0006) e **pausada** ao reabrir o app; pausa também quando o agente sai.
- As variáveis são preenchidas **na hora do envio**, pelo mesmo caminho do `terminal:sendText`. O contrato de IPC ganhou os canais `queue:*` e o evento `queue:changed`; `SessionView` ganhou `queue`.

## Alternativas consideradas

- **Enviar com Enter de fábrica.** Mais rápido, mas um prompt importado de terceiros, ou mandado à sessão errada, iria direto para o agente.
- **Colagem com as quebras de linha.** É o que a proposta previa. A medição da ADR 0014 mostrou que, no Windows, o texto pode ser enviado na hora ou ficar preso; a linha única funciona igual nos dois agentes e sistemas.
- **Enviar na hora, mesmo com o agente ocupado.** O texto se misturaria ao que o agente está fazendo ou responderia a uma permissão.
- **Fila no renderer.** Some quando a janela recarrega e não vê as transições de estado com a mesma precisão do main.

## Consequências

- O contrato de IPC ganhou `terminal:sendText`, `terminal:cancelSend` e `prompts:preview`; `SessionView` ganhou `pendingSends`.
- O envio de texto ao agente passa a ser uma peça reaproveitável (`SessionManager.sendText`): "comentar no diff" (proposta 3) vai usá-la.

## Riscos e mitigação

| Risco | Mitigação |
|---|---|
| Mandar a sessões erradas | O diálogo lista as sessões de destino e mostra a prévia antes de enviar |
| Prompt importado com instrução perigosa | É só texto, sempre mostrado antes; sem Enter de fábrica |
| `{selecao}` enorme | Cortada em 20 mil caracteres, com aviso; o main recusa acima disso |
| Colar no meio de um turno ou numa permissão | O envio espera o fim do turno; enviar mesmo assim é escolha explícita |
| Enter colado junto com o texto | Enter separado, 200 ms depois da colagem |
| Comportamento real dos agentes | O roteiro de smoke com os dois agentes (texto de três linhas, envio com o agente trabalhando) fica para quando houver autorização para usá-los; a colagem em si já foi medida na ADR 0014 |
