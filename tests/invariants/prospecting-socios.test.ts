import { afterAll, beforeAll, describe, expect, it } from "vitest";
import pg from "pg";

import {
  decisoresPorRaiz,
  gravarUsoDeSocios,
  lerUsoDeSocios,
} from "@/lib/prospecting/mercado/socios";

import { sql } from "./gov-helpers";

/**
 * O quadro de sócios do Mercado (migration 9005, Fase 5 do fork da Genuine)
 * contra o baseline que a VPS aplica.
 *
 * É dado de pessoa sem organization_id (referência da instalação, como a
 * 9002), então fica fora da varredura de RLS por organização. A garantia é
 * outra, e este arquivo é a prova: nenhum papel do navegador alcança a tabela,
 * e o uso por organização só existe ligado e com a referência do legítimo
 * interesse, sem apagar o resto de `organizations.settings`.
 */
const container = process.env.TEST_DB_CONTAINER;
if (!container) {
  throw new Error("TEST_DB_CONTAINER not set — rode via `pnpm test:db` (scripts/test-db.sh)");
}
const pool = new pg.Pool({
  host: "127.0.0.1",
  port: Number(process.env.TEST_DB_PORT ?? 54329),
  user: "postgres",
  password: "postgres",
  database: "postgres",
});
afterAll(() => pool.end());

const ORG = "50c10500-0000-4000-8000-00000000000a";

const inserir = (valores: string) =>
  sql(
    `insert into prospecting_market_socios(cnpj_basico,nome,qualificacao_codigo,qualificacao,data_entrada,referencia) values ${valores}`,
  );

beforeAll(() => {
  sql(`insert into organizations(id,slug,legal_name,display_name,status,settings) values
         ('${ORG}','socios-a','A','A','active','{"prospecting":{"provider":"apify"},"outra":1}')`);
});

describe("quadro de sócios: só o servidor alcança", () => {
  it("RLS ligada e nenhum privilégio para anon nem authenticated", () => {
    expect(
      sql(
        "select relrowsecurity from pg_class where oid = 'public.prospecting_market_socios'::regclass",
      ),
    ).toBe("t");
    expect(
      sql(
        `select bool_and(not has_table_privilege(r,'public.prospecting_market_socios',o)) from unnest(array['anon','authenticated']) r cross join unnest(array['SELECT','INSERT','UPDATE','DELETE','TRUNCATE']) o`,
      ),
    ).toBe("t");
    expect(
      sql("select has_table_privilege('service_role','public.prospecting_market_socios','SELECT')"),
    ).toBe("t");
  });

  it("não há coluna de CPF nem de faixa etária", () => {
    expect(
      sql(
        `select string_agg(column_name, ',' order by column_name) from information_schema.columns
          where table_schema='public' and table_name='prospecting_market_socios'`,
      ),
    ).toBe(
      "atualizado_em,cnpj_basico,data_entrada,id,nome,qualificacao,qualificacao_codigo,referencia",
    );
  });

  it("recusa raiz de CNPJ e mês fora do formato", () => {
    expect(() => inserir(`('1951868','X','49',null,null,'2026-10')`)).toThrow();
    expect(() => inserir(`('19518682','X','49',null,null,'10/2026')`)).toThrow();
  });
});

describe("o uso por organização", () => {
  it("nasce desligado; ligar guarda a referência e quem ligou, sem apagar o resto das settings", async () => {
    expect((await lerUsoDeSocios(pool, ORG)).ativo).toBe(false);
    await gravarUsoDeSocios(pool, ORG, "user-1", { ativo: true, base_legal_ref: "LIA-2026-10" });
    expect(await lerUsoDeSocios(pool, ORG)).toMatchObject({
      ativo: true,
      base_legal_ref: "LIA-2026-10",
      alterado_por: "user-1",
    });
    expect(
      sql(`select settings->'prospecting'->>'provider' from organizations where id='${ORG}'`),
    ).toBe("apify");
    expect(sql(`select settings->>'outra' from organizations where id='${ORG}'`)).toBe("1");
  });

  it("desligar mantém a referência que valia, para o histórico", async () => {
    await gravarUsoDeSocios(pool, ORG, "user-2", { ativo: false });
    expect(await lerUsoDeSocios(pool, ORG)).toMatchObject({
      ativo: false,
      base_legal_ref: "LIA-2026-10",
      alterado_por: "user-2",
    });
  });

  it("ligado sem referência (gravado à mão no banco) vale como desligado", async () => {
    sql(`update organizations set settings = jsonb_set(settings,'{prospecting,socios}',
           '{"ativo":true,"base_legal_ref":"","alterado_em":null,"alterado_por":null}') where id='${ORG}'`);
    expect((await lerUsoDeSocios(pool, ORG)).ativo).toBe(false);
  });
});

describe("os decisores pela raiz do CNPJ", () => {
  it("lê de várias empresas numa consulta e escolhe pela ordem de quem decide", async () => {
    inserir(`('19518682','MARIA SOUZA','22','Sócio','2010-01-01','2026-10'),
             ('19518682','JOAO DA SILVA','49','Sócio-Administrador','2015-05-01','2026-10'),
             ('22222222','ANA LIMA','05','Administrador',null,'2026-10')`);
    const d = await decisoresPorRaiz(pool, ["19518682", "22222222", "33333333", "x"]);
    expect(d.get("19518682")?.map((x) => x.nome)).toEqual(["Joao da Silva", "Maria Souza"]);
    expect(d.get("22222222")).toEqual([{ nome: "Ana Lima", cargo: "Administrador", desde: null }]);
    expect(d.has("33333333")).toBe(false);
  });
});
