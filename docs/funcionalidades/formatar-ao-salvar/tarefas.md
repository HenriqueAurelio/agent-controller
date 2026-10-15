# Formatar ao salvar: tarefas

**Pronto quando:** num repositório com Prettier, salvar um arquivo desalinhado no painel grava o arquivo formatado, e o mesmo com Biome e ESLint; sem formatador, salvar funciona como hoje; um formatador que falha ou trava não impede o salvamento; tudo nos dois sistemas.

Legenda igual à de [`tasks/`](../../../tasks/README.md): frente A = core, B = interface, C = infra; tamanho P = até 1 dia, M = 2 a 3 dias.

---

## [ ] 1.1 Binário do projeto

- **Frente:** A · **Tamanho:** P · **Depende de:** [verificações ao fim do turno](../verificacoes-pos-turno/tarefas.md) 4.1 (o `ToolRunner` nasce lá)

**O que fazer**

- Usar o `ToolRunner` no modo sem shell.
- `resolveProjectBin(repoRoot, file, packageName, binName)`: sobe do arquivo até a raiz procurando `node_modules/<pacote>/package.json`, lê o `bin` e devolve `{ command: node, args: [caminhoDoBin] }`. Nunca usa `node_modules/.bin/*.cmd`.
- Caminhos com `node:path`; no Windows, `toLongPath` no resultado.

**Pronto quando:** testes da resolução do binário num monorepo, com pasta com espaço e acento, rodando o `bin` pelo Node. Windows e `npm run test:core:docker`.

---

## [ ] 1.2 Perfis de formatador e detecção

- **Frente:** A · **Tamanho:** M · **Depende de:** 1.1

**O que fazer**

- `src/core/format/profiles.ts`: Prettier, Biome, ESLint e "comando", como dados: id, pacote, arquivos de configuração, extensões que trata, argumentos, como ler a saída (stdout cru ou JSON do ESLint).
- `detectFormatter(repoRoot, file)`: devolve o perfil que vale, a versão (do `package.json` do pacote) e o motivo. Ordem quando há mais de um: Biome, Prettier, ESLint. Uma preferência explícita vence a detecção.
- `formatText(profile, repoRoot, file, text)`: chama o `ToolRunner`, devolve `{ text }` ou `{ error }` com a mensagem da ferramenta.
- Reaplicar o fim de linha original no texto devolvido.

**Pronto quando:** testes com repositórios temporários e as ferramentas instaladas como `devDependencies` do próprio projeto de teste (fixtures em `tests/fixtures/format/`) formatam um arquivo `.ts` com cada uma; arquivo com erro de sintaxe devolve erro; repositório sem nada devolve "nenhum".

---

## [ ] 1.3 Preferências e confiança por repositório

- **Frente:** A · **Tamanho:** P · **Depende de:** nada

**O que fazer**

- Em `src/shared/prefs.ts`: `formatOnSave: boolean`, `formatter: 'auto' | 'prettier' | 'biome' | 'eslint' | 'command' | 'none'`, `formatterCommand: string`, `formatterByRepo: Record<string, FormatterId>`, `formatterTrust: Record<string, FormatterId[]>`. Tudo com sanitização e limite de tamanho.
- Exportar leva `formatOnSave` e `formatter`; **não** leva `formatterCommand`, `formatterByRepo` nem `formatterTrust`. Importar não os sobrescreve.

**Pronto quando:** `tests/core/prefs.test.ts` cobre valores inválidos descartados e o arquivo exportado sem confiança nem comando.

---

## [ ] 1.4 FormatService e IPC

- **Frente:** A · **Tamanho:** M · **Depende de:** 1.2, 1.3

**O que fazer**

- `src/core/format/FormatService.ts`: junta detecção, preferência e confiança. Sem confiança, devolve `{ needsTrust: perfil }` em vez de rodar.
- `src/shared/ipc.ts` e `src/main/ipc.ts`: `format:detect(sessionId, file)`, `format:document(sessionId, file, text)`, `format:trust(sessionId, formatterId)`. O main resolve o arquivo e exige que fique dentro do repositório da sessão, com a mesma função do `git:save`.
- Erros como `UserError` com chave de i18n.

**Pronto quando:** teste do core para o serviço (sem confiança não roda nada; com confiança, formata) e teste de contrato de IPC na lista de canais.

---

## [ ] 1.5 Formatar no painel

- **Frente:** B · **Tamanho:** M · **Depende de:** 1.4

**O que fazer**

- No `DiffView` (iframe do Monaco): ação "Formatar documento" (`Shift+Alt+F` e menu de contexto) aplica o texto devolvido como uma edição desfazível, no lado direito.
- Com "Formatar ao salvar" ligado, `Ctrl+S` e **Salvar** formatam antes de chamar `git:save`. Formatador falhou ou estourou o prazo: salva sem formatar e mostra o aviso.
- Rodapé do painel: "Prettier 3.3.3 do projeto", "sem formatador", ou "Prettier falhou: …" com link para a saída completa.
- Diálogo de confiança na primeira vez, com o nome da ferramenta e o caminho que vai rodar.
- Editor bloqueado enquanto formata (como na troca de arquivo), para o texto digitado não se perder.
- Textos em pt-BR, en e es.

**Pronto quando:** e2e em `tests/e2e` com um repositório de fixture que tem Prettier: salvar formata; recusar a confiança salva sem formatar; formatador quebrado salva e mostra o aviso. Evidência antes × depois no PR.

---

## [ ] 1.6 Preferências → Editor

- **Frente:** B · **Tamanho:** P · **Depende de:** 1.3

**O que fazer**

- Aba nova em `PreferencesDialog`: "Formatar ao salvar", "Formatador", "Comando" (habilitado só com "comando", com dica de `{file}`), e a lista de repositórios confiados com botão para esquecer cada um.

**Pronto quando:** e2e muda as opções e elas sobrevivem a reabrir o app.

---

## [ ] 1.7 Formatar arquivos alterados

- **Frente:** B · **Tamanho:** P · **Depende de:** 1.5

**O que fazer**

- Comando na paleta: "Formatar arquivos alterados em “{sessão}”". Confirmação com a contagem. Formata cada arquivo do painel (sem removidos, binários e grandes), gravando com a mesma checagem de conflito.
- Resultado: "12 arquivos, 3 mudaram, 1 falhou".
- Recusa se o agente da sessão estiver trabalhando, com o motivo.

**Pronto quando:** e2e com três arquivos desalinhados e um com erro de sintaxe.

---

## [ ] 1.8 ADR, README e medição

- **Frente:** C · **Tamanho:** P · **Depende de:** 1.5

**O que fazer**

- ADR nova em `adr/`: o painel passa a rodar ferramentas do projeto, com confiança por repositório; emenda a 0012.
- README: seção "Formatar ao salvar" em "Ver o que o agente alterou"; item em "Exportar e importar" sobre o que não vai no arquivo.
- `DECISOES-E-RISCOS.md` 3.6 (segurança): rodar código do repositório.
- `npm run measure` antes e depois: nenhum processo residente novo.

**Pronto quando:** ADR aceita, README atualizado, medição no PR.
