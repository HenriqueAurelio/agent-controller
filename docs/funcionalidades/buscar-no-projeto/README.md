# Buscar no projeto

- **Estado:** proposta, leva 2.
- **ADR:** nova, "Busca de texto: ripgrep empacotado ou git grep".

## O problema

"Onde mais o agente usou essa função?" "Sobrou algum `console.log`?" Hoje a resposta é perguntar ao agente, o que gasta um turno, ou abrir outro programa. Revisar o que o agente fez pede uma busca no projeto inteiro.

## A ideia

`Ctrl+Shift+F` abre a busca no painel: texto ou expressão regular, maiúsculas, palavra inteira e filtro de pastas. Os resultados vêm agrupados por arquivo, e o clique abre o arquivo na linha. Os resultados também podem ir ao agente.

## Como fica para quem usa

- A aba **Buscar** no painel, ao lado de mudanças, arquivos e problemas.
- Opções: **Aa** (maiúsculas), **ab** (palavra inteira), **.\*** (expressão regular), **incluir** e **excluir** (`src/**`, `*.test.ts`), e **só nos arquivos mudados**.
- Os resultados chegam aos poucos, enquanto a busca roda. Ela para em 2 000 resultados e pode ser cancelada.
- O clique abre o arquivo na linha, com o trecho destacado.
- **Mandar ao agente:** os resultados, ou os marcados, viram uma lista `arquivo:linha: trecho` no diálogo de envio ("Troque todos estes usos por …").
- **Substituir** não entra: quem muda o código em massa é o agente.

## Onde entra na arquitetura

- **Ferramenta:** o [ripgrep](https://github.com/BurntSushi/ripgrep) pelo pacote `@vscode/ripgrep`, o mesmo do VS Code. Ele respeita o `.gitignore` e é rápido. O preço é um binário de cerca de 5 MB por sistema no instalador. A reserva, se o binário faltar, é `git grep` (que só funciona dentro do git). A ADR decide entre empacotar e usar só o `git grep`.
- **Core:** `src/core/search/SearchService.ts` roda `rg --json`, lê os resultados aos poucos, aplica o limite e cancela com `killTree`. Uma busca por sessão de cada vez; uma nova cancela a anterior.
- **IPC:** `search:start(sessionId, query)` devolve um id; `search:results` é o evento com os lotes; `search:cancel`. A consulta é validada no main: a expressão regular é compilada antes (um erro volta como `UserError`), e os filtros não podem sair da pasta.
- **Empacotamento:** o binário vai fora do `asar` (`asarUnpack`), com o mesmo cuidado do `node-pty`.

## Riscos

| Risco | Como fica |
|---|---|
| Tamanho do instalador | Medido e anotado na ADR; a alternativa é só o `git grep` |
| Expressão regular que demora demais | Prazo de 30 segundos e cancelamento |
| Busca em `node_modules` | Respeita o `.gitignore` de fábrica; **Ocultos** liga |
| Processo residente | Nenhum: um processo por busca, encerrado ao fim ou ao cancelar |
