# Plano: Prospecção por mercado no Deskcomm (fork da Genuine)

> Plano vivo do fork da Genuine. Toda sessão do Claude Code lê este arquivo antes de trabalhar na prospecção.

---

## Quem sou e o que quero

Sou o dono da Genuine Digital, uma agência de geração de demanda B2B para indústrias e distribuidoras. **O foco desta prospecção são indústrias alimentícias (fabricantes)**, não distribuidoras, mercados ou food service.

Uso o DeskcommCRM em produção numa VPS da HostGator. Este repositório é o **fork da Genuine**, onde vamos reconstruir o módulo de prospecção. Existe **uma versão só**: a da VPS. Quando uma fase estiver pronta e aprovada, ela vai para essa mesma instalação.

Fale comigo em português do Brasil, em linguagem simples. Não sou programador: explique decisões pelo efeito no negócio, não pelo jargão.

## Como trabalhamos (sem ambiente de teste separado)

- **Você trabalha só no GitHub**, nesta sessão na nuvem. Não tem acesso à VPS, e não peça senha, chave SSH ou `.env` de produção.
- **A prova vem antes da VPS.** Como não há uma segunda instalação para testar, cada fase só está pronta quando passa nos testes automáticos (os seus, aqui na sessão, e o CI do GitHub). Escreva testes que cubram cada caso de negócio deste plano, não só o caminho feliz.
- **O módulo novo não pode quebrar o que funciona.** Até eu aprovar a troca, a prospecção atual (Apify) continua funcionando como hoje. O módulo novo entra em tela e rotas próprias, e só substitui o antigo quando eu decidir.
- **Toda migration tem que ser segura para rodar num banco com dados reais**: só acrescenta, nunca apaga nem renomeia coluna existente, e é idempotente.
- **Ida para a VPS:** você prepara e me entrega um roteiro curto, com os comandos exatos para eu colar no terminal da VPS, sempre nesta ordem: backup (`bash hostgator-setup-kit/backup.sh`), atualização, conferência de que o domínio responde, e como voltar atrás se algo der errado.
- **WhatsApp:** nada de disparo real em teste. A abordagem só liga quando eu aprovar a Fase 6.

Se uma tarefa parecer exigir acesso à VPS, ao banco de produção ou ao WhatsApp, **pare e me pergunte**.

## Regras do repositório

1. Leia e siga o `CLAUDE.md` e o `AGENTS.md` deste repositório. São as regras do projeto (multi-tenancy com `organization_id`, RLS, idempotência, LGPD, migrations versionadas, testes). Elas valem aqui também.
2. Git neste fork:
   - o ramo **`producao`** é o que vai para a VPS: a última release do projeto original mais o trabalho aprovado da Genuine. Regras completas em `docs/genuine/FORK.md`;
   - a `main` do fork só espelha o projeto original e **nunca** vai para a VPS;
   - o trabalho em andamento fica em branches `genuine/<assunto>`, criadas a partir de `producao`, e só entra em `producao` por pull request, depois do CI verde e do meu "ok";
   - novidades do projeto original entram só por **release** (tag `vX.Y.Z`), nunca pela ponta da `main` dele, sempre com `merge`, nunca `reset --hard` nem `push --force`.
3. **Mantenha o fork fácil de atualizar.** O projeto original lança versão quase todo dia. Concentre o código novo em pasta própria (sugestão: `lib/prospecting/mercado/`, rotas e telas próprias) e mexa o mínimo possível em arquivos existentes. Quando precisar alterar um arquivo do núcleo, me avise e registre o motivo.
4. Antes de criar tabelas, leia `docs/adr/0002-tabelas-de-modulo-num-banco-so.md`, `docs/doctrine/extensoes.md` e a doutrina de migrations do `CLAUDE.md`. Proponha como numerar as migrations do fork sem colidir com as do projeto original.
5. Toda mudança vem com testes. Rode `pnpm typecheck`, `pnpm lint` e `pnpm test:unit` antes de dizer que algo está pronto.
6. Use o modo de planejamento antes de cada fase: me mostre o plano, espere meu "ok" e só então escreva código.
7. Commits pequenos, com mensagem em português explicando o porquê.

## O problema de hoje

O módulo atual (`lib/prospecting/`) busca empresas no Google Maps pelo Apify e manda direto para a fila de abordagem por WhatsApp. Resultado: erros e nenhum critério de aceite confiável. Já identifiquei estes defeitos no código (confirme cada um com teste antes de corrigir):

