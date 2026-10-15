# Biblioteca de prompts

- **Estado:** proposta, escolhida para a primeira leva; é a primeira a ser feita.
- **ADR:** nova, "O app escreve no terminal do agente a pedido do usuário". Esta proposta cria o envio de texto ao terminal; [verificações ao fim do turno](../verificacoes-pos-turno/README.md) e, mais tarde, [comentar no diff](../comentar-no-diff/README.md) o reaproveitam.

## O problema

Muita gente repete os mesmos pedidos: "revise o diff atual procurando bugs", "escreva os testes que faltam para {arquivo}", "atualize o README com o que mudou". Hoje cada um é digitado de novo, ou colado de um bloco de notas, em cada sessão.

E quando a mesma instrução vale para várias sessões ("rodem os testes e me digam o que quebrou"), é preciso entrar em uma por uma.

## A ideia

- **Prompts guardados**, com nome e texto, em **Preferências → Prompts** e na paleta de comandos ("Prompt: Revisar diff").
- **Variáveis** preenchidas na hora: `{sessao}`, `{pasta}`, `{branch}`, `{arquivo}` (o aberto no painel), `{selecao}` (o trecho selecionado no editor) e `{?pergunta}`, que abre um campo para a pessoa preencher antes de enviar.
- **Enviar a várias sessões:** escolher o prompt e marcar as sessões; ele vai para cada uma, já com as variáveis daquela sessão. Sessões trabalhando recebem quando terminarem.
- **Atalho por prompt**, pelo editor de atalhos que já existe.
- Os prompts vão no arquivo de exportação das preferências: são texto, não executam nada.

## Como fica para quem usa

1. `Ctrl+Shift+P` → "Prompt: Escrever testes" → o app mostra o texto com as variáveis preenchidas, editável → **Enviar**. O texto vai ao terminal como uma colagem só e **sem Enter** de fábrica, para a pessoa conferir lá e confirmar (preferência "Enviar com Enter" para mandar direto). Se o agente estiver trabalhando, o envio espera o fim do turno.
2. No painel, seleção de código → menu de contexto → "Mandar ao agente com o prompt…".
3. Na barra lateral, selecionar várias sessões (`Ctrl+clique`) → "Enviar prompt às selecionadas".

## Onde entra na arquitetura

- `src/shared/prompts.ts`: tipo e sanitização; fica nas preferências (`prompts: PromptTemplate[]`).
- `src/core/prompts/expand.ts`: substituição de variáveis, função pura. As variáveis vêm do main (pasta, branch) e do renderer (arquivo, seleção), mas a expansão é no core.
- **Envio ao terminal** (`terminal:sendText`): o main escreve no PTY da sessão usando *bracketed paste* (`ESC[200~ … ESC[201~`), para o agente receber várias linhas como uma mensagem só e não como várias teclas Enter. O renderer manda o id do prompt e os valores; o texto que vai ao PTY é montado no main. Se um agente precisar de outro jeito de receber texto longo, isso vira um campo do perfil, em `src/core/agents`.
- **Enviar quando terminar:** fila por sessão no main, que solta o texto quando o `SignalAggregator` mostra a sessão em "Aguardando você" ou "Terminou". Pendência visível na sessão e cancelável. A mesma fila atende o envio a várias sessões.
- Mais tarde, `prompts` vira um ponto de [extensões](../extensoes/README.md).

## Riscos

| Risco | Como fica |
|---|---|
| Mandar a sessões erradas | Pré-visualização com a lista de sessões antes de enviar |
| Prompt importado de terceiros com instrução perigosa para o agente | É só texto, sempre mostrado antes de ir; nunca enviado com Enter sem a preferência ligada |
| `{selecao}` enorme | Limite de tamanho com aviso |
| Texto multilinha virar vários prompts | Bracketed paste, testado com os dois agentes no `npm run test:smoke` (só com sua autorização) |
| Enviar no meio de um turno e misturar com o que o agente está fazendo | Envio pendente até o agente parar; enviar mesmo assim é escolha explícita |
