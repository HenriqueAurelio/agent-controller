# M0 — Fundação e provas

**Objetivo:** projeto de pé e as duas incertezas técnicas restantes resolvidas antes de construir em cima delas.

**Marco pronto quando:** o instalador gerado no CI abre um terminal no Windows e no Linux; os sinais dos agentes estão confirmados ou corrigidos para o Linux; existe um número de memória de partida.

---

## [x] 0.1 Scaffold do projeto

- **Frente:** C · **Tamanho:** P · **Depende de:** nada
- **Situação em 2026-10-13:** Pronta. `npm run dev`, `npm run lint` e `npm test` funcionam; um teste (`tests/core/architecture.test.ts`) garante que importar `electron` em `src/core` quebra o lint. Electron fixado em 44.7.0.

**O que fazer**

- Criar o projeto com electron-vite, React e TypeScript em modo estrito.
- Criar a estrutura de pastas do `PLANO.md`: `src/core`, `src/main`, `src/preload`, `src/renderer`, `src/shared`, `resources`, `tests`.
- Configurar ESLint, Prettier e Vitest.
- Regra de lint que proíbe importar `electron` dentro de `src/core`.
- Fixar a versão do Electron no `package.json`.

**Pronto quando:** `npm run dev` abre uma janela vazia; `npm run lint` e `npm test` passam; um import de `electron` em `src/core` quebra o lint.

---

## [x] 0.2 Contrato de IPC e preload seguro

- **Frente:** B · **Tamanho:** P · **Depende de:** 0.1
- **Situação em 2026-10-13:** Pronta. Contrato em `src/shared/ipc.ts`; o e2e confere que `require` e `process` não existem na interface, que o `ping` responde e que um canal fora do contrato é recusado.

**O que fazer**

- Definir em `src/shared` os tipos dos canais: comandos do renderer para o main e eventos do main para o renderer.
- Preload que expõe uma única API tipada via `contextBridge`.
- Janela com `contextIsolation: true`, `nodeIntegration: false`, `sandbox: true`.
- Bloquear navegação e abertura de janelas para conteúdo remoto.

**Pronto quando:** um comando de exemplo (`ping`) vai e volta com tipos checados nos dois lados; `window.require` e `process` não existem no renderer.

**Atenção:** este contrato é o ponto de encontro das frentes A e B. Mudanças depois daqui são combinadas em conjunto.

---

## [x] 0.3 Prova: node-pty dentro do Electron empacotado

- **Frente:** A · **Tamanho:** M · **Depende de:** 0.1
- **Situação em 2026-10-13:** Pronta. O app empacotado abre um shell e executa comandos no Windows (NSIS) e no Linux (`.deb` instalado e conteúdo do AppImage, em Docker). Como o binário foi obtido está registrado na ADR 0010.

**O que fazer**

- Adicionar node-pty e fazê-lo carregar no processo principal do Electron.
- Abrir um shell (`pwsh` no Windows, `bash` no Linux) e mostrar a saída crua na janela.
- Gerar um build empacotado com electron-builder e repetir o teste nele, nos dois sistemas.
- Registrar como o binário nativo foi obtido: pré-compilado ou `electron-rebuild`.

**Pronto quando:** o app empacotado abre um shell e executa um comando no Windows e no Linux.

**Se falhar:** é o risco 3.3 do `DECISOES-E-RISCOS.md`. Tentar binários pré-compilados alternativos antes de qualquer mudança de rumo, e registrar o resultado na ADR 0010.

**Contexto:** no Node puro, o node-pty 1.1.0 instalou no Windows sem compilar nada. Dentro do Electron ainda não foi testado.

---

## [~] 0.4 Prova: Claude Code e Codex no Linux

- **Frente:** A · **Tamanho:** M · **Depende de:** nada (precisa dos dois agentes instalados e logados no Linux)
- **Situação em 2026-10-13:** **Em andamento, esperando o login.** O Ubuntu do WSL foi preparado com `tools/wsl-setup.sh` (Node 22, Claude Code 2.1.296, Codex 0.162.1) e o repositório está em `~/src/agent-controller`, com os 221 testes do core passando. O roteiro com o Claude Code real já abre o agente e passa da pergunta de confiança na pasta, mas para em "Login expired"; o Codex não está logado. Falta: logar os dois no WSL (`claude` e depois `/login`; `codex login`) e rodar `npm run test:smoke`. O Codex do WSL é mais novo que a versão testada (0.158.0), o que também exercita o aviso de versão. Passo a passo em [`docs/pendencias/agentes-reais-no-linux.md`](../docs/pendencias/agentes-reais-no-linux.md).

**O que fazer**

- Repetir no Linux o roteiro feito no Windows, com os scripts de `tools/agent-probe/`.
- Claude Code: hooks por `--settings`; `Stop`, `PermissionRequest`, `Notification`; título da janela.
- Codex: `notify` por `-c`; tela "Hooks need review"; `PermissionRequest` depois de confiado; título da janela com `Action Required`; o aviso falso do turno de título.
- Observar o hook `Stop` do Codex em um turno interativo que termine sozinho (não foi visto no Windows).
- Anotar toda diferença em relação ao Windows.

**Pronto quando:** a tabela de validação da ADR 0011 tem uma coluna Linux preenchida, e toda diferença virou ajuste nas tarefas do M3.

---

## [~] 0.5 CI e ambiente Linux

- **Frente:** C · **Tamanho:** M · **Depende de:** 0.1
- **Situação em 2026-10-13:** Enviada ao GitHub (branch `v1`), **resultado do CI ainda não conferido**: o repositório é privado e a conta do `gh` desta máquina não o enxerga, então não deu para ler a execução daqui. O workflow roda em todo push. O que foi verificado localmente: o Dockerfile (`npm run test:core:docker`) e, no mesmo Docker, o empacotamento e os e2e no Linux. O guia do WSL2 está no README.

**O que fazer**

- GitHub Actions com runners Windows e Ubuntu: instalar, lint, testes, build.
- Dockerfile para rodar os testes de `src/core` sem interface.
- Publicar o build empacotado como artefato do CI nos dois sistemas.
- Documentar como abrir o app no WSL2, clonando o repositório dentro do sistema de arquivos do WSL (não em `/mnt/g`).

**Pronto quando:** um push dispara lint, testes e build nos dois sistemas; `docker run` executa os testes do core.

---

## [x] 0.6 Linha de base de memória

- **Frente:** C · **Tamanho:** P · **Depende de:** 0.3
- **Situação em 2026-10-13:** Pronta. `npm run measure`. Windows: 310 MB vazio, 354 MB com 1 terminal. Linux (Docker): 463 MB e 492 MB, com a ressalva de que esse número não representa uma máquina real. Tudo na ADR 0009.

**O que fazer**

- Script que soma a memória de todos os processos do app (principal, renderer, GPU, utilitários).
- Medir o app vazio e o app com 1 terminal aberto, nos dois sistemas.
- Registrar os números na ADR 0009.

**Pronto quando:** existem dois números por sistema registrados, e o script roda com um comando.
