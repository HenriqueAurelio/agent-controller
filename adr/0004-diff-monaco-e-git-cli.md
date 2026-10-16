# 0004 — See changes: Monaco diff + binário git

- **Status:** Aceita
- **Data:** 2026-10-12
- **Emendada por:** [ADR 0012](0012-see-changes-permite-editar.md), de 2026-10-13: o painel deixou de ser somente leitura e passou a permitir editar e salvar o arquivo. O que esta ADR diz sobre "somente leitura" não vale mais; o restante vale.
- **Emendada por:** [ADR 0019](0019-realce-textmate-e-temas.md), de 2026-10-16: o realce de sintaxe passou a usar as gramáticas TextMate do VS Code e temas de cores; as gramáticas do Monaco ficaram como recuo.

## Contexto

Parte dos usuários se sente insegura deixando um agente alterar código sem ver o que mudou. O comando "See changes" precisa listar os arquivos modificados e abrir a diferença em uma interface parecida com a do VS Code.

## Decisão

- **Monaco diff editor** para exibir o diff, lado a lado e inline. É o editor do próprio VS Code.
- Dados obtidos chamando o **binário `git`** instalado na máquina: `git status --porcelain=v2` para a lista, conteúdo do HEAD e do working tree para o diff, incluindo arquivos não rastreados.
- Dois modos de comparação: contra o HEAD e "desde o início da sessão" (snapshot tirado ao abrir a sessão).
- Atualização automática por file watcher com debounce.
- O v1 **só mostra** as mudanças; não reverte nem aceita trechos.

## Alternativas consideradas

- **libgit2 (crate git2).** Evita depender do git instalado, mas diverge do git real em casos como filtros, atributos e configurações do usuário.
- **CodeMirror merge view.** Mais leve que o Monaco, porém visualmente distante do VS Code, que é o requisito.
- **Abrir o VS Code externo (`code --diff`).** Exige o VS Code instalado e tira o usuário do app.
- **Diff próprio de diretórios, sem git.** Cobre pastas sem repositório, mas é trabalho demais para o v1.

## Consequências

- O resultado é exatamente o que o git do usuário mostraria.
- O git passa a ser pré-requisito da funcionalidade.
- Pastas que não são repositório git não têm "See changes" no v1; o painel mostra uma mensagem clara nesse caso.

## Riscos e mitigação

| Risco | Mitigação |
|---|---|
| O Monaco tem alguns MB e pesa na memória e no carregamento | Carregar sob demanda, só quando o painel de diff abre, e descartar ao fechar |
| Git ausente ou em versão antiga | Checar na inicialização e desabilitar o painel com aviso |
| Repositórios grandes deixam `git status` lento | Debounce no watcher e execução fora da thread da UI |
| O snapshot de início de sessão pode alterar o estado do repositório | Criar o snapshot sem tocar no índice nem no working tree; é a tarefa 4.6 e a primeira candidata a corte |
