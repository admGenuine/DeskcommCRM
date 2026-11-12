/**
 * A tabela da campanha com modelo (migration 9006, fork da Genuine) contra o
 * baseline que a VPS aplica: isolamento, quem escreve e os limites que o
 * banco guarda. A escrita é só do servidor, como nas outras tabelas de
 * campanha (migration 0376).
 */
import { describe, expect, it } from "vitest";

import { sql } from "./gov-helpers";

const TABELA = "public.campaign_message_templates";

describe("campaign_message_templates contra o baseline", () => {
  it("existe, com RLS ligada e uma política de leitura por organização", () => {
    expect(sql(`select relrowsecurity from pg_class where oid = '${TABELA}'::regclass`)).toBe("t");
    expect(
      sql(
        `select count(*) from pg_policies where schemaname = 'public' and tablename = 'campaign_message_templates' and cmd = 'SELECT'`,
      ),
    ).toBe("1");
  });

  it("o navegador só lê: anon não alcança nada, authenticated só SELECT", () => {
    expect(
      sql(
        `select bool_and(not has_table_privilege('anon', '${TABELA}', o)) from unnest(array['SELECT','INSERT','UPDATE','DELETE']) o`,
      ),
    ).toBe("t");
    expect(sql(`select has_table_privilege('authenticated', '${TABELA}', 'SELECT')`)).toBe("t");
    expect(
      sql(
        `select bool_and(not has_table_privilege('authenticated', '${TABELA}', o)) from unnest(array['INSERT','UPDATE','DELETE','TRUNCATE']) o`,
      ),
    ).toBe("t");
  });

  it("some com a campanha (cascade) e com a organização", () => {
    expect(
      sql(
        `select string_agg(confrelid::regclass::text || ':' || confdeltype, ',' order by confrelid::regclass::text)
           from pg_constraint where conrelid = '${TABELA}'::regclass and contype = 'f'`,
      ),
    ).toBe("campaigns:c,organizations:c");
  });

  it("o banco guarda os limites: envios por rodada de 1 a 60 e o mapa como objeto", () => {
    const checks = sql(
      `select string_agg(pg_get_constraintdef(oid), ' | ') from pg_constraint where conrelid = '${TABELA}'::regclass and contype = 'c'`,
    );
    expect(checks).toMatch(/envios_por_rodada >= 1/);
    expect(checks).toMatch(/envios_por_rodada <= 60/);
    expect(checks).toMatch(/jsonb_typeof\(variable_map\) = 'object'/);
  });
});
