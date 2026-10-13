# M6 — Empacotamento e lançamento

**Objetivo:** instaladores para Windows e Linux e um v1 que uma pessoa de fora consegue instalar e usar.

**Marco pronto quando:** uma pessoa de fora instala pelo instalador nos dois sistemas e completa o roteiro: criar sessão, rodar agente, receber aviso, ver mudanças.

---

## [~] 6.1 Instaladores

- **Frente:** C · **Tamanho:** M · **Depende de:** 0.3
- **Situação em 2026-10-13:** Os três instaladores foram gerados e testados localmente (NSIS no Windows; `.deb` e AppImage em Docker), com ícone, nome e versão. O workflow de release (`.github/workflows/release.yml`) roda a cada tag `v*`, mas **nenhuma tag foi criada ainda** e o resultado do CI não foi conferido (ver 0.5). Falta também instalar em uma máquina limpa.

**O que fazer**

- electron-builder: NSIS no Windows, AppImage e .deb no Linux.
- Incluir o binário nativo do node-pty certo para a versão do Electron em cada sistema.
- Incluir o script `agentctl` e instalá-lo no caminho fixo por usuário.
- Ícone, nome e versão do app.
- Gerar os instaladores no CI a cada tag.

**Pronto quando:** os três instaladores saem do CI, instalam em máquina limpa e abrem um terminal.

**Fora do v1:** atualização automática e assinatura de código. Registrar no README que o Windows vai mostrar o aviso de aplicativo não reconhecido.

---

## [x] 6.2 Testes e2e de fumaça

- **Frente:** C · **Tamanho:** M · **Depende de:** M2
- **Situação em 2026-10-13:** Pronta. 12 roteiros, passando contra o app empacotado no Windows e no Linux (Docker com xvfb). No CI, ver 0.5.

**O que fazer**

- Playwright com suporte a Electron, abrindo o app empacotado.
- Roteiro: criar sessão com um shell de teste no lugar do agente, digitar um comando, ver a saída, renomear, fechar, reabrir o app.
- Roteiro do painel de mudanças com um repositório temporário.
- No Linux do CI, rodar com display virtual (xvfb).

**Pronto quando:** os roteiros passam no CI no Windows e no Ubuntu.

**Atenção:** estes testes não usam agentes reais. Os roteiros com Claude Code e Codex são os da tarefa 3.8, rodados sob demanda.

---

## [ ] 6.3 Validação no Linux real

- **Frente:** C · **Tamanho:** P · **Depende de:** 6.1
- **Situação em 2026-10-13:** **Não executada: bloqueada.** Precisa da máquina Linux real. Os instaladores para levar até ela estão em `dist-linux/`; o roteiro é: instalar, `npm run test:smoke`, `npm run test:smoke:app`, conferir notificação e clique, e `npm run measure`.

**O que fazer**

- Instalar o .deb e o AppImage na máquina Linux disponível.
- Roteiro completo com Claude Code e Codex reais.
- Conferir o que o WSL não cobre: notificações nativas, clique na notificação, foco de janela.
- Rodar a medição de memória da tarefa 5.4 nessa máquina.

**Pronto quando:** o roteiro completo passa na máquina real e os problemas encontrados estão corrigidos ou registrados.

**Não cortável.**

---

## [x] 6.4 README e guia de uso

- **Frente:** C · **Tamanho:** P · **Depende de:** M3
- **Situação em 2026-10-13:** Pronta. `README.md`. Não foi testada com alguém de fora, como pede o critério.

**O que fazer**

- Instalação nos dois sistemas e pré-requisitos (git, Claude Code, Codex).
- Como criar uma sessão e o que cada estado significa, incluindo "possivelmente aguardando".
- O passo de confiança do Codex: o que é a tela "Hooks need review" e o que escolher.
- Limitações do v1: fechar o app encerra os agentes; o painel de mudanças é somente leitura e exige git.
- Versões de agente testadas.

**Pronto quando:** alguém que nunca viu o projeto instala e usa só com o README.
