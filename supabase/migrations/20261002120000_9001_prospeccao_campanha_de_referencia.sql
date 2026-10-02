-- ═══ Campanha de referência do perfil ideal (9001, fork da Genuine) ═══
--
-- Migration do fork `admgenuine/DeskcommCRM`. As do fork começam em 9001 para
-- nunca colidir com a numeração do projeto original (ver docs/genuine/FORK.md).
--
-- O dono da prospecção marca uma campanha como REFERÊNCIA do perfil ideal: as
-- empresas dela que passaram pela régua de perfil passam a contar como
-- "gostei" no gosto aprendido (`lib/prospecting/aprendizado.ts`), junto com as
-- avaliações empresa a empresa (que moram em `prospecting_candidates.data`,
-- onde a anonimização da LGPD já alcança).
--
--   - referencia_em: quando foi marcada; NULL = não é referência;
--   - referencia_motivo: por que ela é referência, escrito pelo dono (opcional).
--
-- Aditiva e idempotente; nenhuma linha existente muda. Sem função nova.
-- Tabela continua exclusiva do servidor (RLS e grants da 0369 inalterados).

alter table public.prospecting_campaigns
  add column if not exists referencia_em timestamptz,
  add column if not exists referencia_motivo text;

comment on column public.prospecting_campaigns.referencia_em is
  'Quando a campanha foi marcada como referência do perfil ideal. NULL = não é referência.';
comment on column public.prospecting_campaigns.referencia_motivo is
  'Por que a campanha é referência do perfil ideal, escrito por quem marcou (opcional).';

notify pgrst, 'reload schema';
