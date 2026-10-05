-- Carrega o CSV de `filtrar_receita.py` na tabela do mercado
-- (`public.prospecting_market_companies`, migration 9002).
--
-- O CSV entra pela entrada padrão do psql (`pstdin`): o \copy não aceita
-- variável no nome do arquivo.
--
-- Variável do psql:
--   completa    true quando a base INTEIRA foi lida; só então quem saiu do
--               recorte (fechou, mudou de atividade, virou MEI) sai da tabela
--
--   psql "$SUPABASE_DB_URL" -v completa=true \
--        -f scripts/genuine/mercado/carregar.sql < mercado.csv
--
-- O mês da base vem do PRÓPRIO CSV, nunca de uma variável à parte: se os dois
-- discordassem, o apagar de "quem não é deste mês" levaria a base inteira.
--
-- Tudo numa transação: ou a tabela fica com a base nova inteira, ou fica como
-- estava. A guarda contra base pela metade: com `completa`, se a carga trouxe
-- menos da metade das linhas que a tabela já tem, nada é apagado (um download
-- interrompido não esvazia o mercado).
\set ON_ERROR_STOP on

-- A tabela nasce na migration 9002, que chega ao banco quando a VPS atualiza.
-- Release publicada antes da atualização da VPS cai aqui, com o que fazer.
select to_regclass('public.prospecting_market_companies') is not null as tem_tabela \gset
\if :tem_tabela
\else
  do $$ begin raise exception 'A tabela do mercado ainda não existe neste banco: atualize a instalação (update.sh) e rode a rotina de novo.'; end $$;
\endif

begin;

create temp table mercado_carga (like public.prospecting_market_companies including defaults)
  on commit drop;

\copy mercado_carga (cnpj, cnpj_basico, matriz, razao_social, nome_fantasia, data_inicio, cnae_principal, cnae_principal_descricao, cnaes_secundarios, recorte_pela_principal, uf, municipio_codigo, municipio, bairro, cep, endereco, telefone1, telefone2, email, porte, capital_social_centavos, natureza_juridica, opcao_simples, referencia) from pstdin with (format csv, header true)

select count(*) as linhas_novas,
       count(distinct referencia) = 1 as uma_referencia,
       max(referencia) as referencia
  from mercado_carga \gset
\if :uma_referencia
\else
  do $$ begin raise exception 'O CSV não tem um único mês de base (vazio ou misturado). Nada foi gravado.'; end $$;
\endif
select count(*) as linhas_atuais from public.prospecting_market_companies \gset

with gravadas as (
  insert into public.prospecting_market_companies (
    cnpj, cnpj_basico, matriz, razao_social, nome_fantasia, data_inicio,
    cnae_principal, cnae_principal_descricao, cnaes_secundarios, recorte_pela_principal,
    uf, municipio_codigo, municipio, bairro, cep, endereco, telefone1, telefone2, email,
    porte, capital_social_centavos, natureza_juridica, opcao_simples, referencia
  )
  select
    cnpj, cnpj_basico, matriz, razao_social, nullif(nome_fantasia, ''), data_inicio,
    cnae_principal, nullif(cnae_principal_descricao, ''), cnaes_secundarios, recorte_pela_principal,
    uf, nullif(municipio_codigo, ''), nullif(municipio, ''), nullif(bairro, ''), nullif(cep, ''),
    nullif(endereco, ''), nullif(telefone1, ''), nullif(telefone2, ''), nullif(email, ''),
    porte, capital_social_centavos, nullif(natureza_juridica, ''), opcao_simples, referencia
  from mercado_carga
  on conflict (cnpj) do update set
    (cnpj_basico, matriz, razao_social, nome_fantasia, data_inicio,
     cnae_principal, cnae_principal_descricao, cnaes_secundarios, recorte_pela_principal,
     uf, municipio_codigo, municipio, bairro, cep, endereco, telefone1, telefone2, email,
     porte, capital_social_centavos, natureza_juridica, opcao_simples, referencia, atualizado_em)
    = (excluded.cnpj_basico, excluded.matriz, excluded.razao_social, excluded.nome_fantasia,
       excluded.data_inicio, excluded.cnae_principal, excluded.cnae_principal_descricao,
       excluded.cnaes_secundarios, excluded.recorte_pela_principal, excluded.uf,
       excluded.municipio_codigo, excluded.municipio, excluded.bairro, excluded.cep,
       excluded.endereco, excluded.telefone1, excluded.telefone2, excluded.email,
       excluded.porte, excluded.capital_social_centavos, excluded.natureza_juridica,
       excluded.opcao_simples, excluded.referencia, now())
  returning (xmax = 0) as nova
)
select count(*) filter (where nova) as inseridas,
       count(*) filter (where not nova) as atualizadas
  from gravadas \gset

\echo 'inseridas:' :inseridas ' atualizadas:' :atualizadas

\if :completa
  select (:linhas_novas >= :linhas_atuais / 2) as pode_apagar \gset
  \if :pode_apagar
    with saidas as (
      delete from public.prospecting_market_companies
       where referencia <> :'referencia'
      returning 1
    )
    select count(*) as removidas from saidas \gset
    \echo 'removidas (saíram do recorte):' :removidas
  \else
    \echo 'AVISO: a base nova tem menos da metade das linhas atuais; nada foi removido.'
  \endif
\endif

commit;
