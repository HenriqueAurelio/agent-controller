# M4 — See changes

**Objetivo:** ver o que o agente alterou, em uma interface parecida com a do VS Code. O painel só mostra; não reverte nem aceita trechos.

**Marco pronto quando:** depois de um agente editar, criar e apagar arquivos, o painel lista os três casos e o diff bate com `git diff`; o painel se atualiza sozinho; pasta sem git mostra o aviso.

**Independente do M3:** pode ser feito em paralelo.

---

## [x] 4.1 GitService

- **Frente:** C · **Tamanho:** M · **Depende de:** 0.1
- **Situação em 2026-10-13:** Pronta. `src/core/git/GitService.ts`; todo comando roda com `--no-optional-locks`, e um teste confere que ler o status não toca no índice.

**O que fazer**

- Módulo em `src/core/git` que chama o binário `git` por `child_process`, fora da thread da interface.
- Detectar se o git existe, a versão, e se a pasta é um repositório.
- Lista de mudanças por `git status --porcelain=v2 -z`: adicionado, modificado, removido, renomeado, não rastreado.
- Conteúdo de um arquivo no HEAD e no working tree.
- Detectar binários e arquivos grandes demais e sinalizar, em vez de devolver o conteúdo.
- Nunca executar comando que altere o repositório.

**Pronto quando:** testes com repositórios temporários cobrem cada tipo de mudança, nomes com espaço e acento, binário e pasta sem git.

**Pode começar cedo:** só depende do M0.

---

## [x] 4.2 Painel de arquivos modificados

- **Frente:** B · **Tamanho:** M · **Depende de:** 4.1, 0.2
- **Situação em 2026-10-13:** Pronta. O e2e compara a lista com os cinco tipos de mudança.

**O que fazer**

- Painel lateral ou sobreposto, por sessão, com os arquivos agrupados por pasta.
- Marcador de tipo de mudança por arquivo e contagem total.
- Seleção por mouse e teclado; o arquivo selecionado abre no diff.
- Estados vazios: nenhuma mudança, carregando, erro.
- Indicação clara de que o painel é somente leitura.

**Pronto quando:** a lista bate com `git status` em um repositório com os cinco tipos de mudança.

---

## [x] 4.3 Diff com Monaco

- **Frente:** B · **Tamanho:** M · **Depende de:** 4.2
- **Situação em 2026-10-13:** Pronta, com os dois modos. O Monaco fica em um iframe próprio, fora do bundle inicial. **Ressalva sobre a memória:** pelos private bytes ela volta ao fechar o painel; pelo working set sobram cerca de 20 MB (ADR 0009).

**O que fazer**

- Monaco diff editor em modo somente leitura, lado a lado e inline.
- Carregar o Monaco sob demanda, só quando o painel abre pela primeira vez.
- Descartar os modelos e o editor ao fechar o painel.
- Realce de sintaxe pela extensão do arquivo.
- Tratamento de arquivo novo, removido, binário e grande demais.

**Pronto quando:** o diff de um arquivo editado é igual ao de `git diff`; o Monaco não aparece no bundle inicial; a memória volta ao patamar anterior depois de fechar o painel.

**Cortável em parte:** o modo inline é o quarto item da ordem de corte.

---

## [x] 4.4 Atualização automática

- **Frente:** C · **Tamanho:** P · **Depende de:** 4.1
- **Situação em 2026-10-13:** Pronta. `src/core/git/RepoWatcher.ts`. Testes: aparece em menos de 2 s, uma rajada de 60 gravações vira uma atualização, e o que o `.gitignore` cobre não dispara nada.

**O que fazer**

- Watcher na pasta da sessão, ativo só enquanto o painel está aberto.
- Debounce para não reconsultar o git a cada gravação.
- Ignorar `.git` e o que o `.gitignore` cobre.
- Atualizar a lista e o diff aberto sem perder a posição de rolagem.

**Pronto quando:** com o painel aberto, uma edição feita pelo agente aparece em até 2 segundos, sem pico de CPU em uma rajada de gravações.

**Atenção:** eventos de arquivo não são confiáveis em `/mnt/g` no WSL. Testar com o repositório dentro do sistema de arquivos do Linux.

---

## [x] 4.5 Acesso ao painel e casos sem git

- **Frente:** B · **Tamanho:** P · **Depende de:** 4.2
- **Situação em 2026-10-13:** Pronta. Os casos "git ausente" e "git antigo" têm a tela, mas só "pasta sem git" tem teste automático.

**O que fazer**

- Abrir o painel por botão na sessão, por atalho e pela paleta de comandos ("See changes").
- Contador de arquivos modificados no botão.
- Tela específica para: pasta que não é repositório, git não instalado, git em versão antiga.

**Pronto quando:** os três caminhos abrem o painel; cada caso sem git mostra a mensagem certa com o que fazer.

---

## [x] 4.6 Diff desde o início da sessão

- **Frente:** C · **Tamanho:** M · **Depende de:** 4.1
- **Situação em 2026-10-13:** Pronta (não foi cortada). O snapshot usa um índice próprio fora do repositório; os testes comparam status, stash, refs e o índice antes e depois. Ele grava objetos soltos no banco de objetos do git, que o próprio git limpa depois.

**O que fazer**

- Ao iniciar uma sessão, registrar um snapshot do estado do repositório.
- O snapshot não pode tocar no índice, no working tree, no stash nem nos refs visíveis do usuário.
- Seletor no painel: comparar com o HEAD ou com o início da sessão.
- Limpar os snapshots ao fechar a sessão.

**Pronto quando:** `git status` e `git stash list` são idênticos antes e depois de criar o snapshot; o modo "início da sessão" mostra só o que mudou depois que o agente começou.

**Cortável:** primeiro item da ordem de corte. Sem ela, fica a comparação com o HEAD.
