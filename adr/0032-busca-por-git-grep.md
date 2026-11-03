# 0032 — Busca no projeto pelo `git grep`, sem empacotar o ripgrep

- **Status:** Aceita
- **Data:** 2026-11-03
- **Funcionalidade:** [buscar no projeto](../docs/funcionalidades/buscar-no-projeto/README.md) (`docs/proximas-versoes.md`, v0.5, item 12)

## Contexto

A proposta da busca deixou para uma ADR a escolha entre o ripgrep empacotado (`@vscode/ripgrep`, o do VS Code, cerca de 5 MB por sistema no instalador e um binário fora do `asar`) e o `git grep`, que o app já exige.

## Decisão

1. **Dentro de um repositório, `git grep`.** Ele respeita o `.gitignore`, pula binários (`-I`) e, com `--untracked`, inclui os arquivos novos que o agente criou e ainda não têm commit. Os filtros viram *pathspecs* (`:(glob)`, `:(exclude,glob)`), e "só nos arquivos mudados" usa a lista do `git status`.
2. **Expressão regular pelo `-P`** (Perl, próxima da do JavaScript: `\d`, `\s`). Se o git foi compilado sem PCRE, a busca refaz com `-E`. A expressão é compilada no JavaScript antes, para um erro voltar em palavras.
3. **Fora do git, uma leitura simples** dos arquivos que a caixa "abrir arquivo rápido" já lista (sem ocultos), pulando arquivos de mais de 1 MB e binários.
4. **Um processo por busca**, com prazo de 30 s e parada em 2 000 resultados (o processo é encerrado ao passar do limite). Nada fica residente.

## Alternativas consideradas

- **Empacotar o ripgrep.** Mais rápido em pastas enormes e igual dentro e fora do git, mas pesa no instalador dos dois sistemas e é mais um binário nativo para manter, como o `node-pty`.
- **Só o `git grep`.** Deixaria pastas sem git sem busca; a leitura simples cobre esse caso, que é raro e pequeno.

## Consequências

- O instalador não cresce.
- Pastas sem git muito grandes buscam mais devagar. O limite de arquivos da lista (50 mil) vale ali também.
- A sintaxe da expressão regular é a do PCRE do git (ou ERE, sem PCRE), não exatamente a do JavaScript; os casos comuns são iguais.
