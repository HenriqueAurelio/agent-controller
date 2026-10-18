# Painel de problemas

- **Estado:** concluída (leva 2).
- **ADR:** nenhuma nova. Lê a saída das [verificações](../verificacoes-pos-turno/README.md), que já existem.

## O problema

Quando uma verificação falha, o diálogo mostra o fim da saída: 200 linhas de `tsc` e `eslint` misturadas. **Mandar o erro ao agente** manda o bloco inteiro, mesmo quando a pessoa só quer que ele corrija um dos erros, e a outra metade ela mesma resolve.

## A ideia

Uma aba **Problemas**, como a do VS Code: cada erro numa linha, com arquivo, linha, mensagem e de qual verificação veio. Clicar abre o arquivo no lugar. Cada problema, ou os marcados, vai ao agente sozinho.

## Como fica para quem usa

- O painel ganha a aba **Problemas (7)**, ao lado de mudanças e arquivos. A barra lateral continua com o **✗ 2** de hoje.
- Os problemas vêm agrupados por arquivo, com ícone de erro ou aviso e a verificação de origem ("typecheck", "lint").
- **Clicar** abre o arquivo na linha, no editor do painel. O editor sublinha a linha, como o Monaco faz com os próprios erros.
- **Mandar ao agente:** no problema (botão ao passar o mouse) ou nos marcados. O texto vai pelo diálogo de envio, com o prompt guardado "Corrigir problemas" e as variáveis `{problemas}` e `{arquivo}`.
- Uma saída que o app não entende continua aparecendo inteira, como hoje, abaixo da lista.
- Os problemas são da última rodada. Quando o agente volta a trabalhar, a lista fica esmaecida até a próxima rodada.

## Onde entra na arquitetura

- **Saída completa:** hoje o `CheckResult` guarda só o fim da saída (`truncated`). O `ToolRunner` passa a ler os problemas **enquanto** o comando escreve, linha a linha, e guarda até 500 problemas, sem guardar a saída inteira.
- **Core:** `src/core/checks/problems.ts`, com leitores para tsc (`arquivo(l,c): error TSxxxx`), eslint (formatos `stylish` e `unix`), vitest e jest (a primeira linha do projeto na pilha), pytest, ruff, cargo, go vet, e um genérico `arquivo:linha:coluna: mensagem`. O leitor genérico usa o `findLocations` de [links no terminal](../links-no-terminal/README.md). O leitor é escolhido pelo comando, e o genérico vale como reserva.
- **Shared:** `Problem { file, line, column?, severity, message, source, checkId }`, dentro do `CheckResult`.
- **IPC:** nada novo além do campo no `checks:get`. O envio usa o `terminal:sendText`.

## Riscos

| Risco | Como fica |
|---|---|
| Formato de uma ferramenta mudar | Leitor por ferramenta, com testes de saídas reais; o genérico de reserva |
| Saída enorme (milhares de erros) | Para em 500, com aviso "e mais N" |
| Caminho relativo a outra pasta (monorepo) | Resolvido pela pasta onde a verificação rodou, e conferido com `files:locate` |
