# AGENTES.md: como se inteirar do fork da Genuine

> Para a IA que vai trabalhar neste repositório (Claude, Codex, Cursor ou outra). Leia inteiro antes de responder ou escrever código.
>
> Escrito em 20/10/2026, com a `v1.84.0-genuine.6` publicada. O estado muda depressa: os comandos da seção 3 dizem como ele está agora e valem mais que as tabelas desta página.

## 1. O que é isto, em poucas linhas

- **Dono:** Genuine Digital, agência de geração de demanda B2B. Ele não é programador e decide tudo que é de negócio.
- **Repositório:** `github.com/admGenuine/DeskcommCRM`, fork **público** do DeskcommCRM (`github.com/melgarafael/DeskcommCRM`, "o original").
- **O que estamos construindo:** o módulo de **prospecção**, para achar **indústrias alimentícias (fabricantes) do PR e de SC**, analisar, dar nota, achar o decisor e abordar pelo WhatsApp com um agente de IA.
- **Onde roda:** uma VPS da HostGator, em produção, em `/root/DeskcommCRM`. Ela se atualiza pelas **releases** do ramo `producao` deste fork. Não existe ambiente de teste separado: a prova vem dos testes e do CI, antes da VPS.

## 2. Ordem de leitura

1. Este arquivo.
2. [`PLANO-PROSPECCAO.md`](PLANO-PROSPECCAO.md): o plano vivo, fase por fase, com as decisões já tomadas pelo dono e as que ainda são dele.
3. [`FORK.md`](FORK.md): os três ramos, a numeração das versões, as migrations 9001+, a rotina do Mercado e **cada arquivo do núcleo que o fork alterou**.
4. `CLAUDE.md` e `AGENTS.md` da raiz: a doutrina do original (multi-tenancy, RLS, migrations, testes, LGPD). Valem aqui inteiras.
5. O código: `lib/prospecting/` (regras), `app/app/prospecting/` (tela), `app/api/v1/prospecting/route.ts` (rotas) e `lib/prospecting/worker.ts` (a rodada do worker).

Se o código contradisser um documento, o código vence: mostre a diferença ao dono e pergunte.

## 3. Onde estamos

### Para conferir agora

```bash
git remote -v | grep -q upstream || git remote add upstream https://github.com/melgarafael/DeskcommCRM.git
git fetch origin --tags

git log --oneline -10 origin/producao                                     # o que já está em produção
gh api repos/admGenuine/DeskcommCRM/releases/latest --jq .tag_name       # a versão que a VPS vai puxar
gh api "repos/admGenuine/DeskcommCRM/pulls?state=open" \
  --jq '.[] | [.number, .head.ref, .title] | @tsv'                         # PRs em aberto
gh api "repos/admGenuine/DeskcommCRM/actions/workflows/genuine-mercado.yml/runs?per_page=5" \
  --jq '.workflow_runs[] | [.event, .head_branch, .conclusion, .created_at] | @tsv'   # cargas da Receita
git ls-remote --tags upstream 'v1.*' | grep -v '\^{}' \
  | sed 's#.*refs/tags/##' | sort -V | tail -3                             # últimas releases do original
```

**Qual versão está instalada na VPS, só o dono sabe** (é ele quem roda o `update.sh`). Pergunte.

### O que já foi feito

| Versão              | PRs      | Entrega                                                                                                                                |
| ------------------- | -------- | -------------------------------------------------------------------------------------------------------------------------------------- |
| `v1.69.0-genuine.1` | #1       | Fase 0: a VPS passa a puxar as imagens do fork (`ghcr.io/admgenuine`)                                                                  |
| `.2` a `.4`         | #3 a #6  | Fase 1: camada de aceite (telefone, WhatsApp, segmento, cidade, duplicidade) e contadores por motivo                                   |
| `.5` e `.6`         | #7, #8   | Busca repetida traz empresas novas, gostei/não gostei, campanha de referência (migration 9001), contadores que filtram                 |
| `.7`                | #9       | Fase 2: a base da Receita no banco (migration 9002) e a aba Mercado                                                                    |
| `v1.84.0-genuine.1` | #10      | O fork sobe para a v1.84.0 do original                                                                                                 |
| `.2` e `.3`         | #11, #12 | Fase 3a: análise grátis do site, com sinais que trazem prova                                                                           |
| `.4`                | #13, #14 | A rotina do Mercado não baixa de novo o que já está no banco. Fase 4: nota de 0 a 100 e "ficar só com as melhores"                     |
| `.5`                | #15, #16 | Parte 3 da tela na largura toda. Fase 3b: leitura por IA (9003), porte pela Receita e Maps para as empresas do Mercado sem site (9004) |
| `.6`                | #17      | Fase 5: decisor pelo quadro de sócios da Receita (9005), com chave por organização                                                     |