1. **Telefone mal validado** (`normalizeProspect`, em `lib/prospecting/schema.ts`). A regra só conta dígitos:
   - `0800 123 4567` vira `+5508001234567` e é aceito;
   - `(041) 3333-4444` vira `+5504133334444`, porque o zero de discagem não é removido;
   - `(00) 99999-9999` é aceito com DDD inexistente;
   - telefone fixo é aceito como se tivesse WhatsApp.
2. **Busca que estoura o tempo perde o que já foi pago** (`synchronizeSearch`, em `store.ts`). Em `TIMED-OUT`, a campanha vira "falhou" e os resultados já gravados no dataset do Apify são descartados.
3. **Segmento não é conferido.** Uma busca por "indústria de alimentos" no Maps traz padarias, mercados e restaurantes, e a categoria nunca é comparada com o pedido.
4. **Cidade não é conferida.** O Maps traz cidades vizinhas.
5. **Duplicidade só é checada na hora de enfileirar**, e o lead já contou como "encontrado".
6. **O contador "Encontrados" engana.** Mostra o que entrou na tabela, não o que é abordável.

## O fluxo que quero

```
Mercado inteiro
  ↓ Encontrar empresas
  ↓ Analisar empresa
  ↓ Descobrir sinais
  ↓ Score
  ↓ Escolher somente as melhores
  ↓ Encontrar decisor
  ↓ Prospectar
  ↓ CRM
```

A lógica é um funil de custo: as etapas baratas rodam no mercado inteiro, e as caras (IA, Apify, enriquecimento pago) só nas empresas que passaram pelo filtro.

| Etapa | O que faz | Fonte |
|---|---|---|
| 1. Mercado inteiro | Universo: todos os CNPJs ativos de um CNAE numa região | Base aberta de CNPJ da Receita Federal, importada no Postgres só para os CNAEs e UFs que eu escolher |
| 2. Encontrar empresas | Filtro por CNAE, UF, município, porte e idade | Base importada |
| 3. Analisar empresa | Perfil com site, Google Maps, Instagram e dados cadastrais | BrasilAPI (já existe em `lib/brasil-api`), leitura do site por IA, Apify Maps como complemento |
| 4. Descobrir sinais | Indícios de oportunidade, cada um com tipo, evidência e link | IA lendo site, Maps, redes sociais e vagas |
| 5. Score | Nota de 0 a 100 com o motivo de cada ponto | Regras do meu ICP mais os sinais |
| 6. Escolher as melhores | Corte por nota mínima ou top N, com minha aprovação na tela | Tela de revisão |
| 7. Encontrar decisor | Nome, cargo e contato de quem decide | Site, LinkedIn e, se eu aprovar, o quadro de sócios do CNPJ |
| 8. Prospectar | Abordagem pelo agente de IA no WhatsApp | Worker atual de prospecção, com a camada de aceite |
| 9. CRM | Empresa, pessoa e negócio no funil | `lib/crm-b2b` e pipelines atuais |

### Ideias de desenho que quero reaproveitar

Analisei dois projetos open source. Não vamos usar o código deles, mas sim estas ideias, reescritas em TypeScript dentro do Deskcomm:

- **Cascata de fontes** (do OpenProspector): para cada dado, tentar a fonte mais barata primeiro e só passar para a próxima se falhar. A ordem é configurável.
- **Cache**: nunca pagar duas vezes pelo mesmo dado. Validade sugerida de 90 dias para contato e 180 para dados da empresa.
- **Livro-razão de custo**: cada chamada paga registra fonte, resultado, custo e tempo. A tela mostra quanto custou cada empresa aprovada.
- **"Primeiro resultado verificado vence"**: dado não verificado fica de reserva, mas não encerra a busca nem vai para o cache.
- **Sinal com prova**: cada sinal tem tipo, evidência e link, nunca texto solto da IA.
- **Score por dimensões** (do OpenGTM): cada dimensão tem peso e uma justificativa registrada.
- **Verificar antes de aceitar**: conferir se o domínio e o perfil do LinkedIn existem antes de gravar.

### Camada de aceite antes da fila de abordagem

Cada empresa passa por esta régua, e o motivo da recusa fica gravado e visível:

| # | Critério | Se reprovar |
|---|---|---|
| 1 | Telefone válido: remover zero de discagem, validar DDD contra a lista oficial, recusar 0800, 0300, 4003 e similares | Recusado |
| 2 | Celular, ou fixo com WhatsApp confirmado pela sessão WAHA | Recusado ou "sem WhatsApp" |
| 3 | Aderência ao segmento: CNAE de fabricação de alimentos aceito e não excluído (ver "Foco: indústrias alimentícias") | Recusado ou "revisar" |
| 4 | Localização dentro do recorte pedido | Recusado |
| 5 | Duplicidade com o CRM e outras campanhas, checada na entrada | "Já no CRM" |
| 6 | Empresa ativa na Receita | Recusado ou "revisar" |

