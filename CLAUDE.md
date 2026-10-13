# Agent Controller

App Electron que roda sessões de Claude Code e Codex em uma janela só. O que o app faz e como usar está no [`README.md`](README.md); o porquê das decisões, em [`DECISOES-E-RISCOS.md`](DECISOES-E-RISCOS.md) e nas [ADRs](adr/README.md).

## Regras que não se negociam

### 1. Toda mudança sobe por pull request

- Nada vai direto para a `main`: nem commit, nem push, nem correção pequena.
- Trabalhe em uma branch, abra o PR contra a `main` e só faça o merge com o CI verde.
- Não faça commit nem push sem que o usuário peça.

### 2. Todo PR leva evidências

Um PR sem evidência não está pronto. A descrição do PR precisa mostrar que a mudança funciona:

- **Mudança visível na interface:** telas tiradas pelo Playwright e **anexadas ao PR** (arrastadas para a descrição ou para um comentário). O padrão está em `tests/e2e/evidences.spec.ts`: o teste monta o cenário e só grava a imagem com `EVIDENCES=1`.
- **Mudança sem interface (core, IPC, persistência):** a saída dos testes que cobrem a mudança, colada no PR.
- **Sempre:** quais comandos foram rodados, em qual sistema, e o resultado. Se algo não foi rodado ou falhou, diga isso no PR; não omita.

**Evidência não entra no repositório.** As imagens são geradas na pasta `evidences/`, que está no `.gitignore`, e vão para o PR como anexo. Nunca faça commit de tela, gravação ou saída de teste só para servir de evidência: isso suja o histórico e o diff. O texto que explica cada evidência também fica no PR, não em um arquivo do repositório.

**Antes × depois.** Toda evidência mostra os dois lados, lado a lado ou um logo após o outro, com a mesma tela, o mesmo cenário e o mesmo tamanho de janela:

- **Antes:** como estava na `main` (a tela, ou a saída do teste falhando, ou o comportamento errado).
- **Depois:** como ficou na branch do PR.
- Em funcionalidade nova, em que não existe "antes" equivalente, diga isso e mostre a tela de onde ela parte.

**Agrupadas de acordo com o que mostram.** Evidência solta não serve: cada uma fica junto das que tratam do mesmo assunto.

- No PR, uma seção por funcionalidade ou cenário alterado, com o antes × depois dele dentro; não uma lista única de imagens.
- Na pasta local `evidences/images/`, uma subpasta por funcionalidade (por exemplo `pastas/`, `painel-de-mudancas/`), com os pares nomeados de forma que fiquem juntos e em ordem: `01-trocar-pasta-antes.png`, `01-trocar-pasta-depois.png`. Assim os anexos sobem para o PR já na ordem certa.
- Em cada par, uma frase dizendo o que olhar.

Para gerar as telas:

```sh
npm run build
EVIDENCES=1 npx playwright test --config tests/e2e/playwright.config.ts <arquivo>.spec.ts
```

No PowerShell, `$env:EVIDENCES = '1'` antes do segundo comando.

Para o lado "antes", rode o mesmo teste sobre um build do código como estava (um `git worktree` da branch de base), com `EVIDENCES_PHASE=antes` e `EVIDENCES_DIR` apontando para a pasta `evidences/images` desta cópia.

### 3. Não quebrar a arquitetura

```
src/
  core/      Node puro, sem Electron: PTY, sessões, perfis de agente, sinais, git, persistência
  main/      processo principal do Electron: janela, notificações, IPC
  preload/   a única API exposta à interface
  renderer/  React: barra lateral, terminal, painel de mudanças
  shared/    tipos e contrato de IPC
```

- `src/core` não importa Electron nem nada de `main`, `renderer` ou `preload`.
- O renderer não acessa Node nem o core: fala só por `window.api`.
- Cada agente é um perfil (dados) mais um adaptador; nada fora de `src/core/agents` sabe qual agente está rodando.
- O contrato de IPC fica em `src/shared/ipc.ts`. Canal novo entra no tipo, na lista de canais e no handler de `src/main/ipc.ts`, juntos. Argumentos vindos do renderer são validados no main, nunca confiados.
- O preload expõe o mínimo. Ampliar essa superfície exige justificativa no PR.

O lint cobra as três primeiras regras (`eslint.config.mjs`, conferido por `tests/core/architecture.test.ts`). Não desligue uma regra nem use `eslint-disable` para contorná-la: se a regra atrapalha, a mudança está no lugar errado. Uma decisão que mude a arquitetura pede uma ADR nova em `adr/`.

### 4. Não quebrar em nenhum ambiente

O app roda em **Windows e Linux** (incluindo WSL2), em desenvolvimento e empacotado. Uma mudança que funciona em um e quebra em outro não entra.

- Caminhos: use `node:path`, nunca separador fixo. No Windows o nome de arquivo ignora maiúsculas e existem nomes curtos 8.3 (`toLongPath`).
- Processos e shell: o que depende do sistema (`cmd.exe` × `bash`, matar árvore de processos, sockets × named pipes) tem os dois caminhos e teste nos dois.
- Teste específico de um sistema usa `it.runIf(process.platform === ...)`, não some com o teste do outro.
- Mudou o core? Rode também no Linux: `npm run test:core:docker`.
- Não aumente o consumo de memória sem medir (`npm run measure`); a meta é a da [ADR 0009](adr/0009-meta-de-consumo-de-recursos.md).

## Antes de abrir o PR

```sh
npm run lint
npm run typecheck
npm run format:check
npm test                              # core (Vitest)
npm run test:core:docker              # core no Linux, quando o core mudou
npm run build && npm run test:e2e     # interface (Playwright), com um shell no lugar do agente
```

`npm run test:smoke` e `npm run test:smoke:app` usam os agentes reais, a conta do usuário e créditos: só rode se o usuário pedir.

## Convenções

- Textos da interface, mensagens de erro, commits e documentação em **português**; comentários e nomes no código em **inglês**.
- Comentário explica o porquê, não o que a linha faz.
- Comportamento novo vem com teste: core em `tests/core`, interface em `tests/e2e`.
- Mudou o que o usuário vê ou faz? Atualize o `README.md` no mesmo PR.
