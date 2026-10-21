# Como o fork da Genuine funciona

Este repositório (`admgenuine/DeskcommCRM`) é o fork do DeskcommCRM que roda na VPS da Genuine Digital. Este arquivo é a regra de operação do fork. Toda sessão que publicar versão, trazer novidade do projeto original ou mexer no kit de instalação lê este arquivo antes. Para se inteirar do projeto inteiro numa leitura só, comece por [`AGENTES.md`](AGENTES.md).

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
| `tests/unit/gatilho-dos-jobs-de-entrega.test.ts` | Entrada do job `genuine-mercado.yml::mercado` no mapa | Todo job de `.github/workflows` declara o gatilho ali |
| `tests/invariants/vocabulario-banco-x-typescript.test.ts` | Par `prospecting_market_companies.porte` x `PORTES_DO_MERCADO` | Coluna nova com CHECK de conjunto ganha um par |
| `lib/ai/pontos/registro.ts` | Ponto de IA `prospecting_site_read` (leitura de site da prospecção, Fase 3b) | Toda chamada de modelo precisa estar no registro, senão a tela de provedores não a mostra e o teste de completude reprova |
| `lib/ai/pontos/resolver.ts` | `prospecting_site_read` em `PONTOS_DE_TIER_ECONOMICO` | Sem escolha do dono, a leitura usa o modelo mais barato do provedor da organização, e não o do agente |
| `lib/database.types.ts` | `prospecting_campaigns.gasto_ia_centavos` e `gasto_maps_usd` | Colunas das migrations 9003 e 9004 |
| `tests/shell/colisao-de-migration.test.sh` | `unset GITHUB_REF` no começo | O teste herdava o número do PR do CI, e os PRs do fork (números pequenos) colidiam com os PRs inventados do teste: o PR #7 reprovava 9 casos. Defeito do original, candidato a contribuição |

Ao trazer uma release nova do original, essas linhas podem dar conflito. A resolução é sempre manter o lado do fork (`admgenuine` e `producao`).

### Pontos de encontro com a prospecção do original

A prospecção é o módulo que o fork mais mexe, e o original também evolui nela. Na subida para a v1.84.0 os dois lados se encontraram nestes pontos; a próxima subida deve conferi-los primeiro:

