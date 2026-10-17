# Painel geral: tarefas

**Pronto quando:** com oito sessões em dois grupos, o painel geral mostra cada uma com o estado e as últimas linhas, ordena as que aguardam primeiro e abre a sessão no `Enter`, sem aumentar a memória além do medido; nos dois sistemas.

---

## [ ] 16.1 Últimas linhas no core

- **Frente:** A · **Tamanho:** P · **Depende de:** nada

**O que fazer**

- `ScreenHistory.tail(lines)`: texto puro, sem escape, sem linhas vazias nem de borda.
- Evento `sessions:tails` agrupado, uma vez por segundo, ligado e desligado por `overview:watch(boolean)`.

**Pronto quando:** testes do core com saída de TUI, linhas longas e Unicode largo.

---

## [ ] 16.2 Grade de cartões

- **Frente:** B · **Tamanho:** M · **Depende de:** 16.1

**O que fazer**

- `components/Overview.tsx`: blocos por grupo, cartões com estado, tempo no estado, linhas, branch, verificações e mudanças.
- Filtro, ordenação por atenção, teclado.
- Atalho `Ctrl+Shift+O` em `shared/shortcuts.ts`, e o comando na paleta.

**Pronto quando:** e2e com três sessões de shell falso, filtrando e abrindo pelo teclado.

---

## [ ] 16.3 Encaixes das outras propostas

- **Frente:** B · **Tamanho:** P · **Depende de:** 16.2 e, cada um, da proposta dele

**O que fazer**

- Botões de permissão, fila e custo no cartão, conforme cada proposta ficar pronta.

**Pronto quando:** cada encaixe entra no PR da proposta correspondente.

---

## [ ] 16.4 Medição, README e evidências

- **Frente:** C · **Tamanho:** P · **Depende de:** 16.2

**O que fazer**

- `npm run measure` com 12 sessões, com o painel aberto e fechado.
- README: "Painel geral". Evidências em `evidences/images/painel-geral/`.

**Pronto quando:** PR com a medição, README e telas.