A tela mostra separadamente: **Encontradas, Aprovadas, Para revisar e Recusadas (por motivo)**.

### Foco: indústrias alimentícias

O público-alvo é quem **fabrica** alimentos. Isso muda o ponto de partida, o filtro e os sinais.

**Recorte por CNAE.** O núcleo é a divisão 10 (Fabricação de produtos alimentícios). A divisão 11 (bebidas) é opcional e eu decido se entra. Confirme cada código na tabela oficial do IBGE (CONCLA) antes de usar. Grupos de referência:

| Grupo | Exemplos |
|---|---|
| 10.1 | Abate e produtos de carne |
| 10.3 | Conservas de frutas e legumes |
| 10.5 | Laticínios |
| 10.6 | Moagem, amidos, rações |
| 10.8 | Café |
| 10.9 | Panificação industrial, biscoitos, chocolates, massas, temperos e molhos, pratos prontos, outros alimentos (inclui salgadinhos e snacks) |

**Armadilhas do CNAE que a camada de aceite precisa tratar:**

- `1091-1/02` (padaria e confeitaria com produção própria) é, na prática, padaria de bairro. Não é indústria: excluir por padrão ou mandar para "revisar".
- Muitos CNPJs da divisão 10 são MEIs ou microempresas caseiras. Filtrar por porte (excluir MEI) e usar capital social e tempo de abertura como sinais.
- Considerar também o CNAE secundário: há indústrias registradas com CNAE principal de comércio atacadista.
- Empresas com CNAE principal de varejo, restaurante ou lanchonete ficam fora, mesmo que fabriquem algo.

**Sinais candidatos para indústria alimentícia** (eu calibro os pesos):

- **Registro de inspeção sanitária**: SIF (federal) indica que vende para outros estados, ou seja, escala. SIE e SIM indicam atuação estadual e municipal. Verifique se a consulta pública do MAPA ao SIF pode ser usada como fonte;
- página "seja um distribuidor" ou "seja um representante" no site, que indica expansão comercial;
- produtos à venda em redes de supermercado ou marketplaces;
- vagas abertas para vendedor, representante ou trade marketing;
- participação em feiras do setor;
- site fraco ou inexistente, Instagram parado;
- se já anuncia em Meta ou Google;
- abertura de filial ou nova unidade fabril.

### Decisões que ainda são minhas (pergunte, não decida)

- **Recorte de mercado inicial**: quais grupos da divisão 10 entram primeiro, se bebidas (divisão 11) entram, e quais UFs.
- **Porte mínimo**: a partir de qual porte ou capital social uma indústria vale a abordagem.
- **Quadro de sócios**: o Deskcomm apaga esse dado de propósito (`semSocios`, em `lib/crm-b2b/enrich.ts`) por LGPD. Usá-lo para achar o decisor exige registrar base legal de legítimo interesse B2B. Não mude essa regra sem minha aprovação.
- **Pesos do score e nota de corte.**
- **Fontes pagas** e o teto de gasto por busca.

## Fases e critérios de pronto

### Fase 0: o fork passa a ser a fonte da VPS (só preparação, nenhum código de produto)

Hoje a VPS puxa as imagens prontas do projeto original (`ghcr.io/melgarafael/...`). Para o nosso código chegar lá, o fork precisa publicar as próprias imagens e a VPS precisa puxar as do fork.

1. Salve este plano em `docs/genuine/PLANO-PROSPECCAO.md`, numa branch `genuine/fase-0`.
2. Leia o comentário de `IMG_NS` em `hostgator-setup-kit/_common.sh`: ele lista o que um fork precisa trocar junto (`_common.sh`, `docker-compose.prod.yml`, `.env.hostgator.example` e a matriz de `.github/workflows/publish-image.yml`). Faça essa troca para o namespace da conta do fork no GHCR.
3. Confira se o workflow `publish-image.yml` roda no fork e publica as quatro imagens (app, worker, scheduler, voice-agent). Me diga se preciso ativar algo no GitHub (Actions, permissão de pacotes, visibilidade das imagens) e como.
4. Avalie o botão "Atualizar agora" e o `update.sh`: depois da troca, eles precisam puxar do fork e não do projeto original. Se algum caminho ainda puxar do original e sobrescrever nosso código, me explique e corrija.
5. Prepare o roteiro para eu colar na VPS (a instalação fica em `/root/DeskcommCRM`): backup, apontar o repositório git local e o `.env` para o fork, atualizar, conferir que o domínio responde e como voltar para as imagens originais se algo falhar.

