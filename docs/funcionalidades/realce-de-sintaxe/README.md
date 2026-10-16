# Realce de sintaxe e temas de cores

- **Estado:** implementada (2026-10-16).
- **ADR:** [0015](../../../adr/0015-realce-textmate-e-temas.md), "Realce TextMate e temas de cores no painel", emendando a [0004](../../../adr/0004-diff-monaco-e-git-cli.md).

> **O que mudou em relação a esta proposta ao implementar:** a ponte com o Monaco é própria (`src/renderer/src/lib/highlight/textmate.ts`), porque a do `@shikijs/monaco` registra tudo na partida; o limite do TextMate ficou em 30 000 linhas (não 5 000), já que o Monaco colore a parte visível primeiro; a lista tem 33 temas; as preferências salvam na hora, como as outras; a paleta ganhou um comando por tema ("Tema do código: Nord") em vez de uma lista com prévia; e a meta de memória da ADR 0009 deixou de ser limite para esta funcionalidade, por decisão de 2026-10-16: o que conta é ficar mais leve que o VS Code e ser útil.

## O problema

O painel de mudanças já colore o código, mas pouco. O Monaco carrega só as gramáticas **Monarch** (`src/renderer/src/lib/monaco.ts`), e elas são grossas: a de TypeScript, por exemplo, só emite `keyword`, `identifier`, `type.identifier`, `string`, `number`, `comment`, `regexp` e `delimiter`. **Não existe token de função, de parâmetro, de propriedade nem de variável.** Uma chamada `formatText(profile)` sai inteira na cor do texto, e o arquivo parece outro para quem passa o dia no VS Code.

Além disso, só há dois temas, `app-dark` e `app-light` (`src/renderer/src/diffFrame.ts`), com `rules: []`: as cores dos tokens são as do `vs-dark` e do `vs` do Monaco, e não dá para escolher outras. Quem está acostumado com Dark+, Monokai ou One Dark lê o diff mais devagar.

## A ideia

Trocar a gramática, não o editor. O VS Code colore com **gramáticas TextMate** (`.tmLanguage.json`), e os temas do VS Code são escritos contra os escopos delas (`entity.name.function`, `variable.parameter`, `support.type.property-name`…). Com as mesmas gramáticas e os mesmos temas, o painel fica com as cores do VS Code, sem trazer o VS Code.

