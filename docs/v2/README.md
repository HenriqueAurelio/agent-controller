# v2: desempenho e sessões que duram

- **Data:** 2026-10-31.
- **Origem:** a comparação com o [Maestro](https://github.com/rafaelmaestro/maestro) (Rust, GPUI) e o [CompozyOS](https://github.com/compozy/compozy) (daemon em Go com casca Electron), feita depois dos PRs #44 a #47, que cortaram de 65% a 86% do CPU do app.

Cada funcionalidade tem a sua pasta, com o problema, o que muda, como foi medido e o que ficou de fora. O estado de cada uma está no topo do `README.md` dela.

| Funcionalidade | O que muda | De onde veio |
|---|---|---|
| [Eco imediato](eco-imediato/README.md) | A tecla aparece no terminal sem esperar o lote de 8 ms | CompozyOS (`internal/terminal/coalescer.go`) |
| [Só a sessão visível recebe saída](so-a-sessao-visivel/README.md) | Terminais montados e escondidos param de interpretar a saída; ao voltar, recebem o que perderam ou são reconstruídos | Maestro (um terminal emulado) e CompozyOS (desmonta e guarda o histórico) |
| [Uso e contexto por sessão](uso-e-contexto/README.md) | Tokens e contexto ocupado de cada sessão, lidos do arquivo da conversa que o agente grava | Maestro (`src/session.rs`) e a proposta [uso e custo](../funcionalidades/uso-e-custo/README.md) |
| [Core em processo próprio](core-em-processo-proprio/README.md) | PTY, histórico, sinais e git saem do processo da janela | CompozyOS (daemon) e Maestro (herdr) |

As medições usam os scripts de `tools/perf` (`npm run measure:load`, `npm run measure:echo` e `tools/perf/compare.mjs` para o antes × depois).
