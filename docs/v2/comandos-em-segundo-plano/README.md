# Comandos em segundo plano

- **Estado:** implementado.
- **Data:** 2026-11-01.

## O problema

Parte do trabalho depende de processos que ficam rodando o dia inteiro e não pertencem a nenhuma sessão: o proxy do Cloud SQL para acessar o banco (um alias como `sql_exp_prod`), um túnel, um servidor local. Hoje eles ficam num terminal à parte, fora do app. Quando o proxy cai (o login do `gcloud` venceu, a porta já está em uso), só se descobre quando a consulta do agente falha.

O terminal auxiliar não serve: ele é de uma sessão, fecha junto com ela e não volta sozinho quando o app abre.

## O que muda

Um painel **Comandos em segundo plano**, do app inteiro, aberto pelo botão **▶** no topo da barra lateral, por `Ctrl+Shift+K` ou pela paleta. Ele ocupa o lugar do terminal, como o quadro de tarefas e os pull requests.

- **Cada comando** tem um nome, uma linha de comando e, se quiser, uma pasta (sem pasta, a pessoal).
- **A caixa Ligado** liga e desliga:
  - marcada, o comando roda agora e volta a rodar sempre que o app abrir;
  - desmarcada, ele para;
  - um comando novo já é salvo ligado.
- **Tudo para quando o app fecha.** Nenhum proxy fica segurando a porta depois, e nada roda sem o app à vista.
- **Estado de cada um:** rodando (há quanto tempo), desligado, parou sozinho (com o código de saída) ou não iniciou (com o motivo).
- **Quando cai sozinho:**
  - chega um aviso, e o clique no aviso abre o painel na saída dele;
  - o botão **▶** mostra quantos caíram;
  - o comando não é reiniciado sozinho, porque repetir esconderia o motivo. **Reiniciar** sobe de novo, assim como desligar e ligar.
- **Saída:** cada comando tem a sua, num terminal, com o que ele escreveu desde que começou (até 200 mil caracteres). O que se digita ali vai para o comando, para um que pede login ou confirmação.
- **Editar** muda o nome, o comando ou a pasta; um comando ligado que mudou de linha ou de pasta sobe de novo com a nova. **Excluir** para e tira da lista.

Os comandos ficam nas preferências e vão junto na exportação; no máximo 30.

## O shell de cada sistema

Um alias só existe no shell que leu o perfil. Por isso, cada comando roda no shell do usuário, como ele abre no terminal:

- **Linux:** `$SHELL -ic '<comando>'`. O `-i` faz o bash ler o `.bashrc` (e o zsh, o `.zshrc`), onde ficam os aliases.
- **Windows:** PowerShell (o `pwsh`, se houver) com o perfil, com o comando codificado em `-EncodedCommand`, o mesmo caminho do comando personalizado do agente. As funções do perfil (`function sql_exp_prod { … }`) funcionam.

Nos testes, o shell abre sem o perfil (`-c` no Linux, `-NoProfile` no Windows).

## Como foi testado

- **`tests/core/background.test.ts`**, com processos de verdade:
  - ligar, a saída e cada pedaço dela; desligar;
  - o comando que cai sozinho: o código, um aviso só, continuar parado quando as preferências são salvas de novo, **Reiniciar**, desligar e ligar;
  - a linha ou a pasta que mudou;
  - a pasta que não existe;
  - tirar um da lista, e fechar o app parando todos.
  - **Só no Linux:** uma pasta pessoal temporária com um `.bashrc` que define `alias sql_exp_prod=…`, e o comando `sql_exp_prod` rodando por ele.
- **`tests/e2e/comandos-em-segundo-plano.spec.ts`:**
  - criar um comando, que já roda sem sessão nenhuma, e ver a saída;
  - desligar;
  - um comando que cai com o código 3 e o número no botão;
  - editar e reiniciar;
  - excluir;
  - `Esc`;
  - fechar o app e reabrir, com o comando ligado voltando a rodar.

  Depois de fechar o app, nenhum processo do comando ficou rodando.

## O que ficou de fora

- **Rodar no WSL a partir do Windows:** no Windows, o comando roda no PowerShell. Um alias do bash do WSL pode ser chamado com `wsl -e bash -ic 'sql_exp_prod'` como comando.
- **Continuar rodando depois de fechar o app:** foi descartado de propósito, para nenhum processo ficar esquecido.
- **Reiniciar sozinho quando cai:** se fizer falta, entra depois como opção de cada comando, com um limite de tentativas.
