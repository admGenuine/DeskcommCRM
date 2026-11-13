-- manifest: campanha que pula modelo indisponível: campaign_recipient_templates conta quantas vezes cada pessoa voltou à fila porque a Meta recusou o modelo (pausado, desativado ou não aprovado) e campaign_template_skips conta quantas vezes cada modelo foi pulado e por quê, para a tela da campanha (fork da Genuine)
--
-- ═══ Modelo indisponível no meio do disparo (9008, fork da Genuine) ═══
--
-- Pedido do dono em 13/11/2026: quando a Meta recusa um envio porque o modelo
-- está pausado (132015), desativado (132016) ou não aprovado (132001), a pessoa
-- volta à fila e a próxima tentativa sai com outro modelo da lista, sem contar
-- como falha definitiva.
--
-- `campaign_recipient_templates.tentativas_indisponivel` conta essas voltas:
-- passa de 3, a pessoa fica como falha, com o motivo. É o teto que impede uma
-- volta sem fim.
--
-- `campaign_template_skips` é nova: por campanha e modelo, quantas vezes a
-- plataforma recusou o modelo, o último motivo e quando. A tela da campanha
-- mostra isso ao lado do resultado de cada modelo.
--
-- Escrita só pelo servidor, como as outras tabelas de campanha (migration
-- 0376): `authenticated` só lê, filtrado pela organização.
--
-- Aditiva e idempotente.

alter table public.campaign_recipient_templates
  add column if not exists tentativas_indisponivel smallint not null default 0;

comment on column public.campaign_recipient_templates.tentativas_indisponivel is
  'Quantas vezes esta pessoa voltou à fila porque a plataforma recusou o modelo (pausado, desativado ou não aprovado). Passou de 3, fica como falha.';

create table if not exists public.campaign_template_skips (
  campaign_id uuid not null references public.campaigns(id) on delete cascade,
  organization_id uuid not null references public.organizations(id) on delete cascade,
  template_name text not null,
  template_language text not null,
  motivo text not null,
  vezes integer not null default 0,
  ultima_em timestamptz not null default now(),
  constraint campaign_template_skips_pkey primary key (campaign_id, template_name, template_language),
  constraint campaign_template_skips_vezes_check check (vezes >= 0)
);

comment on table public.campaign_template_skips is
  'Fork da Genuine: quantas vezes a plataforma recusou cada modelo de uma campanha (pausado, desativado, não aprovado), o último motivo e quando. A pessoa recusada voltou à fila com outro modelo.';

alter table public.campaign_template_skips enable row level security;

drop policy if exists campaign_template_skips_select on public.campaign_template_skips;
create policy campaign_template_skips_select on public.campaign_template_skips
  for select using (
    (organization_id in (select public.fn_user_org_ids())) or public.fn_is_platform_admin()
  );

revoke all on public.campaign_template_skips from public, anon, authenticated;
grant select on public.campaign_template_skips to authenticated;
grant all on public.campaign_template_skips to service_role;