### Como a prospecção funciona hoje

1. **Mercado.** A rotina `.github/workflows/genuine-mercado.yml` baixa a base de CNPJ da Receita, filtra o recorte (CNAE divisão 10 sem `1091-1/02`, PR e SC, sem MEI) e grava em `prospecting_market_companies`. A aba Mercado filtra e leva empresas para uma campanha.
2. **Busca no Maps** (Apify), por termo e cidade. Repetir a busca vai mais fundo e traz empresas novas.
3. **Camada de aceite** (`lib/prospecting/aceite/`): telefone, WhatsApp pela sessão WAHA, segmento, região e duplicidade. O motivo da recusa fica gravado e aparece na tela.
4. **Análise grátis do site** (`lib/prospecting/sinais/`): sinais com prova (distribuidores, vagas comerciais, SIF/SIE/SIM, varejo, pixel, site fraco), redes sociais e porte pela Receita. Fica em `prospecting_candidates.data.analise` por 180 dias.
5. **Pagas, só quando o dono clica:** "Ler com IA" (teto de US$ 1 por campanha) e "Procurar no Maps" para as empresas do Mercado sem site (teto de US$ 1 por campanha).
6. **Nota de 0 a 100** (`lib/prospecting/score.ts`), calculada na hora, com o motivo de cada ponto, e "ficar só com as melhores".
7. **Decisor** (`lib/prospecting/mercado/socios.ts`): até 3 sócios por raiz de CNPJ, só com a chave da organização ligada. Nada é copiado para o candidato.
8. **Abordagem:** o worker de prospecção do original, com o agente de IA no WhatsApp. **Ainda não usa o decisor nem os sinais**: isso é a Fase 6.

## 4. O que vem a seguir, em ordem

### 4.1 Carregar os sócios no banco (pendente)

A release `.6` criou a tabela `prospecting_market_socios`, mas a rotina da release roda **antes** de a VPS atualizar, e pulou a carga. Até 20/10/2026 não houve execução manual depois disso (confira com o comando de cargas da seção 3).

1. Confirmar com o dono que a VPS já está na `.6` ou mais nova.
2. **Só com o "pode disparar" do dono, dito na hora**, porque grava no banco de produção:
   ```bash
   gh api repos/admGenuine/DeskcommCRM/actions/workflows/genuine-mercado.yml/dispatches \
     -X POST -f ref=producao -f 'inputs[gravar]=true'
   ```
   Leva perto de uma hora. O resumo do job mostra só contagens; nenhum nome vai para o log.
3. O dono liga o cartão **"Decisor pelo quadro de sócios"** na tela da prospecção, com a referência da avaliação de legítimo interesse.

### 4.2 Fase 6: abordagem e CRM (próxima fase de código)

Mostre o plano ao dono e espere o "ok" antes de escrever código.

- **Ponto de partida no código:** `gerarAbordagemDeFormulario`, chamado em `lib/prospecting/worker.ts` com o objeto `dados`, e `lib/agent-engine/agent/abordagem-de-formulario.ts`, que põe os dados num bloco `<dados>` com nonce, na mensagem do usuário, nunca no prompt de sistema.
- **Desenho proposto, ainda não aprovado:** entram em `dados` só campos estruturados e confiáveis (nome e cargo do decisor vindos da Receita, porte, e os rótulos dos sinais tirados do enum, não o trecho copiado do site). O resumo da IA, se entrar, entra como dado não confiável dentro do `<dados>`. Texto raspado de site nunca vira instrução de modelo (regra de `lib/prospecting/context.ts`).
- **Decisões do dono ainda abertas** (perguntadas em 20/10/2026, sem resposta):
  - a primeira mensagem pergunta pelo decisor pelo nome, pede para falar com ele, ou não usa o nome;
  - a mensagem cita um fato concreto da análise (por exemplo, "vi que vocês procuram distribuidores") ou não. Pixel e "site fraco" nunca devem ser citados ao prospect.
- **Etapa 9, CRM:** empresa, pessoa e negócio no funil (`lib/crm-b2b`). Atenção: `semSocios`, em `lib/crm-b2b/enrich.ts`, apaga sócios no enriquecimento do CRM por LGPD, e essa regra continua. Levar o decisor para o contato do CRM é decisão do dono.
- **WhatsApp:** nenhum disparo real em teste. A abordagem nova só liga quando o dono aprovar a Fase 6.

### 4.3 Depois

