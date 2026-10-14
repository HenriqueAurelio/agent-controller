# M5 — Consumo de recursos

**Objetivo:** ficar abaixo do teto de 450 MB com 10 sessões e deixar visível qual agente está pesando. O número é teto, não alvo: o app tem que ser leve.

**Marco pronto quando:** 10 sessões abertas ficam abaixo de 450 MB no Windows e no Linux, ou a [ADR 0009](../adr/0009-meta-de-consumo-de-recursos.md) é corrigida com o número medido e a justificativa.

---

## [x] 5.1 Desmontar terminais não visíveis

- **Frente:** B · **Tamanho:** P · **Depende de:** 1.5
- **Situação em 2026-10-13:** Pronta. Ficam montados 3 terminais (o visível e os 2 últimos). O e2e mede a remontagem e exige menos de 200 ms.

**O que fazer**

- Manter montado só o terminal da sessão visível e os das últimas sessões usadas.
- Ao voltar a uma sessão desmontada, repovoar a partir do histórico do processo principal.
- Medir o tempo de troca de sessão.

**Pronto quando:** com 10 sessões, só um número fixo de terminais visuais existe na memória; trocar para uma sessão desmontada leva menos de 200 ms.

---

## [x] 5.2 Limite de scrollback e throttle

- **Frente:** C · **Tamanho:** P · **Depende de:** 1.2
- **Situação em 2026-10-13:** Pronta. Padrão de 1000 linhas, configurável. O parser de sinais lê tudo, sem throttle (há teste). O uso de CPU do renderer não foi medido diretamente: o teste confere que o número de envios cai.

**O que fazer**

- Limite de linhas de histórico por sessão, configurável, com um padrão conservador.
- Reduzir a frequência de envio de dados ao renderer para sessões em segundo plano.
- O parser de sinais continua lendo tudo, sem throttle.

**Pronto quando:** uma sessão em segundo plano despejando saída não aumenta o uso de CPU do renderer; os sinais de estado continuam chegando no tempo certo.

---

## [x] 5.3 CPU e RAM por sessão

- **Frente:** C · **Tamanho:** M · **Depende de:** 1.4
- **Situação em 2026-10-13:** Pronta (não foi cortada). Uma leitura da tabela de processos a cada 5 s para todas as sessões, e só enquanto alguma roda; no Windows, por um PowerShell auxiliar que fica aberto. **Não foi comparada com o gerenciador de tarefas**, como pede o critério: há um teste com uma árvore real que confere a ordem de grandeza.

**O que fazer**

- Somar CPU e memória da árvore de processos de cada sessão, em intervalo espaçado.
- Mostrar os valores na barra lateral, com destaque para a sessão mais pesada.
- A coleta em si não pode pesar: sem chamar um processo externo por sessão a cada amostra.

**Pronto quando:** os valores batem com o gerenciador de tarefas do sistema dentro de uma margem razoável, nos dois sistemas.

**Cortável:** segundo item da ordem de corte.

---

## [x] 5.4 Medição contra o teto

- **Frente:** C · **Tamanho:** P · **Depende de:** 5.1, 5.2
- **Situação em 2026-10-13:** Pronta. A primeira medição estourava o teto com o painel de diff aberto (480 MB no Windows). Por decisão sua, a GPU foi para o processo principal, com modo seguro automático; medido de novo: 396 MB com 10 sessões e 426 MB com o painel aberto. Tabela, maiores consumidores e o risco aceito estão na ADR 0009. Falta a medição no Linux real (6.3); a do Docker está registrada com ressalvas.

**O que fazer**

- Estender o script da tarefa 0.6: medir com 1, 5 e 10 sessões, com agentes reais ociosos.
- Medir também com o painel de diff aberto e depois de fechado.
- Rodar nos dois sistemas e registrar na ADR 0009.
- Se passar do teto, identificar o maior consumidor antes de propor mudança.

**Pronto quando:** a tabela de medições está na ADR 0009 e o resultado é comparado ao teto.

**Repetir a cada marco:** esta medição não é só do M5. Rodar ao fim do M1, M2, M3 e M4 para pegar regressão cedo.
