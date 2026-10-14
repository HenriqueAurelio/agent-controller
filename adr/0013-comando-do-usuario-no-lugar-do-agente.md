# 0013 — Comando do usuário no lugar do executável do agente

- **Status:** Aceita
- **Data:** 2026-10-13
- **Emenda:** [ADR 0007](0007-escopo-do-v1.md) e [ADR 0011](0011-perfis-de-agente.md), na parte em que "comando personalizado" ficava fora do v1. O restante continua valendo: só dois perfis, Claude Code e Codex; outras IAs e shell puro continuam fora.

## Contexto

A ADR 0011 definiu que a sessão abre o executável do perfil (`claude` ou `codex`), procurado no `PATH` e iniciado direto, sem shell. Comando personalizado ficou fora do v1 porque, na forma pensada então, serviria para rodar qualquer IA, com aviso de estado apenas aproximado.

Com o app em uso, o dono do produto apontou um caso que essa regra não atende: quem usa o mesmo agente de mais de um jeito mantém **aliases ou funções no perfil do shell**. O exemplo dele: `claude-work` e `claude-personal`, funções do PowerShell que definem `CLAUDE_CONFIG_DIR` (uma conta em cada pasta) e chamam o `claude` repassando os argumentos. Um alias só existe dentro do shell: o app, que inicia o executável direto, não o enxerga.

## Decisão

- Uma sessão pode ter um **comando**: uma linha, como seria digitada no terminal, que roda **no lugar do executável do agente**. O perfil continua sendo escolhido pelo usuário (Claude Code ou Codex) e é ele que diz como o estado da sessão é lido. O comando não escolhe o agente.
- O comando é informado em **Nova sessão** (campo opcional) e fica guardado com a sessão; duplicar leva junto. Em **Preferências → Geral → Agentes** há um comando por agente, usado pelas sessões que não têm o seu. Vazio nos dois, vale o comportamento da ADR 0011.
- O comando roda **no shell do usuário, iniciado como ele o inicia**, para que o perfil seja carregado:
  - Windows: PowerShell (`pwsh` se estiver no `PATH`, senão `powershell.exe`), com o perfil, e o script passado por `-EncodedCommand`.
  - Linux: `$SHELL -i -c "<comando> <argumentos>"` (`/bin/bash` se `SHELL` não estiver definido).
- O app **acrescenta ao comando os mesmos argumentos** que passaria ao agente (`--settings` no Claude Code, `-c` no Codex) e as mesmas variáveis de ambiente. Se o comando repassa os argumentos ao agente, os avisos funcionam como sempre.
- O comando das preferências vai no arquivo exportado, como as outras preferências.

## Alternativas consideradas

- **Só deixar trocar o nome do executável.** Resolve um script no `PATH`, mas não um alias nem uma função, que é o caso pedido.
- **Guardar variáveis de ambiente e argumentos em vez de um comando.** Daria o mesmo resultado para o exemplo acima sem passar por um shell, mas obriga a pessoa a traduzir o alias que ela já tem, e não cobre o que o alias fizer além disso.
- **Uma lista de variantes com nome ("Claude trabalho") no lugar de um campo livre.** Mais organizado, mas é mais interface para o mesmo efeito; os comandos já usados são sugeridos no campo.
- **Detectar o agente pelo comando.** Já descartada na ADR 0011, pelo mesmo motivo: frágil.

## Consequências

- A sessão com comando tem um processo a mais (o shell) e demora o tempo de o shell carregar o perfil.
- O app **não confere a versão** nem a existência do agente quando há comando: quem o encontra é o shell. Um agente que não está no `PATH` pode ser escolhido desde que haja um comando.
- O contrato de IPC não ganhou canal: `sessions:create` aceita `command`, validado no processo principal (uma linha, até 500 caracteres).
- `README.md` e o item 4.3 de `DECISOES-E-RISCOS.md` foram atualizados.

## Riscos e mitigação

| Risco | Mitigação |
|---|---|
| O comando não repassa os argumentos ao agente, e os hooks não são ligados. | O estado cai para as outras camadas (título do terminal e silêncio, ADR 0005), como em qualquer sessão sem hooks. Documentado no README. |
| Aspas e espaços nos argumentos se perdem no caminho até o agente. | Cada shell tem a sua forma de citar, e no Windows o script vai codificado. Um teste roda os shells de verdade com argumentos difíceis, nos dois sistemas. |
| O perfil do shell imprime texto ou pede algo ao iniciar. | Aparece no terminal da sessão, que é interativo. Não afeta a leitura do estado. |
| Um arquivo de configurações importado traz um comando que a pessoa não escreveu. | O comando fica visível nas preferências e no topo de cada sessão que o usa. O README avisa para só importar arquivos de origem conhecida. |
| O código de saída do agente se perde dentro de uma função do PowerShell. | O script sai com `$LASTEXITCODE`; comando inexistente sai com 1. |
