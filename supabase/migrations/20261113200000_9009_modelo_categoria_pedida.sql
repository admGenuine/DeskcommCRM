-- manifest: meta_templates.categoria_pedida guarda a categoria que a pessoa escolheu ao criar o modelo pela tela, para mostrar quando a Meta classificar o modelo em outra (fork da Genuine)
--
-- ═══ Criar modelo pela tela no canal oficial (9009, fork da Genuine) ═══
--
-- Pedido do dono em 13/11/2026: criar, editar e apagar modelo da Cloud API pela
-- ferramenta. A Meta pode devolver o modelo com categoria diferente da escolhida
-- (Utilidade virando Marketing, que custa mais), e a tela precisa mostrar isso.
--
-- `categoria_pedida` é a escolha de quem criou; `category` continua sendo o que a
-- Meta diz. Nula para modelo criado fora da ferramenta. A sincronização não lista
-- a coluna no upsert, então a escolha sobrevive a ela.
--
-- Aditiva e idempotente.

alter table public.meta_templates
  add column if not exists categoria_pedida text;

comment on column public.meta_templates.categoria_pedida is
  'Fork da Genuine: a categoria que a pessoa escolheu ao criar o modelo pela tela (MARKETING, UTILITY, AUTHENTICATION). Nula quando o modelo veio da Meta. Diferente de category = a Meta reclassificou.';
