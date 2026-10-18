-- manifest: prospecting_market_socios: o quadro de sócios pessoa física das empresas do Mercado (Receita), para achar o decisor; só nome, qualificação e entrada, sem CPF; só o servidor alcança (fork da Genuine, Fase 5)
--
-- ═══ Quadro de sócios das empresas do Mercado (9005, fork da Genuine) ═══
--
-- Migration do fork `admgenuine/DeskcommCRM` (numeração a partir de 9001, ver
-- docs/genuine/FORK.md). Fase 5 do plano da prospecção
-- (docs/genuine/PLANO-PROSPECCAO.md): decisão do dono em 18/10/2026, o decisor
-- de cada empresa sai do quadro de sócios da base pública da Receita.
--
-- ═══ É DADO DE PESSOA ═══
--
-- Nome de sócio pessoa física é dado pessoal (LGPD), ainda que publicado pela
-- Receita. Por isso:
--  - Só o que serve para achar o decisor: nome, qualificação (cargo) e data de
--    entrada. Nem CPF (que a Receita publica mascarado), nem faixa etária, nem
--    representante legal: `filtrar_receita.py` nem lê essas colunas.
--  - Só pessoa física (e estrangeira) das empresas que estão no recorte.
--  - Só o servidor alcança (como `prospecting_market_companies`); anon e
--    authenticated não têm privilégio nenhum.
--  - A tela só mostra sócios à organização que LIGOU o uso e registrou a
--    referência da avaliação de legítimo interesse
--    (`organizations.settings.prospecting.socios`), e só os calcula na hora:
--    nada é copiado para o candidato.
--  - A rotina mensal TROCA a tabela inteira (`carregar_socios.sql`): quem saiu
--    do quadro sai do banco.
--
-- Por que SEM organization_id: como a 9002, é dado público de referência da
-- instalação, o mesmo para qualquer organização.
--
-- Aditiva e idempotente.

create table if not exists public.prospecting_market_socios (
  id bigint generated always as identity primary key,
  cnpj_basico text not null check (cnpj_basico ~ '^[0-9]{8}$'),
  nome text not null check (length(nome) between 1 and 200),
  qualificacao_codigo text not null check (qualificacao_codigo ~ '^[0-9]{2,3}$'),
  qualificacao text,
  data_entrada date,
  referencia text not null check (referencia ~ '^[0-9]{4}-[0-9]{2}$'),
  atualizado_em timestamptz not null default now()
);

create index if not exists prospecting_market_socios_cnpj_basico
  on public.prospecting_market_socios (cnpj_basico);

comment on table public.prospecting_market_socios is
  'Quadro de sócios pessoa física das empresas do Mercado (base pública da Receita), só nome, qualificação e entrada (fork da Genuine, Fase 5). Escrita só pela rotina de importação, que troca a tabela inteira a cada mês; leitura só pelo servidor, e só para a organização que ligou o uso com a referência do legítimo interesse.';

alter table public.prospecting_market_socios enable row level security;
revoke all on public.prospecting_market_socios from public, anon, authenticated;
grant all on public.prospecting_market_socios to service_role;

notify pgrst, 'reload schema';
