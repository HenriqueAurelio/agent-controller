# 0019 — Realce TextMate e temas de cores no painel de mudanças

- **Status:** Aceita
- **Data:** 2026-10-16
- **Emenda:** [ADR 0004](0004-diff-monaco-e-git-cli.md), que carregava só o núcleo do Monaco e as gramáticas dele (Monarch), e [ADR 0007](0007-escopo-do-v1.md), que não previa temas de código. O resto das duas continua valendo.

## Contexto

O painel colore o código com as gramáticas Monarch do Monaco. Elas são grossas: a de TypeScript emite `keyword`, `identifier`, `type.identifier`, `string`, `number`, `comment`, `regexp` e `delimiter`, e nada para função, parâmetro ou propriedade. Uma chamada `formatar(total)` sai inteira na cor do texto. Arquivos comuns num repositório (JSON, TOML, Vue, Svelte, Makefile) nem gramática Monarch têm, e saíam sem cor. E os dois temas do painel tinham `rules: []`: as cores eram as do `vs-dark` e do `vs` do Monaco, sem escolha.

Quem usa o app passa o dia no VS Code. Ler um diff com cores diferentes das de sempre é mais lento. É a proposta 11 de [`docs/funcionalidades`](../docs/funcionalidades/realce-de-sintaxe/README.md).

## Decisão

### Gramáticas

- O painel usa as **gramáticas TextMate** do VS Code, empacotadas pelo **Shiki** (MIT, pacotes `shiki`, `@shikijs/langs`, `@shikijs/themes`). Uma tabela em `src/shared/codeLanguages.ts` liga extensão e nome de arquivo (`Dockerfile`, `Makefile`, `.env*`, `tsconfig.*`) a uma das 144 linguagens. As associações do usuário (`*.mdc = markdown`) vêm antes da tabela.
- Cada gramática é um pedaço separado do build, carregado na primeira vez que um arquivo daquela linguagem aparece. A lista é escrita uma a uma em `src/renderer/src/lib/highlight/loaders.ts`, não por glob, para só elas entrarem no build; um teste confere que a lista e a tabela batem.
- O motor de expressões é o de **JavaScript** do Shiki (`shiki/engine/javascript`, modo `forgiving`), não o Oniguruma em WebAssembly. A política de conteúdo das páginas (`script-src 'self'`) continua sem `'wasm-unsafe-eval'`.
- A ponte com o Monaco é nossa (`textmate.ts`), não a do `@shikijs/monaco`: a deles registra todas as linguagens e temas de uma vez, na partida. Cada token recebe o nome da cor que o tema ativo lhe dá (`t<índice>`, mais `.f<estilo>` para itálico e negrito), e o tema do Monaco tem uma regra por cor. Trocar de tema registra de novo os provedores, e o Monaco colore o arquivo aberto outra vez.
- O **Monarch continua** como recuo: linguagem fora da tabela, gramática que falhou ao carregar, ou arquivo com mais de 30 000 linhas (dos dois lados do diff). As linguagens TextMate pegam do Monarch a configuração do editor (comentário, colchetes, recuo); as que não têm Monarch recebem uma genérica.
- No painel, ao lado do nome do arquivo, um seletor mostra a linguagem detectada e deixa escolher outra (ou texto simples) só para aquele arquivo, enquanto o painel está aberto.

### Temas

- 33 temas do VS Code vêm com o app (Dark+, Light+, Monokai, One Dark Pro, Dracula, GitHub, Solarized, Nord, Tokyo Night, Catppuccin, Gruvbox, Night Owl, Material, Ayu, Rosé Pine, Vitesse, Kanagawa e outros), todos MIT pelo pacote `@shikijs/themes`.
- Os padrões são **Agent Controller escuro** e **claro**: as cores de token do Dark+ e do Light+ com o fundo e as bordas do app, para o painel não parecer uma janela estranha. Os outros temas trazem o próprio fundo.
- Há **um tema para o app escuro e outro para o claro** (`codeThemeDark` e `codeThemeLight` nas preferências). Trocar o tema do app troca o do código junto, e um tema claro não aparece sobre o app escuro por engano.
- O que o tema não diz (as cores do diff, sobretudo) vem do tema base do Monaco (`inherit: true`). Os tokens do Monarch, no recuo, recebem a cor que o tema dá ao escopo TextMate equivalente.
- **Importar tema do VS Code:** um arquivo `.json` de tema, como os das extensões. O main abre o diálogo e lê o arquivo; `sanitizeCodeTheme` (em `src/shared/codeThemes.ts`) fica só com nome, tipo, cores em hexadecimal e regras de token, aceita comentários e vírgulas sobrando, e recusa acima de 512 KB. Tema que só estende outro (`include`) é recusado com o motivo. Os importados ficam em `<dados do app>/themes/`, um arquivo cada, fora das preferências: um tema pode ter centenas de KB, e as preferências vão à janela a cada mudança.

