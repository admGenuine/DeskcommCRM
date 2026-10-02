# Como o fork da Genuine funciona

Este repositório (`admgenuine/DeskcommCRM`) é o fork do DeskcommCRM que roda na VPS da Genuine Digital. Este arquivo é a regra de operação do fork. Toda sessão que publicar versão, trazer novidade do projeto original ou mexer no kit de instalação lê este arquivo antes.

## Os três ramos

| Ramo | O que é | Vai para a VPS? |
|---|---|---|
| `producao` | Última release do projeto original + trabalho aprovado da Genuine | **Sim**, é a única fonte das versões do fork |
| `main` | Espelho do projeto original (`melgarafael/DeskcommCRM`), com código que ele ainda não lançou | **Nunca** |
| `genuine/<assunto>` | Trabalho em andamento, criado a partir de `producao` | Só depois de entrar em `producao` |

A `main` existe só porque o GitHub exige um ramo padrão e o botão "Sync fork" age sobre ele. Clicar em "Sync fork" é inofensivo: atualiza a `main`, e a `main` não vai para lugar nenhum.

## O que o fork muda em relação ao original

Mudanças de infraestrutura, mínimas, para a VPS seguir o fork:

- **Imagens**: `IMG_NS="ghcr.io/admgenuine"` em `hostgator-setup-kit/_common.sh`, com os pares que o teste `tests/unit/namespace-das-imagens.test.ts` cobra: `docker-compose.prod.yml`, `.env.hostgator.example`, `tests/unit/_identidade-deste-repo.ts`, `REPO_URL` em `install.sh` e `comecar.sh`, e o rótulo `org.opencontainers.image.source` dos quatro Dockerfiles.
- **Trava de procedência** (`.github/workflows/publish-image.yml`, job `a-tag-veio-da-main`): a tag precisa estar contida em `producao`, não na `main`. Vigiado por `tests/unit/tag-so-nasce-da-main.test.ts`.
- **e2e e perf** rodam também em PR para `producao`.

### Mudanças de produto fora de `lib/prospecting/`

Cada arquivo do núcleo que o fork altera fica listado aqui, com o motivo, porque é onde mora o risco de conflito ao trazer uma release nova do original.

| Arquivo | Mudança | Por quê |
|---|---|---|
| `lib/channels/types.ts` | Método opcional `numeroExiste` no contrato do adapter | A prospecção confere se o número tem WhatsApp sem nomear o provider (doutrina de restrição de canal) |
| `lib/channels/adapters/waha.ts` | Implementa `numeroExiste` | Idem |
| `lib/waha/resolve-contact-whatsapp-id.ts` | Função `numeroExisteNoWhatsapp` | Distingue "não existe" de "não deu para saber" |
| `lib/i18n/dicionario.ts` | Traduções das telas da prospecção | Toda chave nova de `t()` precisa de espanhol |

Ao trazer uma release nova do original, essas linhas podem dar conflito. A resolução é sempre manter o lado do fork (`admgenuine` e `producao`).

## Como a VPS escolhe a versão

O `update.sh` e o agente do botão "Atualizar agora" perguntam à API do GitHub qual é a **release mais recente** do repositório de origem do git da VPS (`ultima_release_estavel`, em `_common.sh`). Depois fazem checkout dessa tag e puxam as imagens `ghcr.io/admgenuine/<imagem>:<versão>`.

"Mais nova" é decidido por **ancestralidade no git**, não pelo nome: a VPS só aceita uma tag cujo commit descende do que está instalado. Por isso toda versão do fork sai de `producao`, que só cresce por merge.

## Numeração das versões do fork

```
v<versão do original>-genuine.<n>
```

- `v1.69.0-genuine.1`: primeira versão do fork sobre a v1.69.0 do original.
- `v1.69.0-genuine.2`: segunda entrega da Genuine sobre a mesma base.
- Ao trazer a v1.70.0 do original: `v1.70.0-genuine.1`.

O sufixo evita colidir com as tags do original. Ressalva conhecida: o `install.sh` de uma instalação **nova** ignora tags com hífen (`ultima_versao_publicada`). Isso não afeta a VPS da Genuine, que já está instalada e se atualiza pelo `update.sh`.

## Como publicar uma versão

1. O PR da entrega entra em `producao`, com o CI verde e a aprovação do dono.
2. Criar a tag no commit de `producao` e enviá-la:
   ```bash
   git tag -a v1.69.0-genuine.N -m "Genuine: <resumo>" <commit de producao>
   git push origin v1.69.0-genuine.N
   ```
3. O `publish-image.yml` publica as quatro imagens com o número `1.69.0-genuine.N`. Conferir que o workflow terminou verde.
4. Criar a **Release** no GitHub para a tag, **sem** marcar como pré-lançamento. Sem a Release, a VPS não enxerga a versão: ela consulta `releases/latest`, não a lista de tags.
5. Na VPS: `cd /root/DeskcommCRM && bash hostgator-setup-kit/update.sh`.

O `release.yml` do original não funciona no fork: depende de um GitHub App e de uma checagem do site do mantenedor. Ele só roda em push na `main` ou disparo manual, e nenhum dos dois faz parte do fluxo do fork.

**Imagens públicas.** Na primeira publicação, cada pacote em github.com/admGenuine?tab=packages nasce privado. Ele precisa ser marcado como público (Package settings, Change visibility), senão a VPS não consegue baixar. Isso é feito uma vez por pacote: `deskcommcrm`, `deskcomm-worker`, `deskcomm-scheduler` e `deskcomm-voice-agent`.

## Como trazer uma release nova do original

```bash
git fetch upstream tag vX.Y.Z
git switch -c genuine/sobe-vX.Y.Z origin/producao
git merge vX.Y.Z            # resolver conflitos mantendo o lado do fork
```

Abrir PR para `producao`, esperar o CI, mesclar e publicar como `vX.Y.Z-genuine.1`. Nunca mesclar a ponta da `main` do original: ela carrega código ainda não lançado.

## Como voltar para o projeto original, se precisar

Na VPS, em `/root/DeskcommCRM`:

```bash
bash hostgator-setup-kit/backup.sh
git remote set-url origin https://github.com/melgarafael/DeskcommCRM.git
git fetch --tags origin
bash hostgator-setup-kit/update.sh --to vX.Y.Z --force
```

`vX.Y.Z` é uma release do original igual ou mais nova que a base da versão do fork em uso. Migrations que a Genuine tiver acrescentado ficam no banco, porque são só aditivas.
