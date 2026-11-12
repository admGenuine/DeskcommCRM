-- manifest: campaign_message_templates: a campanha que envia um modelo aprovado (nome, idioma, de onde sai cada variável e quantos envios por rodada), para conexões que só entregam modelo fora da janela de 24 horas (fork da Genuine)
--
-- ═══ Campanha com modelo aprovado (9006, fork da Genuine) ═══
--
-- Migration do fork `admgenuine/DeskcommCRM` (numeração a partir de 9001, ver
-- docs/genuine/FORK.md). Pedido do dono em 12/11/2026: na API oficial do
-- WhatsApp a campanha só entrega fora da janela de 24 horas se mandar um modelo
-- aprovado, e até aqui ela só sabia mandar texto livre.
--
-- ═══ Por que uma tabela ao lado, e não colunas em `campaigns` ═══
--
-- `campaigns` é do projeto original. Uma tabela do fork, uma linha por campanha,
-- não conflita com nenhuma migration futura do original e some inteira com a
-- campanha (`on delete cascade`). Campanha SEM linha aqui é campanha de texto,
-- exatamente como era.
--
-- ═══ O que mora aqui, e o que não mora ═══
--
-- Mora a escolha do operador: o modelo (nome + idioma, a chave do espelho
-- `meta_templates`), o mapa de variáveis (chave do slot → texto com as mesmas
-- variáveis da campanha, como `{{primeiro_nome}}` ou `{{lead.cidade}}`, ou um
-- valor fixo) e quantos envios a rodada faz por vez. Esta linha é a fonte da
-- verdade. `campaigns.message_body` recebe uma CÓPIA DERIVADA do mapa
-- (`lib/campanhas/modelo-da-campanha.ts`, `serializarModelo`), escrita na mesma
-- requisição, para a preparação, a prévia e o teste do original congelarem e
-- conferirem as variáveis de cada pessoa sem mudar uma linha.
--
-- Não mora o texto do modelo nem o status: esses são da plataforma e vivem no
-- espelho, que o webhook de status atualiza.
--
-- Escrita só pelo servidor (service role), como as outras tabelas de campanha
-- (migration 0376): `authenticated` só lê, filtrado pela organização.
--
-- Aditiva e idempotente.

create table if not exists public.campaign_message_templates (
  campaign_id uuid primary key references public.campaigns(id) on delete cascade,
  organization_id uuid not null references public.organizations(id) on delete cascade,
  template_name text not null,
  template_language text not null,
  variable_map jsonb not null default '{}'::jsonb,
  envios_por_rodada integer,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint campaign_message_templates_nome_check
    check (char_length(btrim(template_name)) between 1 and 512),
  constraint campaign_message_templates_idioma_check
    check (char_length(btrim(template_language)) between 2 and 16),
  constraint campaign_message_templates_mapa_check
    check (jsonb_typeof(variable_map) = 'object'),
  constraint campaign_message_templates_envios_check
    check (envios_por_rodada is null or envios_por_rodada between 1 and 60)
);

comment on table public.campaign_message_templates is
  'Fork da Genuine: a campanha que envia um modelo aprovado. Sem linha aqui, a campanha é de texto. A linha é a fonte da verdade; campaigns.message_body guarda uma cópia derivada do mapa de variáveis, para a preparação conferir os dados de cada pessoa.';
comment on column public.campaign_message_templates.variable_map is
  'Chave do slot do modelo (a mesma de template_values: "1", "header:1", "button0:1") → texto com as variáveis da campanha ou valor fixo.';
comment on column public.campaign_message_templates.envios_por_rodada is
  'Quantos envios a rodada de um minuto faz por vez nesta campanha (1 a 60). NULL = o padrão do código. Os tetos diário e por hora continuam valendo.';

create index if not exists idx_campaign_message_templates_org
  on public.campaign_message_templates (organization_id);

alter table public.campaign_message_templates enable row level security;

drop policy if exists campaign_message_templates_select on public.campaign_message_templates;
create policy campaign_message_templates_select on public.campaign_message_templates
  for select using (
    (organization_id in (select public.fn_user_org_ids())) or public.fn_is_platform_admin()
  );

revoke all on public.campaign_message_templates from public, anon, authenticated;
grant select on public.campaign_message_templates to authenticated;
grant all on public.campaign_message_templates to service_role;
