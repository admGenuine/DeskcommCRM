import { afterAll, beforeAll, describe, expect, it } from "vitest";
import pg from "pg";

import { pedirBuscaNoMaps, sincronizarBuscasNoMaps } from "@/lib/prospecting/mercado/maps";
import type { ProvedorDeBusca } from "@/lib/prospecting/provedor";
import { VERSAO_DA_ANALISE } from "@/lib/prospecting/sinais/tipos";

import { sql } from "./gov-helpers";

/**
 * A busca no Maps das empresas do Mercado sem site (Fase 3b do fork da
 * Genuine) contra o baseline que a VPS aplica: a reserva no gasto da campanha
 * (`gasto_maps_usd`, migration 9004), o registro em `data.maps_busca` e a
 * junção `data || mudança` só existem de verdade num Postgres. O provedor é
 * falso: sem rede e sem crédito.
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

const ORG_A = "3a950000-0000-4000-8000-00000000000a";
const ORG_B = "3a950000-0000-4000-8000-00000000000b";
const CAMP_A = "3a950000-1111-4000-8000-00000000000a";
const CAMP_B = "3a950000-1111-4000-8000-00000000000b";
const M1 = "3a950000-2222-4000-8000-0000000000a1"; // achada, com site
const M2 = "3a950000-2222-4000-8000-0000000000a2"; // no Maps aparece outra
const M3 = "3a950000-2222-4000-8000-0000000000a3"; // não achada
const M4 = "3a950000-2222-4000-8000-0000000000a4"; // sem análise ainda: não entra
const M5 = "3a950000-2222-4000-8000-0000000000a5"; // recusada: não entra
const B1 = "3a950000-2222-4000-8000-0000000000b1";

const semSite = {
  status: "sem_site",
  pedida_em: "2026-10-18T00:00:00Z",
  iniciada_em: null,
  analisada_em: "2026-10-18T00:01:00Z",
  site: null,
  perfil: { instagram: null, facebook: null, linkedin: null },
  sinais: [{ tipo: "sem_site", evidencia: "Sem site.", link: null }],
  paginas: [],
  observacao: null,
  versao: VERSAO_DA_ANALISE,
};

const mercado = (
  org: string,
  camp: string,
  id: string,
  nome: string,
  extra: { analise?: object | null; status?: string } = {},
) => {
  const data = {
    key: `cnpj:${id.slice(-12)}00`,
    name: nome,
    razao_social: `${nome} LTDA`,
    phone: "+5543999990000",
    website: null,
    city: "LONDRINA",
    state_code: "PR",
    emails: [],
    socials: [],
    fonte: "mercado",
    porte: "EPP",
    ...(extra.analise === null ? {} : { analise: extra.analise ?? semSite }),
  };
  return `('${id}','${org}','${camp}','cnpj-${id}','${JSON.stringify(data)}'::jsonb,'${extra.status ?? "new"}')`;
};

const campo = (id: string, caminho: string) =>
  sql(`select coalesce(data #>> '${caminho}','—') from prospecting_candidates where id='${id}'`);
const gasto = (camp: string) =>
  Number(sql(`select gasto_maps_usd from prospecting_campaigns where id='${camp}'`));

function provedorFalso(itens: Record<string, unknown>[]) {
  const pedidos: { termos: string[]; teto: number }[] = [];
  let estado = "RUNNING";
  const provedor: ProvedorDeBusca = {
    startSearch: async () => {
      throw new Error("não usado");
    },
    startLookup: async (_chave, termos, teto) => {
      pedidos.push({ termos, teto });
      return { id: `run-${pedidos.length}`, status: "READY" };
    },
    readSearch: async (_chave, id) => ({
      id,
      status: estado,
      defaultDatasetId: "ds-1",
      usageTotalUsd: 0.021,
    }),
    readResults: async () => itens,
  };
  return { provedor, pedidos, terminar: () => (estado = "SUCCEEDED") };
}

beforeAll(() => {
  sql(`insert into organizations(id,slug,legal_name,display_name,status) values
         ('${ORG_A}','maps-a','A','A','active'),('${ORG_B}','maps-b','B','B','active');
       insert into prospecting_campaigns(id,organization_id,request_id,name,search,search_status) values
         ('${CAMP_A}','${ORG_A}',gen_random_uuid(),'A','{}','succeeded'),
         ('${CAMP_B}','${ORG_B}',gen_random_uuid(),'B','{}','succeeded');
       insert into prospecting_candidates(id,organization_id,campaign_id,place_id,data,status) values
         ${mercado(ORG_A, CAMP_A, M1, "IMPERIO DAS AVES")},
         ${mercado(ORG_A, CAMP_A, M2, "MASSAS SERRA")},
         ${mercado(ORG_A, CAMP_A, M3, "LATICINIOS VALE")},
         ${mercado(ORG_A, CAMP_A, M4, "DOCES NONA", { analise: null })},
         ${mercado(ORG_A, CAMP_A, M5, "PAES BELA", { status: "skipped" })},
         ${mercado(ORG_B, CAMP_B, B1, "CAFE MONTE")};`);
});

describe("busca no Maps do Mercado contra o baseline", () => {
  const { provedor, pedidos, terminar } = provedorFalso([
    {
      searchString: "IMPERIO DAS AVES LONDRINA PR",
      title: "Império das Aves",
      placeId: "p1",
      city: "Londrina",
      website: "https://papytobirds.com.br/",
      url: "https://maps.google.com/?cid=1",
      totalScore: 4.6,
      reviewsCount: 87,
    },
    {
      searchString: "MASSAS SERRA LONDRINA PR",
      title: "Padaria do Zé",
      placeId: "p2",
      city: "Londrina",
    },
  ]);

  it("pedir abre UMA execução só com as elegíveis, e reserva o teto da execução", async () => {
    const r = await pedirBuscaNoMaps(pool, {} as never, ORG_A, CAMP_A, new Date(), {
      provedor,
      chave: "k",
    });
    expect(r.pedidas).toBe(3);
    expect(pedidos).toHaveLength(1);
    expect(pedidos[0]!.termos.sort()).toEqual([
      "IMPERIO DAS AVES LONDRINA PR",
      "LATICINIOS VALE LONDRINA PR",
      "MASSAS SERRA LONDRINA PR",
    ]);
    expect(pedidos[0]!.teto).toBe(0.05);
    expect(gasto(CAMP_A)).toBeCloseTo(0.05, 4);
    expect(campo(M1, "{maps_busca,status}")).toBe("buscando");
    expect(campo(M4, "{maps_busca,status}")).toBe("—");
    expect(campo(M5, "{maps_busca,status}")).toBe("—");
    // a outra organização não é tocada, nem pela campanha dela pedida por A
    await expect(
      pedirBuscaNoMaps(pool, {} as never, ORG_A, CAMP_B, new Date(), { provedor, chave: "k" }),
    ).rejects.toThrow("Campanha não encontrada.");
    expect(campo(B1, "{maps_busca,status}")).toBe("—");
    // pedir de novo não reabre: as três já estão procurando
    await expect(
      pedirBuscaNoMaps(pool, {} as never, ORG_A, CAMP_A, new Date(), { provedor, chave: "k" }),
    ).rejects.toThrow("Nenhuma empresa do Mercado sem site");
    expect(pedidos).toHaveLength(1);
  });

  it("execução em andamento não grava nada; terminada, grava cada empresa e troca a reserva pelo custo", async () => {
    expect(
      await sincronizarBuscasNoMaps(pool, {} as never, Date.now() + 60_000, undefined, {
        provedor,
        chave: "k",
      }),
    ).toBe(0);
    expect(campo(M1, "{maps_busca,status}")).toBe("buscando");
    terminar();
    expect(
      await sincronizarBuscasNoMaps(pool, {} as never, Date.now() + 60_000, undefined, {
        provedor,
        chave: "k",
      }),
    ).toBe(3);
    // achada: site, nota, avaliações; o site volta para a análise grátis; o resto do data fica
    expect(campo(M1, "{maps_busca,status}")).toBe("achada");
    expect(campo(M1, "{website}")).toBe("https://papytobirds.com.br/");
    expect(campo(M1, "{reviews}")).toBe("87");
    expect(campo(M1, "{analise,status}")).toBe("pendente");
    expect(campo(M1, "{porte}")).toBe("EPP");
    expect(campo(M1, "{phone}")).toBe("+5543999990000");
    // outra empresa no Maps: nada trocado
    expect(campo(M2, "{maps_busca,status}")).toBe("nao_confere");
    expect(campo(M2, "{maps_busca,titulo}")).toBe("Padaria do Zé");
    expect(campo(M2, "{website}")).toBe("—");
    expect(campo(M2, "{analise,status}")).toBe("sem_site");
    expect(campo(M3, "{maps_busca,status}")).toBe("nao_achada");
    // a reserva de 0,05 virou o custo informado, 0,021, uma vez só
    expect(gasto(CAMP_A)).toBeCloseTo(0.021, 4);
    expect(
      await sincronizarBuscasNoMaps(pool, {} as never, Date.now() + 60_000, undefined, {
        provedor,
        chave: "k",
      }),
    ).toBe(0);
    expect(gasto(CAMP_A)).toBeCloseTo(0.021, 4);
    expect(gasto(CAMP_B)).toBe(0);
  });

  it("perto do teto, não abre execução", async () => {
    sql(`update prospecting_campaigns set gasto_maps_usd = 0.97 where id='${CAMP_B}'`);
    await expect(
      pedirBuscaNoMaps(pool, {} as never, ORG_B, CAMP_B, new Date(), { provedor, chave: "k" }),
    ).rejects.toThrow("teto");
    expect(pedidos).toHaveLength(1);
  });
});
