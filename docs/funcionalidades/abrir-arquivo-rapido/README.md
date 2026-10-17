# Abrir arquivo rápido

- **Estado:** concluída (leva 2). Medida em 50 mil arquivos: ver o PR.
- **ADR:** nenhuma nova.

## O problema

Para abrir um arquivo que não mudou, a pessoa desce pela árvore pasta por pasta. Quem vem do VS Code ou do Zed digita `Ctrl+P`, três letras do nome e `Enter`.

## A ideia

`Ctrl+P` abre uma caixa de busca pelo nome, com correspondência aproximada (`sesmgr` acha `SessionManager.ts`), sobre todos os arquivos da pasta da sessão. `Enter` abre o arquivo no editor do painel.

## Como fica para quem usa

- `Ctrl+P` (editável em Preferências → Atalhos) abre a caixa no topo, no mesmo estilo da paleta de comandos.
- Vazia, a caixa lista os **arquivos abertos por último** naquela sessão e os que **mudaram**, marcados com a letra do painel.
- `nome:42` abre na linha 42.
- Os arquivos ocultos e ignorados seguem a caixa **Ocultos** do painel.
- Na paleta de comandos, digitar sem `>` no começo também busca arquivos, como no VS Code. Isso fica para depois, se a mudança na paleta incomodar quem já a usa.

## Onde entra na arquitetura

- **Core:** `src/core/git/FileIndex.ts`. Num repositório, a lista vem de `git ls-files -co --exclude-standard` (com `-z`), que é rápido e já respeita o `.gitignore`. Fora do git, ou com **Ocultos**, uma varredura com limite (50 mil arquivos), reaproveitando as regras do `FileBrowser`. A lista fica em memória **só enquanto a caixa está aberta**, e mais um minuto depois.
- **Correspondência:** no renderer, sobre a lista, com pontuação por início de palavra, `camelCase` e separadores de pasta (sem biblioteca nova, ou com uma pequena, medida).
- **IPC:** `files:index(sessionId, showHidden)`, que devolve a lista de caminhos relativos. Arquivos recentes por sessão ficam no store do renderer.

## Riscos

| Risco | Como fica |
|---|---|
| Repositório enorme (monorepo) | Limite de 50 mil, com aviso; a lista vai uma vez, não a cada tecla |
| Memória da lista | Liberada ao fechar a caixa; medido num repositório de 50 mil arquivos |
| Conflito de atalho com o terminal | `Ctrl+P` só vale com o foco fora do terminal do agente, ou com a preferência que o deixa global |
