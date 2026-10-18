-- manifest: prospecting_campaigns.gasto_maps_usd: quanto a busca no Maps das empresas do Mercado sem site já gastou (ou reservou) em cada campanha, para o teto por campanha (fork da Genuine, Fase 3b)
--
-- ═══ Gasto da busca no Maps das empresas do Mercado, por campanha (9004, fork da Genuine) ═══
--
-- Migration do fork `admgenuine/DeskcommCRM` (numeração a partir de 9001, ver
-- docs/genuine/FORK.md). Fase 3b do plano da prospecção
-- (docs/genuine/PLANO-PROSPECCAO.md): as empresas do Mercado (Receita) que
-- ficaram sem site na análise grátis podem ser procuradas no Maps, pelo saldo
-- da Apify da organização, com teto por campanha.
--
-- Em dólares, fracionário, a mesma régua de `prospecting_campaigns.cost_usd`.
-- Ao começar uma busca, o teto da execução (`maxTotalChargeUsd`) é RESERVADO
-- aqui; quando ela termina, a reserva é trocada pelo custo que a Apify informou.
-- Duas buscas seguidas não somam mais que o teto.
--
-- Aditiva e idempotente.

alter table public.prospecting_campaigns
  add column if not exists gasto_maps_usd numeric(10,4) not null default 0;

alter table public.prospecting_campaigns
  drop constraint if exists prospecting_campaigns_gasto_maps_usd_check;
alter table public.prospecting_campaigns
  add constraint prospecting_campaigns_gasto_maps_usd_check
  check (gasto_maps_usd >= 0);

comment on column public.prospecting_campaigns.gasto_maps_usd is
  'Gasto (e reserva em andamento) da busca no Maps das empresas do Mercado sem site, em dólares (fork da Genuine, Fase 3b). O teto por campanha é lido contra ele.';

notify pgrst, 'reload schema';