1. **Registro de oposição do titular** ("não quero ser procurado"), válido para a instalação toda.
2. **Perfil aprendido permanente.** Hoje as avaliações morrem junto com o candidato em 365 dias (`fn_expurgar_prospeccao_vencida`).
3. **Peso do "sem pixel de anúncio".** Hoje vale 0 e só informa; o dono decide se passa a valer ponto (`sem_pixel_de_anuncio` em `lib/prospecting/score.ts`, e o teste trava o 0 de propósito).
4. **Subir o fork para a última release do original.** Em 20/10/2026 o original estava na v1.86.0 e o fork na v1.84.0. Roteiro em `FORK.md` ("Como trazer uma release nova do original"), conferindo primeiro a tabela "Pontos de encontro". Pergunte ao dono antes.
5. **Do dono, sem código:** ambiente A/B depois de um upgrade da VPS, e trocar a senha do banco.

## 5. Acessos necessários

| Recurso                                    | A IA precisa?            | Como                                                                                    | Limite                                                                                                                                                                                                                   |
| ------------------------------------------ | ------------------------ | --------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| GitHub, fork `admGenuine/DeskcommCRM`      | **Sim**                  | `gh` autenticado, ou token com escrita em conteúdo e pull requests e leitura de Actions | Pode criar branch `genuine/*`, enviar commits nela, abrir PR para `producao` e ler o CI. **Não** mescla PR, **não** envia direto para `producao` ou `main`, **não** força push, **não** cria release (quem faz é o dono) |
| Disparo da rotina do Mercado               | Só no passo 4.1          | Mesmo token, com escrita em Actions                                                     | Só com o "pode disparar" do dono, na hora                                                                                                                                                                                |
| Original `melgarafael/DeskcommCRM`         | Só leitura               | remote `upstream`                                                                       | Buscar tags de release. Nunca abrir PR, issue ou comentário lá sem pedido do dono                                                                                                                                        |
| Segredo `MERCADO_DB_URL` (Actions do fork) | **Não** precisa do valor | Já configurado                                                                          | Nunca pedir, imprimir nem copiar. Só a rotina usa                                                                                                                                                                        |
| Banco de produção (Supabase)               | **Não**                  | Só pela rotina                                                                          | Nada de connection string em chat, arquivo ou log                                                                                                                                                                        |
| VPS HostGator                              | **Não**                  | O dono roda os comandos por SSH                                                         | A IA entrega o roteiro pronto para colar                                                                                                                                                                                 |
| WhatsApp (WAHA)                            | **Não**                  |                                                                                         | Nenhum disparo real                                                                                                                                                                                                      |
| Apify e chaves de IA                       | **Não**                  | Configuradas na tela do CRM e no `.env` da VPS                                          | Gasto pago acima de US$ 1 só com aprovação                                                                                                                                                                               |
| Imagens no GHCR                            | **Não**                  | O CI publica (`publish-image.yml`); os quatro pacotes já são públicos                   |                                                                                                                                                                                                                          |
| Ferramentas locais                         | **Sim**                  | Node 22, pnpm, e Docker (ou um Postgres 15+ com pgvector) para `pnpm test:db`           |                                                                                                                                                                                                                          |

## 6. Como entregar uma mudança

1. Comece sempre do ramo de produção:
   ```bash
   git fetch origin && git switch -c genuine/<assunto> origin/producao
   ```
2. Mostre o plano ao dono e espere o "ok".
3. Código com testes. Antes do PR: `pnpm typecheck`, `pnpm lint`, `pnpm test:unit` (sem caminho) e, se mexeu em schema ou RLS, `pnpm test:db`. O CI é a autoridade.
4. Commits pequenos, mensagem em português dizendo o porquê.
5. Abra o PR **pela API**, para `producao` (o `gh pr create` tende a mirar o original, por causa do remote `upstream`):
   ```bash
   git push -u origin genuine/<assunto>
   gh api repos/admGenuine/DeskcommCRM/pulls -X POST \
     -f title="..." -f head="genuine/<assunto>" -f base="producao" -f body="$(cat corpo.md)"
   ```
6. Espere os cinco checks obrigatórios verdes (`verify`, `invariants`, `build-and-size`, `e2e`, `imagens-ok`):
   ```bash
   gh api repos/admGenuine/DeskcommCRM/commits/<sha>/check-runs \
     --jq '.check_runs[] | [.name, .status, .conclusion] | @tsv'
   ```
