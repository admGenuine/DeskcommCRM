import { describe, expect, it } from "vitest";

import { sql } from "./gov-helpers";

/**
 * A tabela do mercado (migration 9002, fork da Genuine) é dado público de
 * referência, sem organization_id, e por isso fica fora da varredura de RLS
 * por organização (`rls-completude-varredura.test.ts`, que deriva a lista das
 * colunas organization_id). A garantia dela é outra: NENHUM papel do navegador
 * lê ou escreve, e só o servidor (service_role) alcança. Este arquivo é a prova.
 */
const linha = (cnpj: string, porte = "ME", referencia = "2026-09") =>
  `('${cnpj}','${cnpj.slice(0, 8)}',true,'EMPRESA TESTE LTDA','1099699',true,'SC','${porte}','${referencia}')`;
const inserir = (valores: string) =>
  sql(
    `insert into prospecting_market_companies(cnpj,cnpj_basico,matriz,razao_social,cnae_principal,recorte_pela_principal,uf,porte,referencia) values ${valores}`,
  );

describe("mercado: base pública da Receita, só o servidor alcança", () => {
  it("RLS ligada e nenhum privilégio para anon nem authenticated", () => {
    expect(
      sql(
        "select relrowsecurity from pg_class where oid = 'public.prospecting_market_companies'::regclass",
      ),
    ).toBe("t");
    expect(
      sql(
        `select bool_and(not has_table_privilege(r,'public.prospecting_market_companies',o)) from unnest(array['anon','authenticated']) r cross join unnest(array['SELECT','INSERT','UPDATE','DELETE','TRUNCATE']) o`,
      ),
    ).toBe("t");
    expect(
      sql(
        "select has_table_privilege('service_role','public.prospecting_market_companies','SELECT')",
      ),
    ).toBe("t");
  });

  it("aceita o porte da Receita e recusa o que não é porte", () => {
    inserir(linha("11111111000111", "DEMAIS"));
    expect(() => inserir(linha("11111111000112", "MEI"))).toThrow();
    expect(sql("select porte from prospecting_market_companies where cnpj='11111111000111'")).toBe(
      "DEMAIS",
    );
  });

  it("recusa CNPJ que não tem 14 dígitos e mês da base fora de AAAA-MM", () => {
    expect(() => inserir(linha("1111111100011"))).toThrow();
    expect(() => inserir(linha("11.111.111/0001-11"))).toThrow();
    expect(() => inserir(linha("11111111000113", "ME", "09/2026"))).toThrow();
  });
});
