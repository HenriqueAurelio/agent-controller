# Verificações ao fim do turno

- **Estado:** proposta, escolhida para a primeira leva. Cria o `ToolRunner`, que [formatar ao salvar](../formatar-ao-salvar/README.md) vai reaproveitar.
- **ADR:** nova, "Verificações do projeto ao fim do turno".

## O problema

"Terminou" diz que o agente parou, não que o trabalho está certo. A pessoa volta à sessão, abre outro terminal, roda `npm test` e `npm run lint`, e só então descobre se pode seguir. Com dez sessões, isso é o gargalo.

## A ideia

Cada repositório pode ter uma lista de **verificações**: comandos que dizem se o estado está bom (`npm run lint`, `npm run typecheck`, `npm test`). Quando o agente termina um turno **que mudou arquivos**, o app roda as verificações em segundo plano e mostra o resultado na sessão.

- Na barra lateral, ao lado do estado: **✓** (tudo passou), **✗ 2** (duas falharam), ou um anel girando enquanto rodam.
- O aviso de fim de turno passa a dizer o resultado: "“api” terminou: testes falharam".
- Na sessão, uma aba **Verificações** com cada comando, o tempo e a saída. Falhou: **Mandar o erro ao agente** cola a saída (resumida) no terminal, com o envio criado pela [biblioteca de prompts](../biblioteca-de-prompts/README.md).

### De onde vêm as verificações

1. **Sugestão automática** a partir do `package.json`: scripts chamados `lint`, `typecheck`, `test`, `check`. A pessoa marca quais quer; nada roda sem ela escolher.
2. **À mão**, em **Preferências → Verificações** ou no próprio painel, por repositório.
3. **Por [extensões](../extensoes/README.md)**, mais tarde (ponto de extensão `checks`).

Cada uma tem: rótulo, comando, prazo (padrão 5 min) e quando roda (fim do turno, só sob demanda).

## Como fica para quem usa

- Desligado de fábrica. Liga por repositório, no primeiro uso, com a confiança pedida como no formatador.
- Rodar uma verificação **não muda nada** que o app saiba: é o comando do projeto. Se o comando escrever arquivos (um `lint --fix`), o painel de mudanças mostra.
- Uma verificação em andamento é cancelada se o agente voltar a trabalhar (o resultado já estaria velho) ou se a pessoa clicar em parar.
- Só uma rodada por sessão de cada vez; sessões diferentes podem rodar em paralelo, até um limite (padrão 2), para não afogar a máquina.

## Onde entra na arquitetura

- `src/core/checks/CheckService.ts`: escuta a transição de estado da sessão ("trabalhando" → "terminou"/"aguardando") que o `SignalAggregator` já emite, confere se o repositório mudou desde o início do turno (o `ChangesService` já sabe), e enfileira as verificações.
- **`src/core/tools/ToolRunner.ts`** (novo): roda um processo sem PTY, com prazo, limite de saída e `killTree`. Tem dois modos: direto (sem shell, argumentos separados), que o formatador vai usar, e **pelo shell do usuário**, que as verificações usam, porque uma verificação é um comando como a pessoa digitaria (`npm test`). Esse segundo modo segue o caminho do comando do agente ([ADR 0013](../../../adr/0013-comando-do-usuario-no-lugar-do-agente.md)).
- Fila global com limite de paralelismo; `killTree` ao cancelar.
- Estado da verificação entra em `src/shared/session.ts` (`checks?: { status, failed, finishedAt }`), que já chega à barra lateral por `sessions:changed`.
- IPC: `checks:get`, `checks:run`, `checks:cancel`, `checks:configure`.

## Riscos

| Risco | Como fica |
|---|---|
| Testes pesados derrubando a máquina com várias sessões | Paralelismo limitado, prazo, cancelamento ao voltar a trabalhar |
| Testes que dependem de terminal interativo | Rodam sem TTY, com `CI=1` no ambiente; documentado |
| Rodar código do repositório | Confiança por repositório e escolha explícita de cada comando |
| Memória | Processos só durante a verificação; `npm run measure` com uma verificação rodando entra no PR |
| Saída enorme | Guardar só o final (por exemplo, 200 KB) por verificação |
