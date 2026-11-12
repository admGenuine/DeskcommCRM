-- manifest: campanha com vários modelos aprovados em rodízio: campaign_message_templates passa a ter uma linha por modelo (posição e peso da proporção) e campaign_recipient_templates registra qual modelo saiu para cada pessoa, para o rodízio e o relatório por modelo (fork da Genuine)
--
-- ═══ Vários modelos em rodízio (9007, fork da Genuine) ═══
--
-- Pedido do dono em 13/11/2026: uma campanha alterna vários modelos aprovados
-- durante o disparo, numa proporção escolhida (dois do A para cada um do B), e
-- o relatório mostra entregues, lidas e falhas por modelo.
--
-- ═══ O que muda ═══
--
-- `campaign_message_templates` (9006) tinha uma linha por campanha. Passa a ter
-- uma por modelo da lista: `posicao` (0 a 4, a ordem da lista) e `peso` (1 a
-- 10, a parte de cada um na proporção). A chave vira (campaign_id, posicao). As
-- linhas que já existem viram a posição 0 com peso 1: a campanha de um modelo
-- só continua igual.
--
-- `campaign_recipient_templates` é nova: uma linha por pessoa que recebeu (ou
-- tentou receber) um modelo, com o nome e o idioma. O rodízio conta por ela o
-- que já saiu de cada modelo; o relatório cruza com os carimbos de
-- `campaign_recipients` (enviado, entregue, lido). Tabela do fork, ao lado, para
-- não mexer em `campaign_recipients`, que é do original. Some com a pessoa da
-- lista e com a campanha (`on delete cascade`).
--
-- Escrita só pelo servidor, como as outras tabelas de campanha (migration
-- 0376): `authenticated` só lê, filtrado pela organização.
--
-- Aditiva e idempotente.

alter table public.campaign_message_templates
  add column if not exists posicao smallint not null default 0;
alter table public.campaign_message_templates
  add column if not exists peso smallint not null default 1;

do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'campaign_message_templates_posicao_check'
  ) then
    alter table public.campaign_message_templates
      add constraint campaign_message_templates_posicao_check check (posicao between 0 and 4);
  end if;
  if not exists (
    select 1 from pg_constraint where conname = 'campaign_message_templates_peso_check'
  ) then
    alter table public.campaign_message_templates
      add constraint campaign_message_templates_peso_check check (peso between 1 and 10);
  end if;
end $$;

-- A chave passa de (campaign_id) para (campaign_id, posicao). Só troca quando a
-- chave ainda é a de uma coluna: reaplicar não refaz nada.
do $$
begin
  if exists (
    select 1 from pg_constraint
     where conrelid = 'public.campaign_message_templates'::regclass
       and contype = 'p'
       and array_length(conkey, 1) = 1
  ) then
    alter table public.campaign_message_templates
      drop constraint campaign_message_templates_pkey;
    alter table public.campaign_message_templates
      add constraint campaign_message_templates_pkey primary key (campaign_id, posicao);
  end if;
end $$;

comment on column public.campaign_message_templates.posicao is
  'A ordem do modelo na lista da campanha (0 a 4). A posição 0 é a do modelo único da etapa anterior.';
comment on column public.campaign_message_templates.peso is
  'A parte deste modelo na proporção do rodízio (1 a 10): peso 2 no A e 1 no B = dois envios do A para cada um do B.';

create table if not exists public.campaign_recipient_templates (
  recipient_id uuid primary key references public.campaign_recipients(id) on delete cascade,
  campaign_id uuid not null references public.campaigns(id) on delete cascade,
  organization_id uuid not null references public.organizations(id) on delete cascade,
  template_name text not null,
  template_language text not null,
  created_at timestamptz not null default now()
);

comment on table public.campaign_recipient_templates is
  'Fork da Genuine: qual modelo aprovado saiu para cada pessoa da campanha. O rodízio de modelos conta por aqui o que já saiu de cada um; o relatório por modelo cruza com os carimbos de campaign_recipients.';

create index if not exists idx_campaign_recipient_templates_modelo
  on public.campaign_recipient_templates (campaign_id, template_name, template_language);

alter table public.campaign_recipient_templates enable row level security;

drop policy if exists campaign_recipient_templates_select on public.campaign_recipient_templates;
create policy campaign_recipient_templates_select on public.campaign_recipient_templates
  for select using (
    (organization_id in (select public.fn_user_org_ids())) or public.fn_is_platform_admin()
  );

revoke all on public.campaign_recipient_templates from public, anon, authenticated;
grant select on public.campaign_recipient_templates to authenticated;
grant all on public.campaign_recipient_templates to service_role;