O caminho é o **[Shiki](https://shiki.style)** (MIT), que empacota as gramáticas e os temas do VS Code e tem a ponte pronta para o Monaco (`@shikijs/monaco`):

- **Gramática pelo tipo de arquivo.** A extensão (e o nome, para `Dockerfile`, `Makefile`, `.env`, `.gitignore`) escolhe a linguagem, como hoje o Monaco faz pela URI. Cada gramática é um pedaço separado, carregado só quando um arquivo daquela linguagem aparece.
- **Motor de expressões em JavaScript** (`@shikijs/engine-javascript`), não o Oniguruma em WASM: a política de conteúdo do app (`script-src 'self'`) não precisa ganhar `'wasm-unsafe-eval'`, e não há 600 KB de WASM a mais. As poucas gramáticas que o motor JS não aceita caem no Monarch de hoje.
- **Temas do VS Code** como dados: cada tema é o JSON que o VS Code usa (`tokenColors` + `colors`), aplicado ao Monaco pelo Shiki.
- **O Monarch fica como rede de segurança:** linguagem sem gramática TextMate, gramática que falhou ao carregar, ou arquivo grande demais para o tokenizador (ver Riscos) continuam com o realce de hoje.

### Temas da primeira entrega

| Tema | Tipo | Origem |
|---|---|---|
| **Agent Controller escuro** (padrão) | escuro | Dark+ com o fundo e as bordas do app |
| **Agent Controller claro** (padrão) | claro | Light+ com o fundo e as bordas do app |
| Dark+ / Dark Modern | escuro | VS Code (MIT) |
| Light+ / Light Modern | claro | VS Code (MIT) |
| Monokai | escuro | VS Code (MIT) |
| One Dark Pro | escuro | tm-themes (MIT) |
| Dracula | escuro | tm-themes (MIT) |
| GitHub Dark / GitHub Light | os dois | tm-themes (MIT) |
| Solarized Dark / Solarized Light | os dois | VS Code (MIT) |
| Nord, Tokyo Night, Catppuccin Mocha / Latte | escuro / claro | tm-themes (MIT) |
| Alto contraste escuro / claro | os dois | VS Code (MIT) |

A licença de cada tema é conferida antes de entrar na lista; um tema sem licença clara fica de fora.

Os dois temas padrão existem para que o painel não pareça uma janela estranha (a razão do `PALETTE` em `diffFrame.ts`): cores de token do VS Code, fundo do app. Os outros trazem o próprio fundo.

## Como fica para quem usa

- Em **Preferências → Editor** (aba nova, a mesma que [formatar ao salvar](../formatar-ao-salvar/README.md) propõe): dois campos, **"Tema do código no modo escuro"** e **"no modo claro"**, como o `preferredDarkColorTheme` do VS Code. Trocar o tema do app (escuro ↔ claro) troca o tema do código junto, e um tema claro nunca aparece sobre o app escuro por engano.
- **Prévia ao lado da lista:** um trecho curto (uma função TypeScript com parâmetro, string, comentário e um bloco alterado do diff) desenhado com o tema escolhido. Passar pela lista com as setas já mostra a prévia; nada é salvo até confirmar.
- **Paleta de comandos:** "Tema do código…" abre a mesma lista, com prévia ao vivo no painel aberto, como `Ctrl+K Ctrl+T` no VS Code.
- **Rodapé do painel:** a linguagem detectada ("TypeScript"). Um clique troca a linguagem só daquele arquivo, para os casos em que a extensão engana (um `.conf` que é nginx, um script sem extensão).
- **Associações por extensão** em Preferências → Editor: `*.mdc → markdown`, `*.tpl → html`, como o `files.associations` do VS Code.
- **Importar tema do VS Code** (segunda fase): escolher um arquivo `.json` de tema (de uma extensão instalada no VS Code, por exemplo). O app valida, guarda uma cópia e o tema entra na lista.

As cores do diff (linha incluída, removida, bloco alterado) vêm do tema quando ele as define (`diffEditor.insertedTextBackground` e afins); quando não define, o app usa as de hoje, para o diff nunca ficar ilegível.

## Onde entra na arquitetura

```
renderer (iframe diff.html)                            main
  diffFrame.ts
    ├─ highlight/registry.ts   extensão/nome → linguagem (dados)
    ├─ highlight/themes.ts     id → import() do JSON do tema (dados)
    ├─ shiki + @shikijs/monaco → setTokensProvider por linguagem, defineTheme
    └─ Monarch atual           → quando não há gramática ou ela falha
  mensagem "show" leva { codeTheme, languageOverride }

  PreferencesDialog ── prévia num <iframe diff.html?mode=preview>
                                                    prefs: codeThemeDark, codeThemeLight,
                                                           fileAssociations, customThemes
  "Importar tema" ── theme:import ───────────────►  abre o diálogo, lê o arquivo,
                                                    sanitizeTheme (shared), grava no store
```

- **Tudo no iframe do Monaco.** O Shiki, as gramáticas e os temas só são carregados dentro de `diff.html`, que já é removido quando o painel fecha. A página principal não ganha nenhum byte de realce, e a memória volta ao fechar o painel, como hoje.
- **A prévia das Preferências** usa o mesmo `diff.html` num modo de prévia (somente leitura, um texto fixo), em vez de carregar o Shiki na página principal.
- **`src/shared/codeThemes.ts`** (novo): a lista de temas embutidos (id, nome, tipo claro/escuro) e `sanitizeTheme`, que aceita só `name`, `type`, `colors` e `tokenColors`, só cores `#rgb`/`#rrggbb`/`#rrggbbaa`, só escopos como texto, e recusa acima de 512 KB. Fica em `shared` porque o main valida e o renderer usa.
- **Preferências** (`src/shared/prefs.ts`): `codeThemeDark`, `codeThemeLight` (id de tema; id desconhecido volta ao padrão), `fileAssociations: Record<string, string>` (padrão de nome → id de linguagem, com limite de quantidade). Os temas importados ficam no `appStore`, não nas preferências, porque são grandes.
- **IPC:** um canal novo, `theme:import`, sem argumento vindo do renderer: o main abre o diálogo de arquivo, lê, valida e devolve o tema já limpo. Entra no tipo, na lista e no handler juntos.
- **Exportar e importar preferências:** levam `codeThemeDark`, `codeThemeLight` e `fileAssociations`. Temas importados não vão no arquivo (o arquivo de preferências fica pequeno, e o tema pode ser importado de novo).
- **O core não muda.** Realce é apresentação; nada em `src/core` sabe de cor.
- **Terminal fora desta entrega.** O xterm continua com o tema dele (`terminalHost.ts`); as cores ali são as que o agente manda. Ver "Fora desta entrega".

## Fora desta entrega

- **Realce semântico** (cor diferente para variável local × parâmetro × propriedade, como o VS Code faz com o servidor de linguagem): pede um servidor de linguagem rodando, o que contradiz a decisão de não trazer serviços de linguagem ao Monaco (`monaco.ts`) e a meta de memória da [ADR 0009](../../../adr/0009-meta-de-consumo-de-recursos.md).
- **Aplicar o tema do código ao app inteiro** (barra lateral, terminal): o tema do app continua escuro/claro. Levar as cores ANSI do tema (`terminal.ansi*`) para o xterm é uma extensão natural, mas é outra decisão.
- **Instalar tema pelo marketplace** do VS Code ou do Open VSX: só importação de arquivo local.
- **Realce na árvore de arquivos** (ícones por tipo de arquivo, como o Material Icon Theme).

## Riscos

| Risco | Como fica |
|---|---|
| Arquivo grande deixa o painel lento (TextMate é mais caro que Monarch) | Acima de 5 000 linhas ou de uma linha com mais de 20 000 caracteres, o arquivo usa o Monarch; tokenização limitada a um tempo por linha, como o `maxTokenizationLineLength` do Monaco. Medir com um arquivo de 2 MB, o limite do `GitService` |
| Tamanho do pacote | Gramáticas e temas como pedaços separados, carregados sob demanda; nada entra no `index.html`. Conferir no PR o tamanho do `out/renderer` antes e depois |
| Memória | Tudo no iframe que já existe e é destruído ao fechar; `npm run measure` com o painel aberto num arquivo TS grande, antes e depois, contra os 450 MB da ADR 0009 |
| Gramática incompatível com o motor JS | Teste que carrega cada linguagem da lista e tokeniza um exemplo; a que falhar fica marcada para usar o Monarch |
| CSP | O motor JS dispensa WASM; se um dia o Oniguruma for necessário, a mudança na política vai para a ADR |
| Tema importado malicioso ou malformado | Só JSON; `sanitizeTheme` descarta tudo que não for cor ou escopo; limite de tamanho; validado no main antes de gravar |
| Licença de tema | Lista fechada, cada tema com a licença conferida e citada em `THIRD-PARTY` ou equivalente |
| Diff ilegível em tema que não define as cores de diff | Cores de diff do app como base, sobrepostas só quando o tema as traz |
| Diferença de nomes entre Monaco e Shiki (`shell` × `shellscript`, `csharp` × `c#`) | Tabela de equivalência em `highlight/registry.ts`, com teste |
