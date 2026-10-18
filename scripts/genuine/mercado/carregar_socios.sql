-- Carrega o CSV de sócios de `filtrar_receita.py --saida-socios` na tabela
-- `public.prospecting_market_socios` (migration 9005, Fase 5 do fork).
--
--   psql "$SUPABASE_DB_URL" -f scripts/genuine/mercado/carregar_socios.sql < socios.csv
--
-- TROCA a tabela inteira pela base nova, numa transação: quem saiu do quadro
-- de sócios no mês sai do banco também (dado de pessoa não fica velho por
-- descuido). A guarda contra base pela metade é a mesma de `carregar.sql`: se
-- a carga trouxe menos da metade das linhas atuais, nada é trocado.
--
-- Nenhum nome é impresso: o log do job é público. Só contagens.
\set ON_ERROR_STOP on

-- A tabela nasce na migration 9005, que chega ao banco quando a VPS atualiza.
-- Release publicada antes da atualização cai aqui: avisa e sai sem erro, para
-- não reprovar a carga das empresas, que já foi feita.
select to_regclass('public.prospecting_market_socios') is not null as tem_tabela \gset
\if :tem_tabela
\else
  \echo 'AVISO: a tabela de sócios ainda não existe neste banco (atualize a instalação com o update.sh). Os sócios não foram gravados.'
  \quit
\endif

begin;

create temp table socios_carga (
  cnpj_basico text,
  nome text,
  qualificacao_codigo text,
  qualificacao text,
  data_entrada text,
  referencia text
) on commit drop;

\copy socios_carga (cnpj_basico, nome, qualificacao_codigo, qualificacao, data_entrada, referencia) from pstdin with (format csv, header true)

select count(*) as linhas_novas,
       count(distinct referencia) = 1 as uma_referencia
  from socios_carga \gset
\if :uma_referencia
\else
  do $$ begin raise exception 'O CSV de sócios não tem um único mês de base (vazio ou misturado). Nada foi gravado.'; end $$;
\endif
select count(*) as linhas_atuais from public.prospecting_market_socios \gset

select (:linhas_novas >= :linhas_atuais / 2) as pode_trocar \gset
\if :pode_trocar
  delete from public.prospecting_market_socios;
  insert into public.prospecting_market_socios
    (cnpj_basico, nome, qualificacao_codigo, qualificacao, data_entrada, referencia)
  select cnpj_basico, nome, qualificacao_codigo, nullif(qualificacao, ''),
         nullif(data_entrada, '')::date, referencia
    from socios_carga;
  \echo 'sócios gravados:' :linhas_novas ' (antes:' :linhas_atuais ')'
\else
  \echo 'AVISO: a base nova de sócios tem menos da metade das linhas atuais; nada foi trocado.'
\endif

commit;
