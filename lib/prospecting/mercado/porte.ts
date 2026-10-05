/**
 * O porte que a Receita registra para a empresa, como a tabela do mercado
 * (`prospecting_market_companies.porte`) guarda.
 *
 * Na Receita é um código (01 ME, 03 EPP, 05 demais, 00 não informado), lido
 * por `scripts/genuine/mercado/filtrar_receita.py`. O MEI não aparece aqui de
 * propósito: ele sai na importação, pelo arquivo do Simples, porque o porte é
 * autodeclarado e não distingue MEI de ME (decisão do dono em 05/10/2026:
 * faturamento acima de cerca de R$ 100 mil por ano).
 *
 * O CHECK do banco e esta lista são o mesmo vocabulário, vigiado por
 * `tests/invariants/vocabulario-banco-x-typescript.test.ts`.
 */
export const PORTES_DO_MERCADO = ["ME", "EPP", "DEMAIS", "NAO_INFORMADO"] as const;
export type PorteDoMercado = (typeof PORTES_DO_MERCADO)[number];
