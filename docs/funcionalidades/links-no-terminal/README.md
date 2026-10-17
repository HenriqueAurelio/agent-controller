# Links clicáveis no terminal

- **Estado:** concluída (leva 2). Smoke com agentes reais não rodado.
- **ADR:** nenhuma nova.

## O problema

O agente e as verificações escrevem caminhos o tempo todo: `src/core/git/GitService.ts:241`, `tests/x.test.ts(12,5): error TS2345`. Para ver o trecho, a pessoa abre o painel, procura o arquivo na árvore e rola até a linha. No VS Code e no Zed, é um `Ctrl+clique`.

## A ideia

Caminhos e endereços no terminal do agente, no terminal auxiliar e na saída das verificações viram **links**. `Ctrl+clique` num caminho abre o arquivo no editor do painel, já na linha. Num endereço `http(s)`, abre o navegador.

## Como fica para quem usa

- Passar o mouse com `Ctrl` apertado sublinha o link, como no VS Code. Sem o `Ctrl`, nada muda, para não atrapalhar a seleção de texto.
- **Formatos reconhecidos:** `caminho:linha`, `caminho:linha:coluna`, `caminho(linha,coluna)` (tsc), `caminho, line N` (Python), e caminhos sozinhos. Relativos à pasta da sessão ou absolutos.
- Só vira link o que **existe** dentro da pasta da sessão (ou do repositório dela). Um caminho de fora, ou que não existe, fica como texto.
- `localhost:3000` e `http://…` abrem no navegador.
- No diálogo das verificações, a saída ganha os mesmos links.

## Onde entra na arquitetura

- **Shared:** `src/shared/locations.ts`, com `findLocations(line)` → `{ start, end, path, line?, column? }[]`. É uma função pura, que o [painel de problemas](../painel-de-problemas/README.md) também usa.
- **Renderer:** `terminal.registerLinkProvider` do xterm em `terminalHost.ts`. Ele chama `findLocations` na linha e confirma cada candidato com o main.
- **IPC:** `files:locate(sessionId, candidates)` devolve os que existem, já resolvidos e dentro da pasta. O main valida que o caminho não sai da pasta (sem `..` escapando, sem link simbólico para fora), com `node:path` e `toLongPath`.
- **Abrir:** um evento do renderer abre o painel no modo "Arquivos", com o arquivo e a linha. O editor ganha `revealLine` pelo `diffProtocol`.
- URLs vão pelo `shell:openExternal` de hoje, que já aceita só `http` e `https`.

## Riscos

| Risco | Como fica |
|---|---|
| Ida e volta ao main a cada passada de mouse | Cache por sessão dos caminhos já conferidos, apagado quando o `RepoWatcher` avisa |
| Separadores e maiúsculas no Windows | `C:\x\y.ts:3`, `/c/x/y.ts:3` e `x\y.ts` testados; comparação sem diferenciar maiúsculas |
| Abrir arquivo de fora da pasta | Validado no main; recusa em silêncio |

## Como ficou

- `findLocations(line)` e `findUrls(line)` (`src/shared/locations.ts`) são puras e valem para qualquer saída de programa; o painel de problemas (24) lê com elas. `findLocations` só propõe candidatos: quem confirma é o main.
- `files:locate(sessionId, candidatos)` (`src/core/git/FileLocator.ts`) responde, para cada candidato, `{ path, isFile }` com o caminho relativo à pasta da sessão e barras normais, ou `null`. A checagem é feita no caminho real (`realpath`), então `..` e links simbólicos para fora recusam, e no Windows o nome volta com a caixa certa e sem nome curto 8.3. A resposta nunca diz o porquê da recusa.
- O provedor de links (`src/renderer/src/lib/terminalLinks.ts`) usa `registerLinkProvider` do xterm, com cache de 8 s das respostas do main (e limpeza quando o `RepoWatcher` avisa). Sem `Ctrl` o link não tem sublinhado nem cursor e o clique é ignorado. No lugar do `WebLinksAddon`, o clique em endereço também passa a pedir `Ctrl`.
- A saída das verificações usa o mesmo leitor (`LinkedOutput.tsx`); o clique fecha o diálogo e abre o painel.
- Abrir: o evento do renderer leva o App a abrir o painel em **Todos os arquivos**; o editor ganha a mensagem `reveal` no protocolo do iframe (`diffProtocol`) e a árvore expande até o arquivo.
- Fora do desenho: caminhos que só existem no repositório da sessão mas fora da pasta dela não viram link (o painel nomeia os arquivos a partir da pasta da sessão).
