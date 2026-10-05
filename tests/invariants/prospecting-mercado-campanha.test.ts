import { afterAll, beforeAll, describe, expect, it } from "vitest";
import pg from "pg";

import { criarCampanhaDoMercado, previaDoMercado } from "@/lib/prospecting/mercado/campanha";
import { filtrosDoMercadoSchema } from "@/lib/prospecting/mercado/filtros";

import { sql } from "./gov-helpers";

/**
 * A aba Mercado contra o banco de verdade (fork da Genuine, Fase 2): a SQL da
 * prévia e da criação de campanha montada em `lib/prospecting/mercado/` roda no
 * baseline que a VPS aplica. Medido na construção: um parâmetro que a consulta
 * de cidades não usava derrubava a prévia inteira (42P18), e uma filial com o
 * telefone da matriz criava campanha vazia. Teste de unidade com banco falso
 * não pega nenhum dos dois.
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

const ORG_A = "9e1c0da0-0000-4000-8000-00000000000a";
const ORG_B = "9e1c0da0-0000-4000-8000-00000000000b";
const f = (x: object = {}) => filtrosDoMercadoSchema.parse(x);

const empresa = (
  cnpj: string,
  nome: string,
  o: {
    porte?: string;
    uf?: string;
    municipio?: string;
    tel?: string | null;
    matriz?: boolean;
    cnae?: string;
    secundarios?: string;
    principal?: boolean;
    capital?: number;
  } = {},
) =>
  `('${cnpj}','${cnpj.slice(0, 8)}',${o.matriz ?? true},'${nome}','${nome}','${o.cnae ?? "1052000"}','Fabricação de laticínios','{${o.secundarios ?? ""}}',${o.principal ?? true},'${o.uf ?? "PR"}','${o.municipio ?? "CURITIBA"}',${o.tel === null ? "null" : `'${o.tel ?? "41999990000"}'`},'${o.porte ?? "EPP"}',${o.capital ?? 100000},'2026-09')`;

beforeAll(() => {
  sql(`insert into organizations(id,slug,legal_name,display_name) values
         ('${ORG_A}','mercado-a','A','A'),('${ORG_B}','mercado-b','B','B');
       insert into contacts(organization_id,name,phone_number) values ('${ORG_A}','Já cliente','+5548999990005');
       insert into prospecting_market_companies
         (cnpj,cnpj_basico,matriz,razao_social,nome_fantasia,cnae_principal,cnae_principal_descricao,cnaes_secundarios,recorte_pela_principal,uf,municipio,telefone1,porte,capital_social_centavos,referencia)
       values
         ${empresa("90000001000100", "LATICINIOS GRANDE", { porte: "DEMAIS", tel: "41999990001", capital: 500000000 })},
         ${empresa("90000001000211", "LATICINIOS GRANDE FILIAL", { porte: "DEMAIS", tel: "41999990001", matriz: false })},
         ${empresa("90000002000100", "FRIGORIFICO SC", { uf: "SC", municipio: "PALHOCA", tel: "4832860002" })},
         ${empresa("90000003000100", "MASSAS PEQUENA", { porte: "ME", tel: "4133330003", capital: 1000000 })},
         ${empresa("90000005000100", "JA NO CRM", { uf: "SC", municipio: "PALHOCA", tel: "48999990005" })},
         ${empresa("90000006000100", "SO PELA SECUNDARIA", { cnae: "4639701", secundarios: "1052000", principal: false, tel: "41999990006" })},
         ${empresa("90000007000100", "SEM TELEFONE", { porte: "DEMAIS", tel: null })};`);
});

describe("aba Mercado: prévia e campanha contra o baseline", () => {
  it("a prévia conta, lista cidades e ordena as maiores primeiro", async () => {
    const p = await previaDoMercado(pool, ORG_A, f());
    expect(p.referencia).toBe("2026-09");
    // com telefone e pela atividade principal (padrão): sai a secundária e a sem telefone
    expect(p.total).toBe(5);
    expect(p.amostra.map((a) => a.nome)).toEqual([
      "LATICINIOS GRANDE",
      "FRIGORIFICO SC",
      "JA NO CRM",
      "MASSAS PEQUENA",
      "LATICINIOS GRANDE FILIAL",
    ]);
    expect(p.municipios).toEqual([
      { municipio: "CURITIBA", uf: "PR", empresas: 3 },
      { municipio: "PALHOCA", uf: "SC", empresas: 2 },
    ]);
    const so = await previaDoMercado(pool, ORG_A, f({ uf: "SC", portes: ["EPP"] }));
    expect(so.total).toBe(2);
    const comSecundaria = await previaDoMercado(
      pool,
      ORG_A,
      f({ grupo: "105", so_principal: false }),
    );
    // a secundária entra quando o filtro pede; a sem telefone continua de fora
    expect(comSecundaria.total).toBe(6);
  });

  it("a campanha nasce concluída, com a régua de entrada, e a prévia passa a não contar as que entraram", async () => {
    const c = await criarCampanhaDoMercado(pool, ORG_A, "9e1c0da0-2222-4000-8000-00000000000a", {
      filtros: f({ com_telefone: false }),
      limite: 50,
    });
    expect(c.search_status).toBe("succeeded");
    expect(c.search).toMatchObject({ fonte: "mercado", niche: "Indústrias de alimentos" });
    const candidatos = sql(
      `select string_agg(place_id || '=' || status || '=' || coalesce(error,''), ' | ' order by place_id)
         from prospecting_candidates where organization_id='${ORG_A}' and campaign_id='${c.id}'`,
    );
    expect(candidatos).toBe(
      [
        "cnpj:90000001000100=new=",
        "cnpj:90000002000100=new=",
        "cnpj:90000003000100=new=",
        "cnpj:90000005000100=skipped=Já está no CRM.",
        "cnpj:90000007000100=skipped=Sem telefone na Receita.",
      ].join(" | "),
    );
    // a filial tem o telefone da matriz: o banco recusa, e a campanha diz
    expect(c.result_count).toBe(5);
    expect(c.skipped_count).toBe(1);
    expect(c.error).toMatch(/telefone/);
    const depois = await previaDoMercado(pool, ORG_A, f());
    expect(depois.novas).toBe(0);
  });

  it("repetir o mesmo pedido devolve a mesma campanha, e filtro sem nada novo recusa", async () => {
    const a = await criarCampanhaDoMercado(pool, ORG_A, "9e1c0da0-2222-4000-8000-00000000000a", {
      filtros: f({ com_telefone: false }),
      limite: 50,
    });
    expect(sql(`select count(*) from prospecting_campaigns where organization_id='${ORG_A}'`)).toBe(
      "1",
    );
    expect(a.result_count).toBe(5);
    await expect(
      criarCampanhaDoMercado(pool, ORG_A, "9e1c0da0-2222-4000-8000-00000000000c", {
        filtros: f(),
        limite: 50,
      }),
    ).rejects.toThrow(/Nenhuma empresa nova/);
    expect(sql(`select count(*) from prospecting_campaigns where organization_id='${ORG_A}'`)).toBe(
      "1",
    );
  });

  it("o que a organização A levou não some do mercado da organização B", async () => {
    const b = await previaDoMercado(pool, ORG_B, f());
    expect(b.novas).toBe(5);
    const c = await criarCampanhaDoMercado(pool, ORG_B, "9e1c0da0-2222-4000-8000-00000000000b", {
      filtros: f({ uf: "SC" }),
      limite: 10,
    });
    expect(
      sql(
        `select count(*) from prospecting_candidates where organization_id='${ORG_B}' and campaign_id='${c.id}' and status='new'`,
      ),
    ).toBe("2");
  });
});
