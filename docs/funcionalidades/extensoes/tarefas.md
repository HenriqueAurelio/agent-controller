# Extensões: tarefas

**Pronto quando:** uma extensão em `~/.agent-controller/extensions` com um formatador Python, uma verificação e um comando funciona sem mudar o código do app; Prettier, Biome e ESLint viram extensões embutidas no mesmo formato; uma extensão do repositório só roda depois de confiada.

**Depende de:** [formatar ao salvar](../formatar-ao-salvar/tarefas.md) (tarefas 1.1 a 1.4) e [verificações ao fim do turno](../verificacoes-pos-turno/tarefas.md) (tarefas 4.1 a 4.3).

---

## [ ] 2.1 Esquema do manifesto

- **Frente:** A · **Tamanho:** M · **Depende de:** nada

**O que fazer**

- `src/shared/extensions.ts`: tipos do manifesto (`manifestVersion: 1`, `id`, `name`, `version`, `contributes`).
- `src/core/extensions/manifest.ts`: validação estrita, sem dependência nova se der (o projeto já sanitiza preferências à mão); campos desconhecidos recusados; `id` em `[a-z0-9-]`; comandos como lista de argumentos, nunca string.
- Erros com chave de i18n e o caminho do campo (`contributes.formatters[0].command`).

**Pronto quando:** `tests/core/extensionManifest.test.ts` com manifestos válidos, inválidos, com campos a mais e enormes.

---

## [ ] 2.2 Registro e descoberta

- **Frente:** A · **Tamanho:** M · **Depende de:** 2.1

**O que fazer**

- `src/core/extensions/ExtensionRegistry.ts`: lê as extensões embutidas, as do usuário e as do repositório da sessão; uma extensão inválida fica desabilitada com o erro.
- Recarga ao mudar a pasta de extensões (observador com debounce, como o `RepoWatcher`).
- Hash do manifesto do repositório, para pedir confiança de novo quando ele mudar.

**Pronto quando:** testes cobrem a ordem de precedência (repositório > usuário > embutida, por id), recarga, e extensão quebrada sem afetar as outras.

---

## [ ] 2.3 Formatadores vindos do registro

- **Frente:** A · **Tamanho:** M · **Depende de:** 2.2, formatar ao salvar 1.4

**O que fazer**

- Reescrever Prettier, Biome e ESLint como manifestos embutidos em `resources/extensions/`.
- `FormatService` pede os formatadores ao registro. O comportamento visível não muda.
- Placeholders `{file}`, `{folder}`, `{repo}` como argumentos inteiros.

**Pronto quando:** os testes de formatar ao salvar passam sem mudança, e um teste novo formata Python com uma extensão de fixture (com `ruff` falso que só imprime o stdin).

---

## [ ] 2.4 Verificações e comandos vindos do registro

- **Frente:** A · **Tamanho:** M · **Depende de:** 2.2, verificações 4.3

**O que fazer**

- `CheckService` pede as verificações ao registro.
- Comandos de extensão: `extensions:runCommand(sessionId, extensionId, commandId)`. O main busca o comando pelo id; o renderer nunca envia o comando.
- Saída num painel de saída por sessão (o mesmo das verificações).

**Pronto quando:** e2e roda um comando de extensão pela paleta e vê a saída.

---

## [ ] 2.5 Confiança das extensões do repositório

- **Frente:** B · **Tamanho:** M · **Depende de:** 2.2

**O que fazer**

- Ao abrir uma sessão num repositório com `.agent-controller/extensions`, uma faixa: "Este repositório traz 2 extensões. Ver e confiar". O diálogo lista **cada comando que pode rodar**, com destaque para os `"shell": true`.
- Confiança guardada por repositório e hash; mudou o arquivo, pede de novo.

**Pronto quando:** e2e: repositório com extensão não roda nada antes de confiar; depois de mudar o manifesto, a faixa volta.

---

## [ ] 2.6 Preferências → Extensões

- **Frente:** B · **Tamanho:** P · **Depende de:** 2.2

**O que fazer**

- Lista das extensões (embutidas, do usuário, do repositório atual), com o estado, o erro de validação e um botão para desligar cada uma.
- "Abrir pasta de extensões" e "Recarregar".

**Pronto quando:** e2e liga e desliga uma extensão e a contribuição some da paleta.

---

## [ ] 2.7 Documentação, exemplos e ADR

- **Frente:** C · **Tamanho:** P · **Depende de:** 2.3, 2.4

**O que fazer**

- ADR "Extensões declarativas", com a alternativa recusada (host de JavaScript) e o porquê.
- `docs/extensoes.md` com a referência do manifesto e três exemplos: Python (ruff, pytest), Go (gofmt, go test), .NET (dotnet format).
- README: seção curta apontando para a referência.

**Pronto quando:** os três exemplos rodam copiados para a pasta, em Windows e Linux.
