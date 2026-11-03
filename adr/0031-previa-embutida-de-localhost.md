# 0031 — Prévia embutida, só de páginas desta máquina

- **Status:** Aceita
- **Data:** 2026-11-03
- **Funcionalidade:** prévia no app (`docs/proximas-versoes.md`, v0.5, item 11)

## Contexto

Quando o agente mexe numa tela, a pessoa abre o navegador, acha a aba do `npm run dev` daquela cópia, olha, volta ao app e descreve no terminal o que está errado ("o botão ficou desalinhado no canto direito"). Orca, Agentastic, cmux e Ignite têm um navegador dentro do app e deixam marcar o problema num print. A skill `feature-exploration` aponta o navegador externo como uma saída do app.

## Decisão

1. **Uma prévia no lugar do terminal**, aberta pelo clique numa porta da sessão (`:3000`, lida das portas que os processos dela abriram) ou pela paleta.
2. **A página roda numa `WebContentsView` do processo principal**, não num `<webview>` nem num iframe da interface:
   - sem Node, sem preload, com `sandbox`;
   - numa sessão do Electron à parte da do app (`partition`): cookies e armazenamento da página não se misturam com os do app;
   - a interface só diz onde a vista fica e pede para escondê-la quando um diálogo do app passa por cima, porque a vista é desenhada pelo sistema acima do DOM.
3. **Só páginas desta máquina:** `localhost`, `127.0.0.1`, `[::1]` e `0.0.0.0`, em `http` ou `https`. Um link para fora abre no navegador da pessoa, e uma janela nova da página vira navegação na mesma prévia (se local) ou o navegador (se não).
4. **Marcar e mandar ao agente:** um print da página (`capturePage`) abre num diálogo em que a pessoa desenha retângulos e escreve uma nota. A imagem com as marcas é gravada em `shots/<sessão>/` nos dados do app, e o prompt leva o caminho do arquivo ao agente; o Claude Code e o Codex leem imagens por caminho.
5. **A prévia é uma por janela, e fecha com o painel.** Nada fica carregado com ela fechada.

## Alternativas consideradas

- **`<webview>` na interface.** Exige ligar `webviewTag` na janela do app, e a página fica no mesmo processo de interface da janela, mais perto do `window.api`.
- **Um iframe.** Herdaria a política de conteúdo do app e a mesma origem dos arquivos dele; servidores de desenvolvimento costumam negar iframe (`X-Frame-Options`).
- **Abrir qualquer endereço.** Viraria um navegador dentro do app, com tudo o que isso pede (barra de segurança, certificados, downloads). O caso é o servidor local da sessão.
- **Mandar a imagem colada no terminal do agente.** Cada agente aceita imagem de um jeito; o caminho de um arquivo funciona nos dois.

## Consequências

- Um processo de renderização a mais enquanto a prévia está aberta (o da página), e nenhum com ela fechada. A memória dele é a da página que a pessoa abriu.
- Os prints ficam nos dados do app, um arquivo por envio, e não são apagados sozinhos.
- Um servidor local que precisa de login usa uma sessão de cookies própria da prévia: o login feito no navegador da pessoa não vale ali.
