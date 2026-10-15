# Extensões

- **Estado:** proposta. Começa depois de [formatar ao salvar](../formatar-ao-salvar/README.md) e [verificações ao fim do turno](../verificacoes-pos-turno/README.md).
- **ADR:** nova, "Extensões declarativas".

## O problema

Cada projeto tem as suas ferramentas: `ruff` e `pytest` num, `gofmt` e `go test` noutro, `dotnet format` num terceiro, um script interno de deploy num quarto. Colocar cada uma no código do app não escala e faz o app crescer para um lado que só serve a uma pessoa. Também há o que só a pessoa sabe: "neste repositório, depois de cada turno, rode `make check`".

## A ideia

Uma extensão é **uma pasta com um manifesto JSON**. Ela não traz código que o app carrega: declara **o que rodar e quando**, e o app roda com as mesmas proteções que já usa para o formatador (sem shell, com prazo, confiança por repositório).

```jsonc
// ~/.agent-controller/extensions/python-tools/extension.json
{
  "id": "python-tools",
  "name": "Python: ruff e pytest",
  "version": "1.0.0",
  "contributes": {
    "formatters": [
      {
        "id": "ruff",
        "languages": ["python"],
        "detect": { "anyFile": ["ruff.toml", "pyproject.toml"] },
        "command": ["ruff", "format", "--stdin-filename", "{file}", "-"]
      }
    ],
    "checks": [
      { "id": "pytest", "label": "Testes", "command": ["pytest", "-q"], "when": "turnEnd" }
    ],
    "commands": [
      { "id": "lint", "label": "Ruff: corrigir tudo", "command": ["ruff", "check", "--fix", "."] }
    ],
    "prompts": [
      { "id": "explain", "label": "Explicar este arquivo", "text": "Explique o que {file} faz." }
    ]
  }
}
```

### Pontos de extensão

| Ponto | O que é | Vem de |
|---|---|---|
| `formatters` | Formatador por linguagem, lido do stdin | [formatar ao salvar](../formatar-ao-salvar/README.md) |
| `checks` | Verificação que roda ao fim do turno ou sob demanda | [verificações ao fim do turno](../verificacoes-pos-turno/README.md) |
| `commands` | Comando na paleta, rodado na pasta da sessão, com a saída num painel | novo |
| `prompts` | Prompt pronto para mandar ao agente | [biblioteca de prompts](../biblioteca-de-prompts/README.md) |

Cada ponto só entra no manifesto **depois** de existir no app como funcionalidade própria. As funcionalidades de fábrica (Prettier, Biome, ESLint) passam a ser extensões embutidas, escritas no mesmo formato: assim o formato é usado de verdade desde o primeiro dia.

### Onde ficam

- **Do usuário:** `~/.agent-controller/extensions/<id>/`. Valem em todas as pastas.
- **Do repositório:** `.agent-controller/extensions/*.json` dentro do repositório. Vêm junto com o código, e por isso **nunca** rodam sem a pessoa confiar naquele repositório (a mesma confiança do formatador, com a lista do que será executado).

### O que fica de fora de propósito

- **Código JavaScript carregado pelo app** (como as extensões do VS Code). Uma extensão com código no renderer quebraria a regra "a interface não acessa Node"; um host de extensões no main é um processo a mais, memória a mais e uma superfície de ataque grande. Se algum dia for necessário, é outra ADR.
- **Interface própria da extensão** (painéis, botões arbitrários). A extensão contribui para lugares que o app já tem: paleta, rodapé do editor, lista de verificações.
- **Loja ou instalação pela rede.** Instalar é copiar uma pasta. "Instalar de um arquivo .zip" pode vir depois.

## Onde entra na arquitetura

- `src/core/extensions/` (novo): leitura e validação do manifesto (esquema estrito, campos desconhecidos recusados, limites de tamanho), registro das contribuições e recarga quando a pasta muda.
- Os serviços que já existirão (`FormatService`, `CheckService`) passam a pedir as contribuições ao registro em vez de ter a lista fixa.
- `src/shared/extensions.ts`: tipos do manifesto, compartilhados com a interface só para exibição.
- IPC: `extensions:list`, `extensions:reload`, `extensions:runCommand`. O renderer nunca manda um comando para rodar: manda o **id** da contribuição, e o main busca o comando no registro.
- Placeholders (`{file}`, `{folder}`, `{repo}`) substituídos como **argumentos separados**, nunca concatenados numa linha de shell.

## Riscos

| Risco | Como fica |
|---|---|
| Extensão de repositório que executa algo malicioso | Nada roda sem confiança por repositório, com a lista exata de comandos; mudar o manifesto pede confiança de novo (hash do arquivo) |
| Injeção pelo `{file}` (nome de arquivo com aspas ou `;`) | Sem shell; cada placeholder é um argumento inteiro |
| Manifesto inválido derrubar o app | Validação estrita; extensão inválida aparece desabilitada com o erro, as outras continuam |
| O formato engessar cedo demais | `"manifestVersion": 1`, e cada ponto de extensão nasce de uma funcionalidade já usada |
| Comandos que precisam do shell (aliases, `&&`) | Opção explícita `"shell": true`, que roda como o comando do agente roda hoje ([ADR 0013](../../../adr/0013-comando-do-usuario-no-lugar-do-agente.md)), marcada na tela de confiança |
