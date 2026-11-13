/**
 * A categoria escolhida ao criar modelo pela tela (migration 9009, fork da
 * Genuine) contra o baseline que a VPS aplica: a coluna existe, é opcional, e
 * a sincronização (que não a lista) não a apaga.
 */
import { randomUUID } from "node:crypto";

import { describe, expect, it } from "vitest";

import { sql } from "./gov-helpers";

describe("meta_templates.categoria_pedida (migration 9009)", () => {
  it("existe, é texto e é opcional (modelo vindo da Meta não tem escolha)", () => {
    expect(
      sql(
        `select data_type || ':' || is_nullable
           from information_schema.columns
          where table_schema = 'public' and table_name = 'meta_templates' and column_name = 'categoria_pedida'`,
      ),
    ).toBe("text:YES");
  });

  it("o upsert da sincronização, que não lista a coluna, preserva a escolha", () => {
    const org = randomUUID();
    sql(
      `insert into public.organizations (id, slug, legal_name, display_name)
       values ('${org}', 'org-9009-${org}', 'Org 9009', 'Org 9009')`,
    );
    const chave = `'${org}', 'waba-9009', 'modelo_9009', 'pt_BR'`;
    sql(
      `insert into public.meta_templates (organization_id, waba_id, name, language, status, category, categoria_pedida, components, contract_hash)
       values (${chave}, 'PENDING', 'UTILITY', 'UTILITY', '[]'::jsonb, 'h')`,
    );
    sql(
      `insert into public.meta_templates (organization_id, waba_id, name, language, status, category, components, contract_hash)
       values (${chave}, 'APPROVED', 'MARKETING', '[]'::jsonb, 'h')
       on conflict (organization_id, waba_id, name, language)
       do update set status = excluded.status, category = excluded.category`,
    );
    expect(
      sql(
        `select status || ':' || category || ':' || categoria_pedida from public.meta_templates
          where organization_id = '${org}' and name = 'modelo_9009'`,
      ),
    ).toBe("APPROVED:MARKETING:UTILITY");
    sql(`delete from public.organizations where id = '${org}'`);
  });
});
