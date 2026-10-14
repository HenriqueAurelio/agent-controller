# M2 — Sessões e perfis

**Objetivo:** várias sessões nomeadas, cada uma com seu agente, que voltam na próxima abertura do app.

**Marco pronto quando:** dá para criar 5 sessões misturando Claude Code e Codex, alternar por atalho, fechar o app e reencontrar todas com nome, pasta e perfil.

---

## [x] 2.1 Modelo de sessão e store

- **Frente:** C · **Tamanho:** P · **Depende de:** 0.1
- **Situação em 2026-10-13:** Pronta. `src/core/store/`; os quatro casos do critério têm teste.

**O que fazer**

- Tipo `Session` em `src/shared`: id, nome, pasta, perfil, ordem, estado.
- Store em `src/core/store` que grava um JSON no diretório de configuração do usuário.
- Escrita atômica (arquivo temporário e rename) e cópia da versão anterior.
- Campo de versão do schema, com função de migração.
- Não persistir histórico de terminal nem variáveis de ambiente.

**Pronto quando:** testes cobrem gravar, ler, arquivo corrompido (cai para o backup) e migração de versão.

**Pode começar cedo:** só depende do M0.

---

## [x] 2.2 Perfis de agente como dados

- **Frente:** A · **Tamanho:** M · **Depende de:** 1.1
- **Situação em 2026-10-13:** Pronta. `src/core/agents/profiles.ts` e `commandLine.ts`. No Windows, o `notify` do Codex chama o executável do app direto, porque JSON não atravessa um `.cmd` (ADR 0011).

**O que fazer**

- Tipo `AgentProfile`: id, nome exibido, executável, parâmetros base, variáveis de ambiente, sinais suportados.
- Perfil **Claude Code**: abre com `--settings <arquivo do app>`.
- Perfil **Codex**: abre com `-c notify=[...]` e, quando os hooks estiverem ligados, `-c hooks.<Evento>=[...]`.
- Função que monta a linha de comando final a partir do perfil e da sessão.
- O comando dos hooks é idêntico em todas as sessões; o que identifica a sessão é a variável `AGENTCTL_SESSION_ID`.

**Pronto quando:** testes verificam a linha de comando gerada para cada perfil; abrir uma sessão de cada perfil inicia o agente certo.

**Contexto:** o Codex guarda a confiança como hash do comando do hook. Qualquer texto variável no comando faz o pedido de confiança voltar.

---

## [x] 2.3 Barra lateral de sessões

- **Frente:** B · **Tamanho:** M · **Depende de:** 1.3, 2.1
- **Situação em 2026-10-13:** Pronta. Renomear com F2 ou duplo clique, fechar com Delete, reordenar arrastando ou com Alt+setas (Ctrl+Shift+setas onde o gerenciador de janelas fica com o Alt). Coberta pelo e2e nos dois sistemas, exceto o arrastar com o mouse, que não tem teste automático.

**O que fazer**

- Lista de sessões com nome, perfil e indicador de estado.
- Diálogo de nova sessão: nome, seletor de pasta, escolha entre Claude Code e Codex.
- Renomear no lugar, fechar, reordenar por arrastar.
- Atalhos: próxima e anterior, ir para a sessão N, nova sessão.
- Trocar de sessão troca o terminal exibido.

**Pronto quando:** todas as ações funcionam por mouse e por teclado; o foco do teclado vai para o terminal ao trocar de sessão.

---

## [x] 2.4 Restaurar sessões e fechar com segurança

- **Frente:** B · **Tamanho:** P · **Depende de:** 2.3
- **Situação em 2026-10-13:** Pronta. A confirmação ao fechar o app é um diálogo nativo e não tem teste automático; o restante está no e2e.

**O que fazer**

- Ao abrir o app, listar as sessões salvas no estado "parada", com ação de iniciar.
- Ao fechar a janela com algum agente rodando, pedir confirmação listando quais sessões serão encerradas.
- Lembrar tamanho e posição da janela e a última sessão selecionada.

**Pronto quando:** fechar e reabrir o app mantém a lista; a confirmação aparece só quando há agente rodando.

---

## [x] 2.5 Detecção do agente instalado

- **Frente:** A · **Tamanho:** P · **Depende de:** 2.2
- **Situação em 2026-10-13:** Pronta. Testes simulam agente ausente, antigo e mais novo que o testado.

**O que fazer**

- Localizar o executável de cada perfil no PATH.
- Ler a versão e comparar com a mínima suportada declarada no perfil.
- No diálogo de nova sessão, desabilitar o perfil ausente, com instrução de instalação.
- Aviso não bloqueante quando a versão é mais nova que a última testada.

**Pronto quando:** sem o Codex no PATH, o perfil aparece desabilitado com a explicação; com versão antiga, aparece o aviso.

**Contexto:** versões testadas até agora: Claude Code 2.1.296 e Codex CLI 0.158.0.
