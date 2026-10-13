# 0003 — UI: React + TypeScript + Vite

- **Status:** Aceita
- **Data:** 2026-10-12

## Contexto

A interface tem três peças principais: a barra lateral de sessões, o terminal e o painel de diff. As duas últimas vêm de bibliotecas prontas (xterm.js e Monaco), então o framework precisa integrá-las sem atrito.

## Decisão

**React + TypeScript**, com **Vite** como bundler.

## Alternativas consideradas

- **Svelte ou Solid.** Bundles menores e menos overhead em runtime, mas com menos exemplos e wrappers prontos para xterm.js e Monaco.
- **JavaScript puro, sem framework.** Viável para o terminal, trabalhoso para o estado da barra lateral e do painel de diff.

## Consequências

- Ecossistema amplo e integração conhecida com xterm.js e Monaco.
- O `electron-vite` cobre essa combinação para os três alvos do Electron (principal, preload e renderer).
- O custo de runtime do React é pequeno perto do terminal e do Monaco, que são os componentes pesados.

## Riscos e mitigação

| Risco | Mitigação |
|---|---|
| Re-renders do React interferindo no terminal durante saída intensa | xterm.js fica fora do ciclo de render: instância imperativa em um ref, alimentada direto pelo stream |
| Bundle inicial grande | Code splitting; Monaco só carrega quando o painel de diff abre |
