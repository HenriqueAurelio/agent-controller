# 0033 — Aviso no celular pelo ntfy ou por um bot do Telegram da própria pessoa

- **Status:** Aceita
- **Data:** 2026-11-03
- **Funcionalidade:** aviso no celular (`docs/proximas-versoes.md`, v0.6, item 16)

## Contexto

Quem deixa um agente trabalhando e sai da mesa só descobre que ele parou esperando uma resposta quando volta. Os concorrentes resolvem isso com um app de celular e um servidor deles no meio. O Aurelium não tem servidor e não quer ter: nada do que a pessoa faz passa por uma infraestrutura do projeto.

Os avisos que já existem (aguardando você, terminou, pedido de permissão, vigia do PR) têm um título e uma frase curta. Mandar o mesmo texto ao celular resolve o caso sem exigir o painel pela rede (item 17).

## Decisão

- Dois caminhos, ambos com o endereço da própria pessoa:
  - **ntfy**: um `POST` para `servidor/tópico`. O servidor de fábrica é o público, `https://ntfy.sh`; quem quiser usa o seu. O tópico é tudo o que protege os avisos num servidor público, então o app oferece um gerado pela fonte criptográfica (`aurelium-` e 20 letras e números) em vez de deixar a pessoa inventar um.
  - **Telegram**: um bot criado pela pessoa no BotFather escreve no chat dela (`sendMessage`).
- Vai só o título e a frase do aviso. Nunca o texto do terminal, o diff, o prompt ou o caminho de arquivos.
- O token do bot é segredo: fica no cofre do sistema (`safeStorage`, em `phone-token.json`), como o token do Sonar, e não aparece na interface depois de guardado. No Linux sem cofre (`basic_text`), o campo fica desligado. O tópico do ntfy fica nas preferências: ele é um endereço, e a pessoa precisa vê-lo para assinar no celular.
- De fábrica, o aviso vai só quando a janela do app não está em foco: na mesa, a notificação do sistema basta.
- O envio é do main, depois da mesma decisão que já filtra as notificações do sistema. Uma falha vai para o log e não interrompe nada; o botão **Mandar um teste** mostra o erro.
- Desligado de fábrica: nada sai da máquina até a pessoa escolher um provedor.

## Consequências

- Sem servidor do projeto, sem conta nova e sem app próprio no celular: o app do ntfy ou o Telegram já instalados recebem.
- Num servidor público do ntfy, quem descobrir o tópico lê os avisos. O texto deles é pouco (nome da sessão e estado), e o tópico aleatório torna a descoberta improvável; quem quiser mais usa o próprio servidor.
- Responder ao aviso pelo celular (permitir, negar, mandar um prompt) não entra aqui: pede canal de volta e autenticação, que são o item 17 com a sua própria ADR.
