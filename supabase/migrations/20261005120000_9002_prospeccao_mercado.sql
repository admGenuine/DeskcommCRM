-- ═══ Mercado: empresas da base pública da Receita (9002, fork da Genuine) ═══
--
-- Migration do fork `admgenuine/DeskcommCRM` (numeração a partir de 9001, ver
-- docs/genuine/FORK.md). Fase 2 do plano da prospecção
-- (docs/genuine/PLANO-PROSPECCAO.md): em vez de descobrir empresas só pelo
-- Maps, pago e na ordem dele, a prospecção parte da base pública de CNPJ da
-- Receita, filtrada para o recorte do dono (estados, CNAE, sem MEI).
--
-- Quem escreve: a rotina `.github/workflows/genuine-mercado.yml`, que baixa a
-- base, filtra com `scripts/genuine/mercado/filtrar_receita.py` e carrega com
-- `scripts/genuine/mercado/carregar.sql`. Ninguém escreve pela aplicação.
-- Quem lê: só o servidor (service_role), na aba Mercado da Prospecção.
--
-- Por que SEM organization_id: é dado público de referência da instalação, o
-- mesmo para qualquer organização, como um catálogo. O que é da organização
-- (a empresa levada para uma campanha, a avaliação, o contato) continua em
-- `prospecting_candidates`, com organization_id, RLS e a supressão da LGPD.
--
-- Uma linha por ESTABELECIMENTO (CNPJ de 14 dígitos): matriz e filiais entram
-- separadas, porque têm endereço e telefone próprios.
--
-- Aditiva e idempotente. Sem função nova.

create table if not exists public.prospecting_market_companies (
  cnpj text primary key check (cnpj ~ '^[0-9]{14}$'),
  cnpj_basico text not null check (cnpj_basico ~ '^[0-9]{8}$'),
  matriz boolean not null,
  razao_social text not null,
  nome_fantasia text,
  data_inicio date,
  cnae_principal text not null,
  cnae_principal_descricao text,
  cnaes_secundarios text[] not null default '{}',
  recorte_pela_principal boolean not null,
  uf text not null,
  municipio_codigo text,
  municipio text,
  bairro text,
  cep text,
  endereco text,
  telefone1 text,
  telefone2 text,
  email text,
  porte text not null,
  capital_social_centavos bigint,
  natureza_juridica text,
  opcao_simples boolean,
  referencia text not null check (referencia ~ '^[0-9]{4}-[0-9]{2}$'),
  atualizado_em timestamptz not null default now()
);

alter table public.prospecting_market_companies
  drop constraint if exists prospecting_market_companies_porte_check;
alter table public.prospecting_market_companies
  add constraint prospecting_market_companies_porte_check
  check (porte in ('ME', 'EPP', 'DEMAIS', 'NAO_INFORMADO'));

create index if not exists prospecting_market_uf_municipio
  on public.prospecting_market_companies (uf, municipio);
create index if not exists prospecting_market_cnae_principal
  on public.prospecting_market_companies (cnae_principal);

comment on table public.prospecting_market_companies is
  'Empresas da base pública de CNPJ da Receita no recorte da prospecção (fork da Genuine). Escrita só pela rotina de importação; leitura só pelo servidor.';

alter table public.prospecting_market_companies enable row level security;
revoke all on public.prospecting_market_companies from public, anon, authenticated;
grant all on public.prospecting_market_companies to service_role;

notify pgrst, 'reload schema';