**Pronto quando:** a VPS roda a partir das imagens do fork, sem nenhuma mudança de produto ainda, e o CRM continua funcionando como antes.

### Fase 1: camada de aceite (corrige o que já existe)

Corrigir os 6 defeitos listados, com teste para cada caso, e mostrar na tela os contadores por motivo.

**Pronto quando:** os testes cobrem cada caso de telefone e cada motivo de recusa, o CI está verde e, depois de publicado, uma busca real pelo Apify mostra Encontradas, Aprovadas, Para revisar e Recusadas por motivo, sem nenhum telefone inválido na fila.

Separe a correção de telefone num commit isolado: quero considerar enviá-la como contribuição ao projeto original.

### Pedidos de 02/10/2026, entre a Fase 1 e a Fase 2

Decididos pelo dono: recorte inicial **PR e SC, só alimentos** (divisão 10 do CNAE, sem 1091-1/02, sem bebidas); vizinhas do mesmo estado e distribuidoras entram. Porte mínimo ainda em aberto.

1. **Busca repetida traz empresas novas.** Refazer o mesmo termo e local não pode devolver as mesmas empresas. Como o provedor não aceita lista de exclusão, a busca nova pede mais fundo no Maps (limite + empresas já conhecidas daquela busca, até 300 lugares) e fica com as primeiras novas. O teto de gasto continua limitando o custo, e a campanha diz quando foi ele, ou o fim do Maps, que impediu de achar todas. Código em `lib/prospecting/busca-repetida.ts`.
2. **Classificar empresas** (gostei / não gostei, com motivo), para a prospecção aprender o gosto do dono. A avaliação fica no `data` do candidato (a anonimização da LGPD alcança). "Não gostei" tira da fila quem ainda não foi abordado; "gostei" devolve à fila quem a régua de perfil recusou, enquanto a campanha é rascunho. Categoria com 2 ou mais "não gostei" e nenhum "gostei" passa a ser recusada na entrada das buscas seguintes, com o motivo. Código em `lib/prospecting/aprendizado.ts`. Alimenta o score da Fase 4.
3. **Classificar campanha como referência de perfil ideal** (opção C): as empresas de uma campanha marcada que passaram pela régua de perfil contam como "gostei". Migration 9001.

Ressalva: os candidatos têm prazo de 365 dias (`fn_expurgar_prospeccao_vencida`), e as avaliações vão junto. Guardar o perfil aprendido de forma permanente fica para a Fase 4.

### Fase 2: mercado inteiro e busca por CNAE (etapas 1 e 2)

Importação da base de CNPJ só para o recorte escolhido, rotina de atualização mensal e busca por CNAE, UF, município, porte e idade.

Restrições de infraestrutura que você precisa respeitar:

- a VPS tem 4 GB de RAM, dos quais cerca de 2 GB estão livres, e não pode baixar nem processar a base completa da Receita;
- o banco é um Supabase na nuvem, provavelmente no plano gratuito (limite de 500 MB). Confirme comigo;
- proposta a avaliar: uma automação do GitHub Actions que baixa os arquivos da Receita, filtra só o recorte escolhido e grava o resultado no Supabase. Estime o tamanho final antes de importar.

**Pronto quando:** consigo listar todas as indústrias alimentícias ativas do recorte escolhido, já sem padarias de bairro e MEIs, sem nenhuma chamada paga.

### Fase 3: análise e sinais (etapas 3 e 4)

Cascata de fontes, cache, livro-razão de custo e sinais com prova.

### Fase 4: score e aprovação (etapas 5 e 6)

Score explicável por dimensão e tela de revisão com corte por nota ou top N.

### Fase 5: decisor (etapa 7)

Só depois da minha decisão sobre o quadro de sócios.

### Fase 6: ligação com a abordagem e o CRM (etapas 8 e 9)

As empresas aprovadas entram no worker de prospecção atual e viram empresa, pessoa e negócio no funil.

## Como trabalhar comigo

- Uma fase por vez. Ao fim de cada fase: o que mudou, como eu testo, o que ficou pendente.
- Se encontrar algo no código que contradiga este plano, confie no código, me mostre a diferença e pergunte.
- Antes de qualquer ação difícil de desfazer (apagar dados, mexer em schema já aplicado, gastar crédito pago acima de US$ 1), pergunte.

**Comece pela Fase 0.**
