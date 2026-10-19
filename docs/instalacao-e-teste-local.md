# Instalar e testar o Aurelium localmente

Este guia é para quem desenvolve o Aurelium e quer usá-lo como aplicativo instalado, em vez de depender somente de `npm run dev`.

## Qual modo usar

| Objetivo | Modo recomendado | Como abrir |
| --- | --- | --- |
| Alterar a interface com recarga rápida | Desenvolvimento | `npm run dev` |
| Conferir ícone, nome do processo, permissões, menu do sistema e comportamento de distribuição | Aplicativo empacotado, sem instalar | `npm run pack` e abrir o executável em `dist` |
| Usar o aplicativo no dia a dia e validar uma versão candidata | Instalador local | `npm run dist` e instalar o artefato em `dist` |

`npm run dev` executa o runtime de desenvolvimento do Electron, portanto o processo-base aparece como `Electron`. Isso é esperado. O pacote produzido pelo Aurelium tem executável próprio: `Aurelium.exe` no Windows e `aurelium` no Linux.

> O aplicativo instalado é uma fotografia do código no momento do empacotamento. Depois de mudar o código, gere e instale outra versão para testar aquela alteração; o aplicativo em uso não se atualiza sozinho.

## Pré-requisitos para gerar uma versão local

Clone o repositório e instale as dependências uma vez:

```sh
git clone https://github.com/HenriqueAurelio/agent-controller.git
cd agent-controller
npm ci
```

Use Node 22.12 ou mais novo. Para o aplicativo abrir agentes, instale e autentique Claude Code e/ou Codex CLI e, para os recursos de revisão, tenha Git 2.15 ou mais novo no `PATH`.

Antes de empacotar uma mudança, execute pelo menos:

```sh
npm run lint
npm run typecheck
npm run build
```

Para uma validação completa antes de compartilhar uma build, consulte [Validar antes de usar](#validar-antes-de-usar).

## Windows

### Teste rápido, sem instalar

Feche instâncias abertas do Aurelium. No PowerShell, a partir da raiz do repositório:

```powershell
npm run pack
.\dist\win-unpacked\Aurelium.exe
```

Esse caminho é ideal para confirmar o nome no Gerenciador de Tarefas, o ícone da janela e o comportamento do aplicativo empacotado. A pasta `win-unpacked` pode ser apagada e gerada novamente; ela não é uma instalação.

### Instalar a build local

```powershell
npm run dist
Start-Process .\dist\Aurelium-0.1.0-setup.exe
```

Substitua `0.1.0` pela versão que aparece no nome do arquivo em `dist/`. O instalador é por usuário e instala por cima de uma cópia anterior do Aurelium. Depois, abra **Aurelium** pelo Menu Iniciar ou pelo atalho criado pelo instalador.

Como o instalador ainda não tem assinatura de código, o Windows pode mostrar **O Windows protegeu o computador**. Para uma build que você mesmo gerou ou revisou, escolha **Mais informações** e **Executar assim mesmo**.

No Gerenciador de Tarefas, a instância instalada aparece como **Aurelium**. Se o Windows mantiver o ícone antigo na barra de tarefas, feche todas as instâncias, desafixe o atalho antigo e abra de novo o item recém-instalado pelo Menu Iniciar.

### Atualizar sua instalação de teste

1. Feche o Aurelium instalado, inclusive terminais auxiliares que ele abriu.
2. Altere o código e rode `npm run dist` novamente.
3. Execute o novo `Aurelium-<versão>-setup.exe`.
4. Abra o aplicativo pelo Menu Iniciar e confira a mudança.

As sessões, preferências e checkpoints existentes são preservados durante a mudança de marca e durante reinstalações normais. Desinstalar o aplicativo não deve ser usado como método de limpeza de dados sem antes conferir as opções exibidas pelo Windows.

## Linux

Gere os pacotes no próprio Linux. Além de Node, a instalação das dependências requer compilador e Python para o `node-pty`:

```bash
sudo apt update
sudo apt install -y build-essential python3 git libgtk-3-0 libnss3 libasound2t64 \
  libgbm1 libxss1 libnotify4
npm ci
```

No WSL2, mantenha o clone dentro do sistema de arquivos Linux (por exemplo, `~/src/agent-controller`), e não em `/mnt/c` ou `/mnt/g`.

### Teste rápido, sem instalar

```bash
npm run pack
./dist/linux-unpacked/aurelium
```

### Instalar a build local

Gere os artefatos:

```bash
npm run dist
```

Em Debian e Ubuntu, instale o pacote `.deb` que apareceu em `dist/`:

```bash
sudo apt install ./dist/Aurelium-0.1.0.deb
```

Em qualquer distribuição compatível, use o AppImage:

```bash
chmod +x ./dist/Aurelium-0.1.0.AppImage
./dist/Aurelium-0.1.0.AppImage
```

Substitua `0.1.0` pela versão gerada. Algumas distribuições exigem FUSE para executar AppImages; em Debian/Ubuntu, instale `libfuse2` quando o sistema indicar essa dependência.

Para atualizar, feche o Aurelium, gere um novo pacote e instale o `.deb` por cima ou substitua o AppImage pelo arquivo novo.

## Ciclo recomendado para aprimorar o próprio aplicativo

1. Faça a alteração em uma branch do repositório.
2. Use `npm run dev` apenas para iterar rapidamente na interface e na lógica.
3. Pare o modo de desenvolvimento e execute `npm run pack` para verificar a versão empacotada.
4. Quando o fluxo estiver bom, execute `npm run dist`, instale o resultado e use-o normalmente em projetos de teste ou em uma cópia segura do repositório.
5. Registre qualquer diferença entre desenvolvimento e pacote como defeito, com passos para reproduzir.

Evite pedir ao agente que edite arquivos do código-fonte do Aurelium enquanto você está testando uma versão instalada esperando que ela mude na hora: a instalação continua executando a build anterior até que você empacote e instale novamente.

## Validar antes de usar

Para uma mudança de interface ou de empacotamento, rode:

```sh
npm run lint
npm run typecheck
npm run format:check
npm test
npm run build && npm run test:e2e
```

Quando o core mudar, teste também no Linux:

```sh
npm run test:core:docker
```

`npm run test:smoke` e `npm run test:smoke:app` abrem agentes reais, usam sua conta e podem consumir créditos. Execute-os somente quando quiser validar explicitamente essa integração.

## Diagnóstico rápido

| Situação | O que fazer |
| --- | --- |
| O processo ainda se chama Electron | Confirme que você abriu `Aurelium.exe`/`aurelium` de `dist`, e não `npm run dev`. |
| O aplicativo instalado não mostra uma alteração recente | Feche-o, rode `npm run dist` de novo e execute o instalador/artefato gerado. |
| Claude Code ou Codex aparece desabilitado | Confirme `claude --version` ou `codex --version` no mesmo terminal/shell usado para abrir o Aurelium. |
| Ícone antigo na barra de tarefas | Feche todas as instâncias, desafixe o atalho anterior e abra a cópia recém-instalada pelo Menu Iniciar. |
| AppImage não abre | Execute `chmod +x` e instale a dependência FUSE indicada pela distribuição. |

Veja também o [guia de funcionalidades](guia-de-funcionalidades.md) e o [README](../README.md).
