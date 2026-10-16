# Realce de sintaxe e temas de cores: tarefas

**Estado:** todas feitas em 2026-10-16, num PR só. A sondagem (11.1) ficou dentro da implementação: Shiki com o motor JavaScript passou na CSP atual e nos testes, sem precisar de outro caminho.

**Pronto quando:** num arquivo TypeScript do painel, nomes de função, parâmetros e propriedades aparecem com cores próprias, como no VS Code; trocar o tema do código em Preferências muda as cores do painel aberto sem recarregar; trocar o tema do app troca o tema do código para o par claro/escuro escolhido; arquivo sem gramática ou grande demais continua com o realce de hoje; a memória com o painel fechado não muda; tudo nos dois sistemas.

Legenda igual à de [`tasks/`](../../../tasks/README.md): frente A = core, B = interface, C = infra; tamanho P = até 1 dia, M = 2 a 3 dias.

---

## [x] 11.1 Sondagem: Shiki no iframe do Monaco

- **Frente:** B · **Tamanho:** P · **Depende de:** nada

**O que fazer**

- Num branch de sondagem, carregar `shiki` com `@shikijs/engine-javascript` e `@shikijs/monaco` dentro de `diff.html`, com TypeScript e o tema Dark+.
- Medir: tamanho do `out/renderer` antes e depois; tempo para colorir um arquivo TS de 2 MB; `npm run measure` com o painel aberto.
- Conferir que o build roda com a CSP atual (sem `'wasm-unsafe-eval'`).
- Listar as gramáticas que o motor JS não aceita entre as linguagens que o Monarch já cobre.

**Pronto quando:** os números estão no PR da ADR (11.8) e a decisão Shiki × `vscode-textmate` está registrada. Se a sondagem mostrar custo acima da meta, a proposta volta para revisão antes das outras tarefas.

---

## [x] 11.2 Linguagem pelo tipo de arquivo

- **Frente:** B · **Tamanho:** P · **Depende de:** 11.1

**O que fazer**

- `src/renderer/src/lib/highlight/registry.ts`: extensão e nome de arquivo → id de linguagem (`Dockerfile`, `Makefile`, `.env`, `.gitignore`, `*.d.ts`, `*.mts`…), e a equivalência entre os ids do Monaco e os do Shiki.
- `languageFor(path, associations, override)`: a escolha manual vence a associação do usuário, que vence a tabela. Padrões comparados sem diferenciar maiúsculas no Windows.
- O resto (linguagem sem gramática) devolve `null` e fica com o Monarch.

**Pronto quando:** teste unitário da tabela, das associações e da equivalência de ids (rodado pelo Vitest, como os de `src/shared`).

---

## [x] 11.3 Gramáticas TextMate no painel

- **Frente:** B · **Tamanho:** M · **Depende de:** 11.2

**O que fazer**

- Em `diffFrame.ts`, criar o highlighter do Shiki sob demanda, carregar a gramática da linguagem do arquivo (`import()` por linguagem) e registrá-la no Monaco com `@shikijs/monaco`.
- Recuo para o Monarch quando: a gramática não existe, falha ao carregar, ou o arquivo passa dos limites de tamanho (5 000 linhas ou linha com mais de 20 000 caracteres).
- Expor no `document.body.dataset` a linguagem e o motor em uso (`textmate` ou `monarch`), para os testes.

**Pronto quando:** e2e abre um `.ts`, um `.py`, um `Dockerfile` e um arquivo grande e confere a linguagem e o motor; um token de nome de função tem cor diferente da de um identificador comum.

---

## [x] 11.4 Temas embutidos

- **Frente:** B · **Tamanho:** M · **Depende de:** 11.3

**O que fazer**

- `src/shared/codeThemes.ts`: lista dos temas embutidos (id, chave de i18n do nome, tipo claro/escuro), cada um com a licença conferida.
- `src/renderer/src/lib/highlight/themes.ts`: id → `import()` do JSON do tema.
- Os dois temas padrão, "Agent Controller escuro/claro": Dark+ e Light+ com as cores de fundo e borda do `PALETTE` atual por cima.
- Cores de diff do app como base, sobrepostas só pelas que o tema define.
- A mensagem `show` do `diffProtocol.ts` passa a levar `codeTheme`; trocar o tema não recria o modelo nem perde a edição em andamento.