7. Mande ao dono os dois links prontos:
   - o PR para mesclar: `https://github.com/admGenuine/DeskcommCRM/pull/<n>`;
   - a release para criar, com a próxima versão: `https://github.com/admGenuine/DeskcommCRM/releases/new?tag=v1.84.0-genuine.<N>&target=producao&title=v1.84.0-genuine.<N>`. Lembre: alvo `producao`, **sem** pré-lançamento e **com** "Set as the latest release" marcado (sem a marca, a VPS não enxerga a versão).
8. Depois da release, espere o `publish-image.yml` terminar (perto de 10 minutos). Atualizar antes disso dá "não consegui falar com o registro de imagens" no `update.sh`.
9. Entregue o roteiro da VPS:
   ```bash
   cd /root/DeskcommCRM && bash hostgator-setup-kit/backup.sh && bash hostgator-setup-kit/update.sh
   ```
   - **Conferir:** o domínio responde 200 em `/` e 307 em `/app`.
   - **Voltar atrás:** `bash hostgator-setup-kit/update.sh --to v1.84.0-genuine.<N-1> --force` (o banco fica, porque as migrations do fork só acrescentam).
10. Se a entrega criou tabela que a rotina do Mercado preenche, repita o passo 4.1 depois do `update.sh`.

## 7. O que mais derruba o CI (já aprendido)

- **Migrations do fork:** número 9001 em diante (a próxima livre: `ls supabase/migrations | grep -E '_9[0-9]{3}_'`), linha `-- manifest:` no cabeçalho do `.sql` (não no `MANIFEST.md`), bloco idempotente no **fim** do `supabase/baseline.sql` rotulado `(migration 900N, fork da Genuine)`, `lib/database.types.ts` atualizado à mão, só aditiva. Função nova termina com `revoke execute ... from public, anon`. Registre a migration na tabela do `FORK.md`.
- **Arquivo do núcleo alterado** (fora de `lib/prospecting/`, `app/app/prospecting/`, `scripts/genuine/` e `docs/genuine/`) entra na tabela do `FORK.md`, com o motivo.
- **Chamada de modelo:** sempre por `runModelCall`, com `purpose`. Ponto novo em `lib/ai/pontos/registro.ts` (com tradução `es`) e, se deve usar o modelo barato, em `PONTOS_DE_TIER_ECONOMICO` (`lib/ai/pontos/resolver.ts`). O custo vai para `llm_calls`.
- **Tela (`"use client"`) não importa módulo com `node:*`** (por exemplo, `sinais/leitor.ts`): o `build-and-size` reprova. Constantes que a tela usa ficam num arquivo leve, como `sinais/teto-da-ia.ts`.
- **i18n:** toda chave nova de `t()` precisa da entrada `es` em `lib/i18n/dicionario.ts`.
- **Prettier:** formate só o que você criou ou mudou. Rodar no arquivo inteiro do original reformata linhas alheias e gera conflito na próxima subida.
- Sem `!` (non-null assertion) e sem `console.log`.
- **Rótulos únicos na tela:** um teste antigo procura campo pelo rótulo, e dois campos com o mesmo texto quebram.
- `pnpm test:unit` **sem caminho**: `vitest run tests/unit` dá um verde menor e falso. Os invariantes de banco só rodam no `pnpm test:db`.
- **Ambiente na nuvem com proxy:** baixar log de job ou artefato do GitHub pode ser bloqueado. Use as anotações e a API de jobs.

## 8. Proibições

- Nunca imprimir, commitar nem pedir chave, senha, `.env` ou connection string.
- **Repositório público:** nenhum nome de sócio, IP, telefone ou dado pessoal real em código, teste, log, PR ou documento. Nos testes, use nomes inventados.
- Nunca acessar banco de produção, VPS ou WhatsApp, nem disparar a rotina com `gravar`, sem o "pode" do dono na hora.
- Nunca trazer a ponta da `main` do original: só tags de release, por merge.
- Nunca `reset --hard`, `push --force`, nem apagar branch alheia.
- Pergunte antes de qualquer coisa difícil de desfazer: apagar dados, mexer em schema já aplicado, gastar crédito pago acima de US$ 1.

## 9. Como falar com o dono

- Português do Brasil, simples, explicando pelo efeito no negócio. Ele não é programador.
- Uma fase por vez: plano antes do código e, ao fim, o que mudou, como testar na tela e o que ficou pendente.
- Sempre mande os links prontos (PR e release) e o comando da VPS.
- Quando ele mandar print de erro do `update.sh`, leia a mensagem antes de diagnosticar. "Não consegui falar com o registro de imagens" quase sempre é imagem ainda publicando: espere e rode de novo.
- Em propostas e peças visuais da Genuine, nunca use travessão; os documentos do fork seguem o mesmo estilo.
