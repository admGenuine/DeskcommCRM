-- manifest: prospecting_campaigns.gasto_ia_centavos: quanto a leitura dos sites por IA já gastou em cada campanha, para o teto por campanha (fork da Genuine, Fase 3b)
--
-- ═══ Gasto da leitura por IA, por campanha (9003, fork da Genuine) ═══
--
-- Migration do fork `admgenuine/DeskcommCRM` (numeração a partir de 9001, ver
-- docs/genuine/FORK.md). Fase 3b do plano da prospecção
-- (docs/genuine/PLANO-PROSPECCAO.md): o dono pede a leitura dos sites por IA
-- campanha a campanha, com teto de gasto por campanha.
--
-- Por que uma coluna, e não a soma das leituras gravadas em cada candidato: a
-- leitura mora em `prospecting_candidates.data.analise.ia`, e refazer a
-- análise grátis (ou a anonimização da LGPD) reescreve esse `data`. Somado de
-- lá, o gasto encolheria e o teto renasceria. Aqui ele só cresce: o worker
-- RESERVA antes de chamar o modelo (só reserva se couber no teto) e acerta
-- pelo custo real depois.
--
-- Em centavos de DÓLAR, fracionário, a mesma régua de `llm_calls.cost_cents`.
-- Aditiva e idempotente.

alter table public.prospecting_campaigns
  add column if not exists gasto_ia_centavos numeric(12,4) not null default 0;

alter table public.prospecting_campaigns
  drop constraint if exists prospecting_campaigns_gasto_ia_centavos_check;
alter table public.prospecting_campaigns
  add constraint prospecting_campaigns_gasto_ia_centavos_check
  check (gasto_ia_centavos >= 0);

comment on column public.prospecting_campaigns.gasto_ia_centavos is
  'Gasto acumulado da leitura dos sites por IA nesta campanha, em centavos de dólar (fork da Genuine, Fase 3b). Só cresce; o teto por campanha é lido contra ele.';

notify pgrst, 'reload schema';
