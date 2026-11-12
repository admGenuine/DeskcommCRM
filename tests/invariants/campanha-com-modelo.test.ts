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

describe("vários modelos em rodízio (migration 9007)", () => {
  const REGISTRO = "public.campaign_recipient_templates";

  it("a lista tem uma linha por modelo: chave (campaign_id, posicao), posição de 0 a 4 e peso de 1 a 10", () => {
    expect(
      sql(
        `select string_agg(a.attname, ',' order by k.ord)
           from pg_constraint c
           cross join lateral unnest(c.conkey) with ordinality as k(attnum, ord)
           join pg_attribute a on a.attrelid = c.conrelid and a.attnum = k.attnum
          where c.conrelid = '${TABELA}'::regclass and c.contype = 'p'`,
      ),
    ).toBe("campaign_id,posicao");
    const checks = sql(
      `select string_agg(pg_get_constraintdef(oid), ' | ') from pg_constraint where conrelid = '${TABELA}'::regclass and contype = 'c'`,
    );
    expect(checks).toMatch(/posicao >= 0/);
    expect(checks).toMatch(/posicao <= 4/);
    expect(checks).toMatch(/peso >= 1/);
    expect(checks).toMatch(/peso <= 10/);
  });

  it("o registro do modelo usado: RLS ligada, o navegador só lê, some com a pessoa, a campanha e a organização", () => {
    expect(sql(`select relrowsecurity from pg_class where oid = '${REGISTRO}'::regclass`)).toBe(
      "t",
    );
    expect(
      sql(
        `select bool_and(not has_table_privilege('anon', '${REGISTRO}', o)) from unnest(array['SELECT','INSERT','UPDATE','DELETE']) o`,
      ),
    ).toBe("t");
    expect(sql(`select has_table_privilege('authenticated', '${REGISTRO}', 'SELECT')`)).toBe("t");
    expect(
      sql(
        `select bool_and(not has_table_privilege('authenticated', '${REGISTRO}', o)) from unnest(array['INSERT','UPDATE','DELETE','TRUNCATE']) o`,
      ),
    ).toBe("t");
    expect(
      sql(
        `select string_agg(confrelid::regclass::text || ':' || confdeltype, ',' order by confrelid::regclass::text)
           from pg_constraint where conrelid = '${REGISTRO}'::regclass and contype = 'f'`,
      ),
    ).toBe("campaign_recipients:c,campaigns:c,organizations:c");
  });
});
