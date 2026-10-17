import { afterAll, beforeAll, describe, expect, it } from "vitest";
import pg from "pg";

import {
  analisarSitesPendentes,
  gravarAnalise,
  pedirAnaliseDaCampanha,
  reivindicarPendentes,
} from "@/lib/prospecting/sinais/fila";
import type { Leitura } from "@/lib/prospecting/sinais/leitor";

import { sql } from "./gov-helpers";

/**
 * A fila da análise de sites (Fase 3 do fork da Genuine) contra o baseline que
 * a VPS aplica: o JSON de `prospecting_candidates.data.analise` é escrito e lido
 * por SQL montado em `lib/prospecting/sinais/fila.ts`, e um erro de caminho de
 * jsonb ou de cast só aparece num Postgres de verdade.
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

const ORG_A = "5e1c0da0-0000-4000-8000-00000000000a";
const ORG_B = "5e1c0da0-0000-4000-8000-00000000000b";
const ORG_PARADA = "5e1c0da0-0000-4000-8000-00000000000c";
const CAMP_A = "5e1c0da0-1111-4000-8000-00000000000a";
const CAMP_B = "5e1c0da0-1111-4000-8000-00000000000b";
const CAMP_P = "5e1c0da0-1111-4000-8000-00000000000c";

const analiseOk = (dias: number) =>
  JSON.stringify({
    status: "ok",
    pedida_em: "2026-01-01T00:00:00Z",
    iniciada_em: null,
    analisada_em: new Date(Date.now() - dias * 86400000).toISOString(),
    site: { url: "https://antiga.com.br/", origem: "maps" },
    perfil: { instagram: null, facebook: null, linkedin: null },
    sinais: [],
    paginas: ["https://antiga.com.br/"],
    observacao: null,
    versao: 1,
  });

const candidato = (
  org: string,
  camp: string,
  id: string,
  extra: { status?: string; analise?: string; website?: string } = {},
) =>
  `('${id}','${org}','${camp}','place-${id}',${`'{"key":"place-${id}","name":"Fabrica ${id.slice(-2)}","website":${extra.website ? `"${extra.website}"` : "null"},"emails":[]${extra.analise ? `,"analise":${extra.analise}` : ""}}'`}::jsonb,'${extra.status ?? "new"}')`;

const status = (id: string) =>
  sql(
    `select coalesce(data->'analise'->>'status','—') from prospecting_candidates where id='${id}'`,
  );

beforeAll(() => {
  sql(`insert into organizations(id,slug,legal_name,display_name,status) values
         ('${ORG_A}','sinais-a','A','A','active'),('${ORG_B}','sinais-b','B','B','active'),
         ('${ORG_PARADA}','sinais-p','P','P','suspended');
       insert into prospecting_campaigns(id,organization_id,request_id,name,search,search_status) values
         ('${CAMP_A}','${ORG_A}',gen_random_uuid(),'A','{}','succeeded'),
         ('${CAMP_B}','${ORG_B}',gen_random_uuid(),'B','{}','succeeded'),
         ('${CAMP_P}','${ORG_PARADA}',gen_random_uuid(),'P','{}','succeeded');
       insert into prospecting_candidates(id,organization_id,campaign_id,place_id,data,status) values
         ${candidato(ORG_A, CAMP_A, "5e1c0da0-2222-4000-8000-0000000000a1", { website: "massas.com.br" })},
         ${candidato(ORG_A, CAMP_A, "5e1c0da0-2222-4000-8000-0000000000a2", { status: "skipped" })},
         ${candidato(ORG_A, CAMP_A, "5e1c0da0-2222-4000-8000-0000000000a3", { analise: analiseOk(10) })},
         ${candidato(ORG_A, CAMP_A, "5e1c0da0-2222-4000-8000-0000000000a4", { analise: analiseOk(200) })},
         ${candidato(ORG_B, CAMP_B, "5e1c0da0-2222-4000-8000-0000000000b1")},
         ${candidato(ORG_PARADA, CAMP_P, "5e1c0da0-2222-4000-8000-0000000000c1")};`);
});

describe("fila da análise de sites contra o baseline", () => {
  it("pedir marca só as da campanha, da organização, não recusadas e sem análise válida", async () => {
    expect(await pedirAnaliseDaCampanha(pool, ORG_A, CAMP_A)).toEqual({ pedidas: 2 });
    expect(status("5e1c0da0-2222-4000-8000-0000000000a1")).toBe("pendente");
    expect(status("5e1c0da0-2222-4000-8000-0000000000a2")).toBe("—");
    expect(status("5e1c0da0-2222-4000-8000-0000000000a3")).toBe("ok");
    expect(status("5e1c0da0-2222-4000-8000-0000000000a4")).toBe("pendente");
    // a campanha de outra organização, pedida pela organização A, não muda nada
    expect(await pedirAnaliseDaCampanha(pool, ORG_A, CAMP_B)).toEqual({ pedidas: 0 });
    expect(status("5e1c0da0-2222-4000-8000-0000000000b1")).toBe("—");
    // pedir de novo não repete
    expect(await pedirAnaliseDaCampanha(pool, ORG_A, CAMP_A)).toEqual({ pedidas: 0 });
  });

  it("organização parada não tem a análise reivindicada", async () => {
    await pedirAnaliseDaCampanha(pool, ORG_PARADA, CAMP_P);
    const pegas = await reivindicarPendentes(pool, 10);
    expect(pegas.map((c) => c.id).sort()).toEqual([
      "5e1c0da0-2222-4000-8000-0000000000a1",
      "5e1c0da0-2222-4000-8000-0000000000a4",
    ]);
    expect(status("5e1c0da0-2222-4000-8000-0000000000a1")).toBe("analisando");
    expect(status("5e1c0da0-2222-4000-8000-0000000000c1")).toBe("pendente");
    // já reivindicadas não voltam enquanto não travarem
    expect(await reivindicarPendentes(pool, 10)).toEqual([]);
  });

  it("gravar só vale para quem está sendo analisado; dado anonimizado no meio não volta", async () => {
    const a1 = "5e1c0da0-2222-4000-8000-0000000000a1";
    const a4 = "5e1c0da0-2222-4000-8000-0000000000a4";
    const resultado = JSON.parse(analiseOk(0));
    // a cascata da LGPD reescreve o data inteiro
    sql(
      `update prospecting_candidates set data='{"name":"Cliente Anonimizado #1"}' where id='${a4}'`,
    );
    expect(await gravarAnalise(pool, ORG_A, a4, resultado)).toBe(false);
    expect(sql(`select data::text from prospecting_candidates where id='${a4}'`)).toBe(
      '{"name": "Cliente Anonimizado #1"}',
    );
    // outra organização não grava no candidato de A
    expect(await gravarAnalise(pool, ORG_B, a1, resultado)).toBe(false);
    expect(await gravarAnalise(pool, ORG_A, a1, resultado)).toBe(true);
    expect(status(a1)).toBe("ok");
    // análise fora do formato é recusada antes do banco
    await expect(gravarAnalise(pool, ORG_A, a1, { status: "ok" })).rejects.toThrow();
  });

  it("a rodada lê, grava e devolve a travada à fila", async () => {
    const b1 = "5e1c0da0-2222-4000-8000-0000000000b1";
    await pedirAnaliseDaCampanha(pool, ORG_B, CAMP_B);
    // simula um worker que caiu com a empresa em `analisando` há 15 minutos
    sql(`update prospecting_candidates
            set data = jsonb_set(jsonb_set(data,'{analise,status}','"analisando"'),
                                 '{analise,iniciada_em}', to_jsonb(now() - interval '15 minutes'))
          where id='${b1}'`);
    const ler = async (url: string): Promise<Leitura> => ({ ok: false, url, motivo: "dns" });
    const n = await analisarSitesPendentes(pool, Date.now() + 60_000, { ler });
    expect(n).toBe(1);
    expect(status(b1)).toBe("sem_site");
    expect(
      sql(
        `select data->'analise'->'sinais'->0->>'tipo' from prospecting_candidates where id='${b1}'`,
      ),
    ).toBe("sem_site");
  });
});
