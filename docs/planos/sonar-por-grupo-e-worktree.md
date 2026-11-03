# Sonar por grupo, com resultado por worktree

- **Estado:** implementado na v0.3 (2026-11-03). O que mudou na implementação está em [Como ficou](#como-ficou), no fim.

## Objetivo

Permitir uma validação adicional de qualidade de código pelo Sonar sem sair do Agent Controller. A conexão é configurada uma vez para o grupo que representa um repositório; a análise, os problemas e o estado continuam separados por sessão/worktree.

Isso atende ao caso em que duas sessões trabalham em branches diferentes do mesmo repositório: uma pode introduzir problemas e falhar no Sonar, enquanto a outra passa.

## Decisões de produto

- O ponto de entrada é o cabeçalho do **grupo**, em “Validações do repositório → Sonar”.
- A configuração é compartilhada pelo grupo, não por uma sessão individual.
- O resultado nunca é compartilhado: cada sessão conserva sua própria execução, data, estado e lista de problemas.
- O cabeçalho do grupo mostra somente o resumo agregado, por exemplo: `2 passaram · 1 com problemas`.
- Sonar é opcional e vem desligado. Os modos de execução são **Rodar agora** e **Ao fim do turno**.
- A primeira versão suporta **SonarQube** e **SonarCloud**.

## Fluxo pela interface

1. No grupo, a pessoa abre **Validações do repositório → Configurar Sonar…**.
2. Escolhe SonarQube ou SonarCloud.
3. Preenche projeto e token; para SonarQube, informa a URL (sugestão: `http://localhost:9000`); para SonarCloud, informa também a organização.
4. Clica em **Testar conexão**. A tela confirma servidor, credencial e projeto antes de salvar.
5. Escolhe se a análise roda ao fim do turno ou somente manualmente.
6. Em cada sessão, o status Sonar aparece junto às verificações. A aba **Problemas** mostra os itens daquele worktree, identificados por `Sonar`.

## Segurança

- O token não entra em `sessions.json`, nas preferências exportadas, no repositório, no comando do scanner nem no terminal do agente.
- O token é salvo pelo cofre seguro do sistema operacional (Electron `safeStorage`), associado ao identificador do grupo.
- A configuração persistida contém apenas provedor, URL, projeto, organização, estado e modo de execução.
- Quando o cofre seguro não estiver disponível, a tela explica a limitação e não persiste o token.

## Modelo de dados

Adicionar ao grupo uma configuração sem segredo:

```ts
interface SonarConfig {
  provider: 'sonarqube' | 'sonarcloud';
  url: string;
  projectKey: string;
  organization: string;
  enabled: boolean;
  onTurnEnd: boolean;
}
```

O token fica separado, indexado por `groupId`, no armazenamento protegido. Remover um grupo remove também a credencial dele.

## Execução

1. A fila de validações recebe uma entrada por **sessão**, nunca uma por grupo.
2. A análise roda no `cwd` do worktree da sessão e usa sua branch como `sonar.branch.name` quando aplicável.
3. A fila limita análises simultâneas por repositório para evitar sobrecarga e colisão de caches, mas não mistura resultados.
4. O scanner recebe o token por variável de ambiente do processo, sem expô-lo em argumentos ou saída.
5. Após a análise, o app consulta a API do Sonar para aquele projeto e branch, converte os achados em `arquivo`, `linha`, `severidade`, `regra` e `mensagem`, e os associa à execução da sessão.
6. A aba Problemas reaproveita a interface atual; o filtro/origem informa `Sonar`.

## Fases de implementação

### 1. Configuração e credenciais

- Tipo compartilhado, validação e persistência sem token.
- Serviço no processo principal para salvar, ler e apagar token com `safeStorage`.
- Diálogo de configuração no grupo, incluindo teste de conexão.
- Testes de validação, migração e credencial indisponível.

### 2. Execução por sessão

- Serviço `SonarService` no processo principal.
- Fila por repositório e cancelamento se a sessão voltar a trabalhar.
- Scanner em cada worktree, com timeout e saída limitada.
- Estado por sessão: aguardando, analisando, passou, falhou, erro ou cancelado.

### 3. Problemas e resumo

- Consulta à API de issues do Sonar depois de cada análise.
- Conversão para o tipo de problema já usado pelo painel.
- Status por sessão e resumo no cabeçalho do grupo.
- Ação “Rodar Sonar agora” no grupo e em cada sessão.

### 4. Evidências e documentação

- Testes de core com servidor HTTP simulado e worktrees/cwds distintos.
- E2E: configurar conexão, rodar em duas sessões e provar resultados diferentes.
- Atualizar README e anexar evidências antes/depois no PR.

## Limites da primeira versão

- Não inicia nem atualiza um servidor SonarQube por conta própria; a interface apenas se conecta a um servidor existente e explica como usar um local.
- Não tenta deduzir a organização ou a chave do projeto.
- Não substitui lint, typecheck ou testes; Sonar é uma validação adicional.
- A análise de branches depende da edição/licença e da configuração do servidor SonarQube; a interface mostra erro claro quando o servidor não a aceita.

## Como ficou

- **Onde configurar:** o botão **◈** no cabeçalho do grupo abre "Validações do repositório: Sonar". Não há um menu à parte.
- **Opção nova, "Analisar cada branch à parte"**, ligada por padrão. A análise por branch (`sonar.branch.name`) só existe no SonarCloud e nas edições pagas do SonarQube. Desligada, a Community Edition funciona, com todas as sessões do grupo analisadas como a branch principal.
- **Comando do scanner configurável**, `sonar-scanner` por padrão. Ele roda no shell do usuário, como as verificações, e por isso vale `npx @sonar/scan`.
  - Os parâmetros vão em `SONAR_SCANNER_JSON_PARAMS` (e `SONARQUBE_SCANNER_PARAMS`, para scanners antigos), não na linha de comando: assim não há problema de aspas entre `cmd.exe` e `bash`.
  - O token vai só em `SONAR_TOKEN` e é trocado por `***` em qualquer erro mostrado.
- **Pasta de trabalho do scanner** (`sonar.working.directory`): fica nos dados do app, uma por sessão, e não na cópia. Assim o agente não vê `.scannerwork` aparecer no `git status`.
- **Depois do scanner:** o app lê o `ceTaskId` do `report-task.txt`, espera o servidor processar (até 5 minutos) e lê o quality gate e as issues abertas.
  - Até 500 issues entram na aba **Problemas**, com a origem "Sonar". BLOCKER, CRITICAL e MAJOR viram erro; o resto, aviso.
  - Sem quality gate, qualquer issue aberta conta como "com problemas".
- **Cofre do sistema:** no Linux sem chaveiro (o Electron cairia no `basic_text`), o token não é salvo, e o diálogo diz isso.
- **Estado por sessão:** uma etiqueta "Sonar: …" no topo da sessão; clicar analisa de novo. O cabeçalho do grupo resume com `1✓ 1✗`, e a frase completa fica no texto de ajuda.
- **Rodar agora:** **Analisar as sessões agora**, no diálogo do grupo, ou "Sonar: analisar … agora" na paleta, para a sessão aberta. Duas análises do mesmo grupo não rodam ao mesmo tempo; uma espera a outra.
- **Cancelamento:** quando o agente da sessão volta a trabalhar, a análise dela é cancelada (o processo do scanner é encerrado com a árvore).
- **Arquivos:**
  - `src/shared/sonar.ts`;
  - `src/core/sonar/` (`SonarApi`, `SonarService`, `SonarConfigStore`);
  - `src/main/sonarTokens.ts`, o `safeStorage`;
  - os canais `sonar:*` em `src/main/ipc.ts`.