### Onde roda

- Shiki, gramáticas e temas só são carregados dentro do iframe do painel (`diff.html`), que já é removido ao fechar o painel. A página principal ganha só a tabela de linguagens e a lista de temas.
- A prévia de Preferências → Editor é o mesmo `diff.html`, somente leitura, com um trecho fixo de código.

## Alternativas consideradas

- **Só trocar as cores do Monarch.** Barato, mas não resolve o problema: o Monarch não tem token de função, parâmetro nem propriedade.
- **`vscode-textmate` + `vscode-oniguruma` direto.** É o que o VS Code usa, mas exige o WASM do Oniguruma (e afrouxar a CSP) e empacotar as gramáticas à mão. O Shiki traz as mesmas gramáticas, já em módulos, e o motor em JavaScript.
- **`@shikijs/monaco`.** Registra todas as linguagens e temas carregados de uma vez e troca o `setTheme` do Monaco; não serve para carregar sob demanda.
- **Realce semântico** (cor por variável local × parâmetro, como o VS Code faz com o servidor de linguagem). Pede um servidor de linguagem rodando; fica fora.
- **Aplicar o tema ao app inteiro.** O app continua escuro ou claro; o tema do código vale para o painel.

## Consequências

- O build do renderer cresce de 8,1 MB para 16 MB. Quase tudo são as gramáticas e os temas, cada um num arquivo à parte (o maior, o de C++, com 790 KB), carregados só quando um arquivo daquela linguagem aparece. O pedaço do iframe passa de 5,32 MB para 5,71 MB, e a página principal, de 1,382 MB para 1,393 MB (a tabela de linguagens e a lista de temas).
- O contrato de IPC ganhou `themes:list`, `themes:get`, `themes:import` e `themes:remove`. O renderer manda só o id do tema; o arquivo é escolhido e lido no main.
- As preferências ganharam `codeThemeDark`, `codeThemeLight` e `fileAssociations`, que vão no arquivo de exportação. Os temas importados não vão: um id de tema que não existe na outra máquina volta ao tema do app.

## Riscos e mitigação

| Risco | Mitigação |
|---|---|
| Arquivo grande deixar o painel lento (TextMate é mais caro que Monarch) | Acima de 30 000 linhas, Monarch; linha com mais de 20 000 caracteres fica sem cor; 500 ms de limite por linha. O Monaco colore a parte visível primeiro e o resto aos poucos |
| Gramática que o motor JavaScript não aceita | Modo `forgiving`: o padrão que falha deixa de casar, em vez de derrubar a gramática; uma gramática que falha ao carregar cai no Monarch |
| Tema importado malformado ou malicioso | Só JSON; tudo que não é cor em hexadecimal ou escopo é descartado; limite de tamanho; validado no main antes de gravar; id do tema nunca vira caminho fora da pasta de temas |
| Diff ilegível num tema que não define as cores de diff | `inherit: true`: as cores de diff do Monaco valem quando o tema não traz as suas |
| Memória | Tudo no iframe que já existia e é destruído ao fechar o painel. Medido com `npm run measure` (Windows 10, build de desenvolvimento, 10 sessões, um `.ts` de 300 linhas aberto): 505 MB na `main` × 512 MB com o painel aberto; 448 × 454 MB fechado, após coleta de lixo. A `main` já passava dos 450 MB da ADR 0009 nesse cenário; por decisão de 2026-10-16, a referência para esta funcionalidade é ficar bem abaixo do VS Code, não o teto |
