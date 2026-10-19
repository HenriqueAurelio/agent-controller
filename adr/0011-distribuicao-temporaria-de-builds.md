# ADR 0011 — Distribuição temporária de builds fora do GitHub autenticado

**Status:** Aceita

## Contexto

O Agent Controller precisa ser instalado em outro computador no qual não será usado
um login GitHub com acesso ao repositório privado. Portanto, os artefatos de Windows
e Linux não podem depender de uma GitHub Release privada: seus assets só podem ser
baixados por quem tem acesso ao repositório.

Foi avaliado o uso de GitHub Pages como página privada de download. Uma página Pages
com controle de acesso exige GitHub Enterprise Cloud e também exige que o visitante
tenha acesso de leitura ao repositório. Isso não atende ao cenário.

## Decisão

Para cada lançamento manual destinado a esse computador:

1. Gerar os instaladores para Windows e Linux a partir de uma versão identificada
   por tag.
2. Publicar temporariamente uma página GitHub Pages pública contendo somente os
   arquivos de distribuição e uma página mínima de download.
3. Baixar os arquivos no computador de destino.
4. Despublicar a página e remover os arquivos publicados assim que a transferência
   for confirmada.

O repositório de código permanece privado. A página temporária não deve incluir
código-fonte, tokens, arquivos de configuração, logs nem outros dados além dos
instaladores e das informações mínimas de versão.

## Consequências

- Durante a publicação, qualquer pessoa que descubra a URL pode baixar os arquivos.
  O fato de o link não ser divulgado não constitui controle de acesso.
- A despublicação interrompe novos acessos à página, mas não revoga cópias já
  baixadas e pode não eliminar imediatamente efeitos de cache ou indexação.
- Uma GitHub Release privada pode ser criada para histórico interno, mas não é o
  canal de download para o computador sem autenticação.
- A publicação deve ser acionada conscientemente e removida logo após o download;
  não deve ficar como hospedagem permanente.

## Fluxo de lançamento pendente

Antes de executar o lançamento, definir a versão e a tag. Em seguida:

1. Executar os builds de Windows e Linux e validar os artefatos.
2. Registrar os comandos, sistema operacional e resultados como evidência no PR que
   introduzir ou alterar a automação de lançamento.
3. Publicar os artefatos na página temporária.
4. Testar os dois links em uma sessão sem autenticação no GitHub.
5. Após o download no computador de destino, despublicar a página.

## Alternativas consideradas

### GitHub Pages privado

Descartado. Exige GitHub Enterprise Cloud e acesso autenticado ao repositório.

### GitHub Release privada

Descartada como canal de distribuição para este caso. Os downloads exigem acesso ao
repositório privado.

### Hospedagem externa com link temporário

Permanece como alternativa futura preferível caso o processo seja recorrente.
Serviços com URLs assinadas, como armazenamento de objetos, permitem expiração e
evitam tornar uma página Pages pública.
