# Grupos de sessões

- **Estado:** feita (tarefas 10.1 a 10.4).
- **ADR:** não pede. É organização da lista: não muda o escopo do v1 nem a arquitetura (core, IPC e interface seguem o `CLAUDE.md`).

## O problema

Com várias sessões no mesmo repositório (uma no back, outra no front, outra nos testes) e mais de um repositório aberto, a barra lateral vira uma lista única, na ordem em que as sessões foram criadas. Para achar "as do repositório X" é preciso ler nome por nome, e o que está aguardando num repositório se mistura com o resto.

## A ideia

A pessoa cria **grupos** com um nome (por exemplo, `XXX-REPO`) e põe neles as sessões que quiser. Na barra lateral, cada grupo é um cabeçalho com as suas sessões embaixo.

- **Criar:** botão **⊞** no topo da barra lateral, ou a paleta. O nome já vem com a pasta da sessão aberta, e as sessões abertas nessa pasta já vêm marcadas: o caso comum, um grupo por repositório, sai em um clique.
- **Pôr e tirar:** arrastar para o cabeçalho ou entre as sessões do grupo; arrastar para a faixa que aparece no topo da lista para tirar; paleta ("Mover … para o grupo …", "Tirar … do grupo …"); `Alt+↑` / `Alt+↓` além da borda do grupo.
- **Recolher:** o cabeçalho mostra quantas sessões o grupo tem e, recolhido, quantas estão aguardando você. A sessão aberta continua à vista mesmo num grupo recolhido.
- **Nova sessão no grupo:** **+** no cabeçalho, ou o campo **Grupo** em **Nova sessão**. **Duplicar** mantém a cópia no grupo.
- **Desfazer o grupo** não fecha nenhuma sessão: elas só deixam de estar agrupadas.

O grupo é escolhido pela pessoa, não deduzido da pasta: uma sessão pode estar num grupo de outro repositório (por exemplo, "frente de pagamento" com back e front em repositórios diferentes).

## Onde entra na arquitetura

- `src/shared/session.ts`: `SessionGroup { id, name, collapsed }` e `Session.groupId?`.
- `SessionManager` guarda os grupos junto com as sessões. A lista é sempre **as sessões sem grupo, depois cada grupo com as suas, na ordem dos grupos**. É a mesma ordem que a barra lateral mostra e que `Ctrl+1` … `Ctrl+9` e "próxima sessão" seguem. Reordenar nunca tira uma sessão do grupo; quem muda o grupo é `setGroup`.
- Persistência: `AppData.groups` em `sessions.json`, validado na leitura; uma sessão que aponta para um grupo que não existe volta sem grupo. Fora do arquivo de exportação, como as sessões.
- IPC: `sessions:setGroup`, `groups:create`, `groups:update`, `groups:remove`, `groups:reorder`, todos validados no main. O retrato da lista (`sessions:list`, `sessions:changed`) passa a levar `groups`.

## Riscos

| Risco | Como fica |
|---|---|
| A ordem da lista e a dos atalhos se desencontrarem | Uma ordem só, mantida no core; a barra lateral só a desenha |
| Sessão "sumir" num grupo recolhido | A sessão aberta fica sempre à vista; o cabeçalho mostra contagem e quantas aguardam |
| Desfazer o grupo por engano | Não fecha nada: as sessões voltam para a lista sem grupo |
| `sessions.json` com grupo inválido | Validado na leitura; nome vazio ou id repetido é descartado, e a sessão fica sem grupo |
