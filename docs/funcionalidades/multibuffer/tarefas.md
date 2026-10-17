# Multibuffer: tarefas

**Pronto quando:** um turno que mudou doze arquivos aparece numa rolagem só; a pessoa edita trechos de dois arquivos e salva os dois com `Ctrl+S`; marca arquivos como vistos; com 200 trechos a memória fica dentro do medido; nos dois sistemas.

---

## [ ] 29.1 Trechos de todos os arquivos

- **Frente:** C · **Tamanho:** M · **Depende de:** nada

**O que fazer**

- `ChangesService.hunks(base)`: trechos com posições no arquivo novo e no antigo, contexto ampliável, limite de tamanho.
- Canal `git:hunks`.

**Pronto quando:** testes do core com arquivo novo, apagado, renomeado, binário e com trechos colados.

---

## [ ] 29.2 Visão só leitura

- **Frente:** B · **Tamanho:** M · **Depende de:** 29.1

**O que fazer**

- **Tudo** no painel; um editor por trecho, virtualizado (no máximo 8 vivos); cabeçalho por arquivo; "mais 10 linhas"; "abrir no arquivo"; vistos.

**Pronto quando:** e2e com uma pasta de doze arquivos mudados.

---

## [ ] 29.3 Edição por trecho

- **Frente:** B · **Tamanho:** M · **Depende de:** 29.2

**O que fazer**

- Lado novo editável; salvar todos com `Ctrl+S`, do fim para o começo, pela conferência de hoje; desfazer por trecho.

**Pronto quando:** e2e edita dois trechos do mesmo arquivo e um de outro, salva e confere o disco; e o caso em que o agente escreveu no meio.

---

## [ ] 29.4 ADR, medição, README e evidências

- **Frente:** C · **Tamanho:** P · **Depende de:** 29.3

**O que fazer**

- `npm run measure` com 200 trechos. ADR nova, citando a 0012.
- README, em "Ver o que o agente alterou". Evidências em `evidences/images/multibuffer/`.

**Pronto quando:** PR com ADR, medição, README e telas.
