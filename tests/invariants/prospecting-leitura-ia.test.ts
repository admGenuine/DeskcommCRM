import { afterAll, beforeAll, describe, expect, it } from "vitest";
import pg from "pg";

import {
  acertarGastoIa,
  gravarLeituraIa,
  lerSitesComIaPendentes,
  pedirLeituraIaDaCampanha,
  reservarGastoIa,
} from "@/lib/prospecting/sinais/fila-ia";
import type { ChamarModelo } from "@/lib/prospecting/sinais/ia";
import type { Leitura } from "@/lib/prospecting/sinais/leitor";
import { buscarNaReceita } from "@/lib/prospecting/sinais/receita";
import { VERSAO_DA_ANALISE } from "@/lib/prospecting/sinais/tipos";

import { sql } from "./gov-helpers";

/**
 * A leitura de sites por IA (Fase 3b do fork da Genuine) contra o baseline que
 * a VPS aplica: o teto por campanha é um UPDATE condicional na coluna
 * `gasto_ia_centavos` (migration 9003), e a leitura mora no jsonb do candidato.
 * Também a busca na Receita, cujo `translate` de acentos só se prova no banco.
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

const ORG_A = "1ea1a000-0000-4000-8000-00000000000a";
const ORG_B = "1ea1a000-0000-4000-8000-00000000000b";
const CAMP_A = "1ea1a000-1111-4000-8000-00000000000a";
const CAMP_B = "1ea1a000-1111-4000-8000-00000000000b";
const A1 = "1ea1a000-2222-4000-8000-0000000000a1";
const A2 = "1ea1a000-2222-4000-8000-0000000000a2";
const A3 = "1ea1a000-2222-4000-8000-0000000000a3";
const A4 = "1ea1a000-2222-4000-8000-0000000000a4";
const B1 = "1ea1a000-2222-4000-8000-0000000000b1";

const analise = (status: string, versao = VERSAO_DA_ANALISE) => ({
  status,
  pedida_em: "2026-10-18T00:00:00Z",
  iniciada_em: null,
  analisada_em: "2026-10-18T00:01:00Z",
  site: status === "ok" ? { url: "https://serra.com.br/", origem: "maps" } : null,
  perfil: { instagram: null, facebook: null, linkedin: null },
  sinais: [],
  paginas: status === "ok" ? ["https://serra.com.br/"] : [],
  observacao: null,
  versao,
});

const candidato = (org: string, camp: string, id: string, a: object, st = "new") =>
  `('${id}','${org}','${camp}','place-${id}','${JSON.stringify({ key: `place-${id}`, name: "Laticínios Serra", emails: [], analise: a })}'::jsonb,'${st}')`;

const ia = (id: string, campo = "status") =>
  sql(
    `select coalesce(data->'analise'->'ia'->>'${campo}','—') from prospecting_candidates where id='${id}'`,
  );
const gasto = (camp: string) =>
  Number(sql(`select gasto_ia_centavos from prospecting_campaigns where id='${camp}'`));

beforeAll(() => {
  sql(`insert into organizations(id,slug,legal_name,display_name,status) values
         ('${ORG_A}','ia-a','A','A','active'),('${ORG_B}','ia-b','B','B','active');
       insert into prospecting_campaigns(id,organization_id,request_id,name,search,search_status) values
         ('${CAMP_A}','${ORG_A}',gen_random_uuid(),'A','{}','succeeded'),
         ('${CAMP_B}','${ORG_B}',gen_random_uuid(),'B','{}','succeeded');
       insert into prospecting_candidates(id,organization_id,campaign_id,place_id,data,status) values
         ${candidato(ORG_A, CAMP_A, A1, analise("ok"))},
         ${candidato(ORG_A, CAMP_A, A2, analise("sem_site"))},
         ${candidato(ORG_A, CAMP_A, A3, analise("ok", 1))},
         ${candidato(ORG_A, CAMP_A, A4, analise("ok"), "skipped")},
         ${candidato(ORG_B, CAMP_B, B1, analise("ok"))};`);
});

describe("leitura por IA contra o baseline", () => {
  it("a campanha nasce com gasto zero (coluna da migration 9003)", () => {
    expect(gasto(CAMP_A)).toBe(0);
  });

  it("pedir marca só o site lido pela análise atual, não recusado, da própria organização", async () => {
    expect(await pedirLeituraIaDaCampanha(pool, ORG_A, CAMP_A)).toEqual({ pedidas: 1 });
    expect(ia(A1)).toBe("pendente");
    expect(ia(A2)).toBe("—"); // sem site
    expect(ia(A3)).toBe("—"); // análise de versão antiga: refazer a grátis antes
    expect(ia(A4)).toBe("—"); // recusada
    // a campanha de outra organização não existe para A
    await expect(pedirLeituraIaDaCampanha(pool, ORG_A, CAMP_B)).rejects.toThrow(
      "Campanha não encontrada.",
    );
    expect(ia(B1)).toBe("—");
    // pedir de novo não repete
    expect(await pedirLeituraIaDaCampanha(pool, ORG_A, CAMP_A)).toEqual({ pedidas: 0 });
  });

  it("a rodada lê, grava resumo e sinal novo, e troca a reserva pelo custo real", async () => {
    const ler = async (url: string): Promise<Leitura> => ({
      ok: true,
      url,
      status: 200,
      html: "<p>Queijos artesanais. Buscamos representantes comerciais em todo o Sul.</p>",
    });
    const chamarModelo: ChamarModelo = async () => ({
      texto: JSON.stringify({
        resumo: "Fabrica queijos artesanais.",
        produtos: ["Queijos"],
        sinais: [
          { tipo: "procura_distribuidor", trecho: "Buscamos representantes comerciais", pagina: 1 },
        ],
      }),
      custoCentavos: 0.75,
      modelo: "modelo-barato",
      tokensDeEntrada: 500,
      tokensDeSaida: 80,
    });
    expect(await lerSitesComIaPendentes(pool, Date.now() + 120_000, { ler, chamarModelo })).toBe(1);
    expect(ia(A1)).toBe("ok");
    expect(ia(A1, "resumo")).toBe("Fabrica queijos artesanais.");
    expect(
      sql(`select data->'analise'->'sinais'->0->>'fonte' from prospecting_candidates where id='${A1}'`),
    ).toBe("ia");
    expect(gasto(CAMP_A)).toBeCloseTo(0.75, 4);
    expect(gasto(CAMP_B)).toBe(0);
  });

  it("o teto: só reserva o que cabe, e a leitura fora dele para com o porquê", async () => {
    sql(`update prospecting_campaigns set gasto_ia_centavos = 96 where id='${CAMP_B}'`);
    expect(await reservarGastoIa(pool, ORG_B, CAMP_B)).toBe(true); // 96 + 3 = 99
    expect(await reservarGastoIa(pool, ORG_B, CAMP_B)).toBe(false); // 99 + 3 > 100
    // a organização A não reserva no gasto da campanha de B
    expect(await reservarGastoIa(pool, ORG_A, CAMP_B)).toBe(false);
    await acertarGastoIa(pool, ORG_B, CAMP_B, 0); // modelo não chamado: devolve a reserva
    expect(gasto(CAMP_B)).toBe(96);
    // perto do teto, nem pedir dá
    sql(`update prospecting_campaigns set gasto_ia_centavos = 98 where id='${CAMP_B}'`);
    await expect(pedirLeituraIaDaCampanha(pool, ORG_B, CAMP_B)).rejects.toThrow("teto");
    // e a leitura que já estava na fila para no teto, sem chamar o modelo
    sql(`update prospecting_candidates
            set data = jsonb_set(data,'{analise,ia}','{"status":"pendente","pedida_em":"2026-10-18T00:00:00Z","iniciada_em":null,"lida_em":null,"resumo":null,"produtos":[],"sinais_novos":0,"custo_centavos":0,"modelo":null,"observacao":null}')
          where id='${B1}'`);
    let chamou = false;
    await lerSitesComIaPendentes(pool, Date.now() + 120_000, {
      chamarModelo: async () => {
        chamou = true;
        throw new Error("não devia chamar");
      },
    });
    expect(chamou).toBe(false);
    expect(ia(B1)).toBe("teto");
    expect(ia(B1, "observacao")).toContain("US$ 1.00");
    expect(gasto(CAMP_B)).toBe(98);
  });

  it("gravar só vale para quem está sendo lido; dado anonimizado no meio não volta", async () => {
    sql(`update prospecting_candidates set data='{"name":"Cliente Anonimizado #1"}' where id='${A4}'`);
    const leitura = JSON.parse(
      sql(`select data->'analise'->>'ia' from prospecting_candidates where id='${A1}'`),
    );
    expect(await gravarLeituraIa(pool, ORG_A, A4, leitura)).toBe(false);
    expect(sql(`select data::text from prospecting_candidates where id='${A4}'`)).toBe(
      '{"name": "Cliente Anonimizado #1"}',
    );
  });
});

describe("busca na Receita contra o baseline", () => {
  beforeAll(() => {
    sql(`insert into prospecting_market_companies
           (cnpj,cnpj_basico,matriz,razao_social,nome_fantasia,cnae_principal,recorte_pela_principal,
            uf,municipio,telefone1,porte,referencia)
         values
           ('99887766000155','99887766',true,'IMPERIO DAS AVES INDUSTRIA E COMERCIO DE ALIMENTOS LTDA',
            null,'1012101',true,'PR','SAO JOSE DOS PINHAIS','4133334444','EPP','2026-10'),
           ('11223344000155','11223344',true,'IMPERIO DAS AVES LTDA',null,'1012101',true,
            'PR','LONDRINA',null,'DEMAIS','2026-10')
         on conflict (cnpj) do nothing;`);
  });

  it("acha pela cidade com acento do Maps e pelo telefone, só na mesma cidade", async () => {
    const achado = await buscarNaReceita(pool, {
      name: "Papyto Birds",
      phone: "+554133334444",
      city: "São José dos Pinhais",
      state_code: "pr",
    });
    expect(achado).toMatchObject({ cnpj: "99887766000155", porte: "EPP", criterio: "telefone" });
    // pelo nome, em Londrina, acha a de Londrina, e não a homônima da outra cidade
    expect(
      await buscarNaReceita(pool, {
        name: "Império das Aves",
        phone: null,
        city: "Londrina",
        state_code: "PR",
      }),
    ).toMatchObject({ cnpj: "11223344000155", criterio: "nome" });
    expect(
      await buscarNaReceita(pool, {
        name: "Império das Aves",
        phone: null,
        city: "Maringá",
        state_code: "PR",
      }),
    ).toBeNull();
  });
});