| Onde | Como ficou |
|---|---|
| `lib/prospecting/provedor.ts` (despachante do original, #1758) | `startSearch` ganhou o terceiro argumento opcional `alcance` (busca repetida vai mais fundo). Sem ele, vale o limite, como no original |
| `lib/prospecting/store.ts`, `createSearch` e `synchronizeSearch` | A lógica do fork (busca repetida, régua de entrada, aviso da busca) roda sobre `provedorDaOrganizacao`, nunca chamando `provider.ts` direto |
| `lib/prospecting/store.ts`, `activateCampaign` | A régua do legado (`motivoDeRecusaDoLegado`) filtra os candidatos ANTES de `enfileirarCandidatos` do original (escolha do operador, triagem, modo `on_send`) |
| `lib/prospecting/store.ts`, `triarCandidato` | Sem telefone usa o motivo gravado na entrada (`phone_issue`) |
| `lib/prospecting/worker.ts` | A checagem "tem WhatsApp?" do fork vem ANTES do `prepararCandidatoNoEnvio` do original: número sem WhatsApp não cria contato nem negócio no modo `on_send` |
| `app/api/v1/prospecting/route.ts` | As ações do fork (`rate`, `reference`, `market_campaign`) usam o `auditMetadata` e o `resolveAuthDual` do original, e ficam fechadas ao token (`ACOES_ABERTAS_AO_TOKEN`) |
| `app/app/prospecting/_client.tsx` | Os contadores-filtro do fork somam com a seleção do original: a lista visível esconde as desmarcadas (original) e aplica o filtro do contador (fork) |
| `lib/prospecting/worker.ts`, fim de `tickProspecting` | A rodada da análise de sites do fork (`sinais/fila.ts`) roda depois do laço das organizações, fora do lock, até 200s desde o começo da rodada |
| `app/app/prospecting/_client.tsx`, seleção | "Ficar só com as melhores" (score do fork, `lib/prospecting/score.ts`) não tem ação própria: usa `select` na preparação e `select_in_queue` na fila pausada, do original, e só sobre as linhas que essas ações alteram |
| `app/app/prospecting/_client.tsx`, parte 3 | O cartão "3. Acompanhar resultados" saiu da coluna da direita e fica abaixo da grade, na largura toda (a tabela tem 8 colunas). Num merge do original que mexa nesse cartão, o conflito aparece aqui |
| `lib/prospecting/worker.ts`, fim de `tickProspecting` (Fase 3b) | Depois da análise grátis, a rodada da leitura por IA (`sinais/fila-ia.ts`), até o mesmo limite de 200s. O retorno da rodada ganhou `lidasComIa`. Depois, a sincronização das buscas no Maps do Mercado (`mercado/maps.ts`), que devolve `achadasNoMaps` |
| `app/api/v1/prospecting/route.ts`, ações `read_sites_ai`, `search_maps_market` e `socios_config` | Fechadas ao token, como as outras ações do fork (`socios_config` exige pessoa na tela); o GET devolve `gasto_ia_centavos` e `gasto_maps_usd` da campanha, o uso do quadro de sócios (`socios`) e, com ele ligado, `decisores` em cada candidato |
| `lib/prospecting/provedor.ts` e `provider.ts` | Método opcional `startLookup` no `ProvedorDeBusca` (só a Apify implementa): procurar empresas conhecidas, um lugar por termo, numa execução só | Provedor sem o método não oferece a busca do Mercado no Maps; os três métodos do original não mudaram |

### Migrations do fork

As migrations do fork começam em **9001** (`<timestamp>_9001_<slug>.sql`), longe da numeração do original, para nunca colidir. Seguem a mesma tripla do projeto: arquivo em `supabase/migrations/`, bloco idempotente no **fim** do `supabase/baseline.sql` (rotulado `(migration 9001, fork da Genuine)`) e o registro. Só aditivas.

**O registro mudou no original (v1.70.0, #2149):** migration nova se descreve numa linha `-- manifest: <o quê e por quê>` no cabeçalho do próprio `.sql`, e **não** ganha linha no `MANIFEST.md` (nos dois lugares ao mesmo tempo, `tests/unit/manifest-x-migrations.test.ts` reprova). A 9001 e a 9002 ficaram no `MANIFEST.md`, como histórico; da 9003 em diante, só o cabeçalho.

| Migration | O que faz |
|---|---|
| `9001_prospeccao_campanha_de_referencia` | `prospecting_campaigns.referencia_em` e `referencia_motivo`: a campanha marcada como referência do perfil ideal |
| `9002_prospeccao_mercado` | `prospecting_market_companies`: a base pública da Receita no recorte da prospecção, escrita pela rotina `genuine-mercado.yml` |
| `9003_prospeccao_gasto_com_ia` | `prospecting_campaigns.gasto_ia_centavos`: quanto a leitura por IA já gastou na campanha, para o teto por campanha. A partir desta, a descrição fica no cabeçalho do `.sql` (`-- manifest:`), não no `MANIFEST.md` |
| `9004_prospeccao_gasto_com_maps` | `prospecting_campaigns.gasto_maps_usd`: gasto e reserva da busca no Maps das empresas do Mercado sem site, para o teto por campanha |
| `9005_prospeccao_socios_do_mercado` | `prospecting_market_socios`: o quadro de sócios pessoa física das empresas do Mercado (só nome, qualificação e entrada), escrito pela rotina `genuine-mercado.yml` e lido só pelo servidor, para a organização que ligou o uso |

Ao trazer uma release nova do original, o `baseline.sql` e o `MANIFEST.md` podem dar conflito no fim do arquivo: manter os dois lados, com os blocos do fork por último.

### A rotina do mercado (`.github/workflows/genuine-mercado.yml`)

Baixa a base pública de CNPJ da Receita, filtra o recorte da prospecção (`scripts/genuine/mercado/filtrar_receita.py`) e, quando pedido, grava em `prospecting_market_companies` (`scripts/genuine/mercado/carregar.sql`, numa transação).

- Gravar exige o segredo **`MERCADO_DB_URL`** (Settings, Secrets and variables, Actions): a connection string do Supabase, a mesma da VPS.
- **Quando roda e grava:** a cada release publicada (a tag `v*`), sozinha, e só baixa quando o mês publicado ainda não está no banco (o passo "A base deste mês já está no banco?" pergunta ao banco antes de baixar vários GB). Sem o segredo, filtra e não grava, sem reprovar nada.
- **Fonte e tempo:** com a Receita atendendo, o download leva perto de uma hora; pelo espelho, poucos minutos.
- O GitHub só agenda (`schedule`) ou mostra o botão "Run workflow" de workflow que está no ramo padrão, e o padrão do fork é a `main`, espelho do original. Por isso a rotina anda junto com as releases. Para rodar fora delas: disparo pela API (`workflow_dispatch` com `gravar`, ref `producao`).
- **Fonte:** a Receita recusa conexão de fora do Brasil, e o runner do GitHub é de fora; a rotina usa então o espelho mensal da Casa dos Dados (os mesmos arquivos). O aviso do job diz qual fonte foi usada.
- O recorte (estados, CNAE) está nas variáveis `UFS`, `CNAE_PREFIXOS` e `CNAE_EXCLUIDOS` do workflow.
- **Sócios (Fase 5):** baixa também `Socios*.zip` e `Qualificacoes.zip` e grava o quadro de sócios pessoa física das empresas do recorte em `prospecting_market_socios` (`scripts/genuine/mercado/carregar_socios.sql`, que troca a tabela inteira). **O repositório é público:** o CSV de sócios fica fora de `saida/` (o artefato) e nenhum nome vai para o log. A release pula o download só quando empresas E sócios do mês já estão no banco (ou quando a tabela de sócios ainda não existe, antes do `update.sh`).

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
4. Criar a **Release** no GitHub para a tag, **sem** marcar como pré-lançamento e **com a caixa "Set as the latest release" marcada**. A VPS consulta `releases/latest`, não a lista de tags: sem a Release, ou com ela publicada sem a marca de mais recente, a VPS responde "já está na versão mais recente". Medido em 02/10/2026: as releases `.2` e `.3` saíram sem a marca, e o `update.sh` seguia vendo a `.1`. Conserto de uma release já publicada: Edit release, marcar a caixa, Update release.
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
