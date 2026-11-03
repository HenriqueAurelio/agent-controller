# Comentar no diff e devolver ao agente

- **Estado:** implementada (v0.3, 2026-11-03). O smoke com os agentes reais (3.6) não foi rodado: gasta créditos e espera pedido do usuário. Os testes usam o shell no lugar do agente.
- **ADR:** a de "O app escreve no terminal do agente a pedido do usuário", criada pela [biblioteca de prompts](../biblioteca-de-prompts/README.md); esta proposta só a reaproveita.

## O problema

Revisar o que o agente fez hoje é: abrir o painel, achar um problema, voltar ao terminal e descrever em texto "no arquivo X, perto da função Y, troque Z". Com cinco observações, a pessoa digita um parágrafo e o agente ainda erra o lugar. É o mesmo atrito de revisar um PR por e-mail.

## A ideia

Revisar no painel **como se revisa um PR**: clicar numa linha do diff, escrever um comentário, seguir para o próximo. No fim, **Enviar ao agente** monta um prompt único com cada comentário e o lugar exato, e escreve no terminal da sessão.

```
Revisei as mudanças. Ajuste o seguinte:

1. src/core/git/GitService.ts:241 (trecho: `if (size > MAX) throw …`)
   Use a mesma constante do ChangesService em vez de repetir o limite.

2. src/renderer/src/components/DiffView.tsx:88-95
   Este efeito roda a cada render; dependa só de `file`.
```

## Como fica para quem usa

- No diff, ao passar o mouse na margem do lado direito, aparece um **+**. Clicar abre uma caixa de comentário naquela linha; arrastar seleciona várias linhas.
- Os comentários ficam marcados na margem e listados numa aba **Revisão** do painel, com contagem no botão.
- **Enviar ao agente** mostra o prompt montado, editável, antes de mandar. Enviar escreve no terminal e **não aperta Enter** de fábrica (preferência para mandar direto). Assim a pessoa vê o que vai e confirma.
- Se o agente estiver trabalhando, o botão avisa e oferece esperar o fim do turno: o envio fica pendente e sai quando a sessão passa para "Aguardando você" ou "Terminou".
- Comentários sobrevivem a trocar de arquivo e de sessão, e são descartados ao enviar (ou à mão). Se a linha mudar, o comentário mostra o trecho original e fica marcado "desatualizado".
- O modelo do prompt (o cabeçalho, o formato de cada item) fica em **Preferências → Revisão**, nos três idiomas da interface.

## Onde entra na arquitetura

- **Renderer:** decorações e *view zones* do Monaco no `DiffView`, estado da revisão no store da sessão.
- **Core:** `src/core/review/ReviewStore.ts` guarda os comentários por sessão (em memória, e no disco para sobreviver a fechar o app: `review/<sessionId>.json` na pasta de dados). `buildReviewPrompt(comments, template)` é função pura, testável.
- **IPC:** `review:list`, `review:add`, `review:update`, `review:remove`. O envio usa o `terminal:sendText` da [biblioteca de prompts](../biblioteca-de-prompts/README.md) (colagem em bloco, enviar quando terminar), com o texto montado no core. O renderer não monta texto para o PTY.

## O que mudou em relação à proposta

- **O modelo do prompt** não ficou numa aba nova de Preferências: é o prompt de fábrica **Aplicar a revisão**, com a variável `{revisao}`, editável na biblioteca de prompts como os outros. Assim o envio, a pré-visualização, a espera pelo fim do turno e a fila são os que já existiam.
- **O texto da revisão** (`buildReviewText`, em `src/core/review/reviewText.ts`) não tem palavras de nenhum idioma: só número, `arquivo:linha`, o trecho cercado por crases e o comentário. As palavras ficam no prompt, nos três idiomas.
- **Um arquivo só** (`review.json`, na pasta de dados) guarda os comentários de todas as sessões, em vez de um por sessão: a revisão é pequena e acaba quando é enviada.
- **"Desatualizado"** é calculado pelo editor ao desenhar, comparando o trecho guardado com as linhas de agora; não é gravado.
- **Escrever o comentário** acontece num diálogo da interface, não numa caixa dentro do editor: os textos traduzidos e o foco do teclado ficam onde já estão.
- **Canais:** `review:list`, `review:add`, `review:update`, `review:remove`, `review:clear` (com os ids enviados, para não apagar o que foi escrito enquanto o diálogo estava aberto) e `review:text`; o evento é `review:changed`.

## Riscos

| Risco | Como fica |
|---|---|
| Texto multilinha ser interpretado como vários prompts | Bracketed paste, testado com os dois agentes no `npm run test:smoke` (com sua autorização) |
| Enviar no meio de um turno e misturar com o que o agente está fazendo | Envio pendente até o agente parar; enviar mesmo assim é escolha explícita |
| Comentário apontar para a linha errada depois que o agente mexeu | Guardar o trecho de código junto, mostrar "desatualizado" |
| Prompt grande demais | Limite de comentários e de caracteres, com aviso |
