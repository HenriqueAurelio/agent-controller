# Formatar ao salvar

- **Estado:** proposta.
- **ADR:** nova, "O painel roda o formatador do projeto", emendando a [0012](../../../adr/0012-see-changes-permite-editar.md).

## O problema

O painel de mudanças deixa editar e salvar ([ADR 0012](../../../adr/0012-see-changes-permite-editar.md)), mas grava o texto como foi digitado. Num projeto com Prettier, Biome ou ESLint, o ajuste feito no painel sai fora do padrão: o CI reclama, ou o agente reformata o arquivo no turno seguinte e o diff se enche de ruído que não é dele.

O mesmo vale para o que o agente escreve: nem todo agente roda o formatador antes de terminar, e a pessoa só percebe no commit.

## A ideia

O app **usa a ferramenta que o projeto já tem**, na versão que o projeto fixou, com a configuração do projeto. Não traz formatador próprio e não instala nada.

- **Ao salvar no painel:** o texto passa pelo formatador antes de ir para o disco.
- **Formatar agora:** um comando (paleta e menu do editor, `Shift+Alt+F`) formata o arquivo aberto sem salvar, como edição desfazível.
- **Formatar arquivos alterados:** um comando na paleta formata, de uma vez, os arquivos que aparecem no painel de mudanças. Pede confirmação e mostra quantos mudaram.
- **Corrigir com ESLint:** `eslint --fix` como formatador, para quem usa ESLint com regras de estilo.

### Ferramentas da primeira entrega

| Ferramenta | Como o app detecta | Como chama (sem gravar no disco) |
|---|---|---|
| Prettier | `prettier` em `node_modules` e um arquivo de configuração (`.prettierrc*`, `prettier.config.*`, chave `prettier` no `package.json`) | `prettier --stdin-filepath <arquivo>` |
| Biome | `@biomejs/biome` em `node_modules` e `biome.json` / `biome.jsonc` | `biome format --stdin-file-path=<arquivo>` (e `biome check --write` pelo stdin, se o usuário escolher "corrigir") |
| ESLint | `eslint` em `node_modules` e `eslint.config.*` / `.eslintrc*` | `eslint --stdin --stdin-filename <arquivo> --fix-dry-run --format json` e lê `output` |
| Comando do usuário | configurado à mão | uma linha que lê o stdin e escreve o stdout, com `{file}` substituído |

O **comando do usuário** cobre o resto sem código novo: `ruff format -`, `black -q -`, `gofmt`, `rustfmt --emit stdout`, `dotnet csharpier --write-stdout`. Ferramentas de outras linguagens viram detecção automática depois, por [extensões](../extensoes/README.md).

Tudo passa pelo **stdin**: o formatador nunca grava no arquivo. Assim a regra da ADR 0012 continua de pé: o app confere se o disco ainda tem o que o editor carregou, e só então grava. O formatador não disputa o arquivo com o agente.

## Como fica para quem usa

- Em **Preferências → Editor** (aba nova): "Formatar ao salvar" (desligado de fábrica) e "Formatador": automático, Prettier, Biome, ESLint, comando, nenhum.
- A escolha pode ser **por repositório**: o painel mostra no rodapé qual formatador vale ali ("Prettier 3.3.3 do projeto") e um clique troca.
- **Primeira vez num repositório:** antes de rodar qualquer binário do projeto, o app pergunta: "Este projeto usa Prettier (node_modules/prettier). Rodar ao salvar?". Rodar `node_modules` é rodar código do repositório; um repositório recém-clonado não executa nada só por ser aberto. A resposta fica guardada por repositório.
- **Falhou?** O arquivo é salvo como estava (salvar nunca fica refém do formatador) e o rodapé mostra "Prettier falhou: erro de sintaxe na linha 12". O detalhe abre num painel com a saída da ferramenta.
- **Demorou?** Prazo de 5 s. Passou disso, o processo é encerrado, o arquivo é salvo sem formatar e o aviso diz o motivo.

## Onde entra na arquitetura

```
renderer (DiffView)            main (ipc.ts)                 core
  Ctrl+S ──► format:document ──► valida repo/arquivo ──► FormatService
                                                            ├─ detectFormatter(repo)  → perfil da ferramenta (dados)
                                                            ├─ trust(repo)            → prefs
                                                            └─ ToolRunner.run(cmd, stdin, prazo) → stdout
         ◄── texto formatado ◄──
  aplica como edição ──► git:save (como hoje, com a checagem de conflito)
```

- **`src/core/tools/ToolRunner.ts`**, criado por [verificações ao fim do turno](../verificacoes-pos-turno/README.md): roda um processo com stdin, prazo, limite de saída e `killTree`. O formatador usa o modo sem shell e acrescenta a resolução do binário do projeto: lê o `package.json` do pacote em `node_modules` e roda o `bin` com o Node do sistema. Isso evita o `.cmd` do Windows e as regras de aspas do `cmd.exe`.
- **`src/core/format/`** (novo): os perfis de formatador são **dados** (como os perfis de agente): nome, como detectar, argumentos, como ler a saída. Nada fora dali sabe qual ferramenta é.
- **IPC:** `format:detect` (qual formatador vale para o repositório) e `format:document` (formata um texto). Os dois recebem o caminho do arquivo, que o main resolve e exige dentro do repositório da sessão, como o `git:save`.
- **Preferências:** `formatOnSave`, `formatter`, `formatterCommand` e `formatterTrust` (repositório → ferramenta confiada), todos sanitizados em `src/shared/prefs.ts`. O arquivo de exportação leva `formatOnSave` e `formatter`, mas **não** leva a confiança nem o comando: importar um arquivo não pode fazer o app rodar algo novo.
- **Processo:** nenhum residente. Um processo por formatação, encerrado ao fim. O custo é tempo (Prettier abre em 300 a 800 ms), não memória.

## Fora desta entrega

- Diagnósticos do ESLint como sublinhado no editor (fica para [extensões](../extensoes/README.md) ou uma segunda fase).
- Formatar o que o agente escreve automaticamente, sem a pessoa pedir: disputaria o arquivo com o agente no meio do turno. Quem quiser isso usa [verificações ao fim do turno](../verificacoes-pos-turno/README.md).
- Processo do formatador mantido aberto entre salvamentos (servidor do Prettier, daemon do Biome): só se o tempo medido incomodar.

## Riscos

| Risco | Como fica |
|---|---|
| Rodar código do repositório (um `node_modules` malicioso) | Confiança pedida por repositório, antes da primeira execução; nunca vem de um arquivo importado |
| O formatador travar ou demorar | Prazo de 5 s com `killTree`; o arquivo é salvo sem formatar |
| Saída enorme ou binária | Limite de tamanho igual ao do salvamento; acima dele, recusa |
| Fim de linha trocado | Depois de formatar, o app reaplica o fim de linha que o editor preserva hoje |
| Diferença Windows × Linux | `ToolRunner` testado nos dois; no Windows, binário resolvido sem `.cmd` |
| Projeto sem Node no `PATH` | A detecção diz "Prettier encontrado, mas o Node não está no PATH"; sem formatador, salvar funciona como hoje |
| Monorepo, com a ferramenta só num pacote | A busca sobe do arquivo até a raiz do repositório e usa o `node_modules` mais próximo |