**Pronto quando:** e2e troca o tema com um arquivo aberto e editado (sem salvar) e confere que a edição continua lá e a cor do fundo mudou.

---

## [x] 11.5 Preferências e importação de tema

- **Frente:** A · **Tamanho:** M · **Depende de:** 11.4

**O que fazer**

- `src/shared/prefs.ts`: `codeThemeDark`, `codeThemeLight` (id desconhecido volta ao padrão; tema claro no campo escuro também), `fileAssociations` (limite de 100 entradas, padrão e id como texto curto).
- `sanitizeTheme` em `src/shared/codeThemes.ts`: só `name`, `type`, `colors`, `tokenColors`; cores só em hex; escopos só como texto; limite de 512 KB; JSON com comentários aceito, como o VS Code.
- Canal `theme:import` em `src/shared/ipc.ts` e `src/main/ipc.ts`: o main abre o diálogo, lê, valida e grava no `appStore` (`customThemes`, com limite de quantidade). Nenhum argumento vem do renderer.
- Exportar leva `codeThemeDark`, `codeThemeLight` e `fileAssociations`; não leva os temas importados.
- Erros como `UserError` com chave de i18n ("O arquivo não é um tema do VS Code").

**Pronto quando:** testes de `prefs` e de `sanitizeTheme` (cor inválida descartada, chave estranha descartada, arquivo grande recusado, tema real do VS Code aceito); teste do contrato de IPC na lista de canais.

---

## [x] 11.6 Preferências → Editor, com prévia

- **Frente:** B · **Tamanho:** M · **Depende de:** 11.5

**O que fazer**

- Aba "Editor" em `PreferencesDialog` (criada aqui ou por [formatar ao salvar](../formatar-ao-salvar/tarefas.md) 1.6, quem vier primeiro): "Tema do código no modo escuro", "no modo claro", associações por extensão e "Importar tema do VS Code…".
- Prévia: `diff.html?mode=preview`, somente leitura, com um trecho fixo e um bloco alterado; acompanha a seleção da lista com as setas.
- Comando "Tema do código…" na paleta, com prévia ao vivo no painel aberto; `Esc` volta ao tema anterior.
- Rodapé do painel: a linguagem detectada; um clique abre a lista para trocar só aquele arquivo (não persiste).
- Textos em pt-BR, en e es.

**Pronto quando:** e2e escolhe um tema, reabre o app e o tema continua; troca o tema do app e o tema do código acompanha; importa um tema de fixture. Evidência antes × depois no PR: o mesmo arquivo TS no painel, com o realce de hoje e com o novo, e a aba Editor com a prévia.

---

## [x] 11.7 Medição e desempenho

- **Frente:** C · **Tamanho:** P · **Depende de:** 11.3

**O que fazer**

- `npm run measure` antes e depois, com o painel fechado e aberto num arquivo TS de 2 MB.
- Tamanho do `out/renderer` antes e depois, e o que vai no `index.html` (deve ser nada novo).
- Tempo até o primeiro realce num arquivo médio (500 linhas), Windows e Linux.

**Pronto quando:** números no PR, dentro da meta da ADR 0009.

---

## [x] 11.8 ADR e README

- **Frente:** C · **Tamanho:** P · **Depende de:** 11.1

**O que fazer**

- ADR nova em `adr/`: realce TextMate e temas no painel, motor JS em vez de WASM, temas como dados, importação validada; emenda a 0004.
- README: "Temas do código" em "Ver o que o agente alterou"; item em "Exportar e importar" sobre os temas importados ficarem de fora.
- Licenças dos temas e do Shiki onde o projeto registra as de terceiros.
- Linha 11 na tabela de [`docs/funcionalidades/README.md`](../README.md).

**Pronto quando:** ADR aceita e README atualizado no mesmo PR da interface.
