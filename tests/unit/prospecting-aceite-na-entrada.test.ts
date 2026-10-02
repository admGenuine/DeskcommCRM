import { beforeEach, describe, expect, it, vi } from "vitest";

import type * as Provider from "@/lib/prospecting/provider";

const mocks = vi.hoisted(() => ({
  readSearch: vi.fn(),
  readResults: vi.fn(),
  startSearch: vi.fn(),
}));
vi.mock("@/lib/prospecting/provider", async (original) => ({
  ...(await original<typeof Provider>()),
  readSearch: mocks.readSearch,
  readResults: mocks.readResults,
  startSearch: mocks.startSearch,
}));
vi.mock("@/lib/webhooks/secrets", () => ({
  decryptWebhookSecret: async () => "chave",
  encryptWebhookSecret: async () => "00",
}));
vi.mock("@/app/api/v1/contacts/_handler", () => ({ createContactHandler: vi.fn() }));
vi.mock("@/app/api/v1/leads/_handler", () => ({ createLeadHandler: vi.fn() }));

import { createSearch, synchronizeSearch, type Campaign } from "@/lib/prospecting/store";

const campanha = {
  id: "c1",
  organization_id: "o1",
  run_id: "run1",
  dataset_id: "ds1",
  search: { name: "Teste", niche: "indústria de alimentos", location: "Curitiba, PR", limit: 20, budget_usd: 1, enrich: true },
} as unknown as Campaign;

const item = (placeId: string, extra: Record<string, unknown>) => ({
  title: `Empresa ${placeId}`,
  placeId,
  categoryName: "Fábrica de alimentos",
  address: "R. A, 1 - Centro, Curitiba - PR, 80000-000, Brasil",
  countryCode: "BR",
  ...extra,
});

function banco(
  noCrm: string[] = [],
  emOutraCampanha: { place_id: string; phone: string | null }[] = [],
  gosto: { categoria: string; nota: string | null; referencia: boolean; error: string | null }[] = [],
) {
  const inseridos: { status: string; error: string | null; phone: string | null }[] = [];
  const campanhaAtualizada: unknown[][] = [];
  const db = {
    query: vi.fn(async (sql: string, params: unknown[] = []) => {
      if (sql.startsWith("select credential_encrypted"))
        return { rows: [{ credential_encrypted: Buffer.from("00", "hex") }] };
      if (sql.startsWith("select place_id,phone from prospecting_candidates"))
        return { rows: emOutraCampanha };
      if (sql.includes("p.data->'avaliacao'->>'nota' as nota")) return { rows: gosto };
      if (sql.startsWith("select phone_number from contacts"))
        return {
          rows: (params[1] as string[]).filter((v) => noCrm.includes(v)).map((phone_number) => ({ phone_number })),
        };
      if (sql.startsWith("insert into prospecting_candidates")) {
        inseridos.push({ phone: params[3] as string | null, status: params[5] as string, error: params[6] as string | null });
        return { rowCount: 1, rows: [] };
      }
      if (sql.startsWith("update prospecting_campaigns")) campanhaAtualizada.push([sql, ...params]);
      return { rows: [], rowCount: 0 };
    }),
  };
  return { db, inseridos, campanhaAtualizada };
}

beforeEach(() => vi.clearAllMocks());

describe("entrada da busca: a régua de aceite e o motivo de cada recusa", () => {
  it("aprova a fábrica e recusa padaria, outro estado, 0800 e quem já está no CRM", async () => {
    mocks.readSearch.mockResolvedValue({ id: "run1", status: "SUCCEEDED", defaultDatasetId: "ds1", usageTotalUsd: 0.06 });
    mocks.readResults.mockResolvedValue([
      item("ok", { phone: "(41) 99999-0001" }),
      item("padaria", { phone: "(41) 99999-0002", categoryName: "Padaria" }),
      item("sc", { phone: "(47) 99999-0003", address: "R. B, 2 - Joinville - SC, 89200-000" }),
      item("0800", { phone: "0800 123 4567" }),
      item("crm", { phone: "(41) 99999-0005" }),
    ]);
    const { db, inseridos } = banco(["+5541999990005"]);
    await synchronizeSearch(db as never, {} as never, campanha);
    expect(inseridos.map((i) => [i.status, i.error])).toEqual([
      ["new", null],
      ["skipped", "Categoria fora do perfil: Padaria."],
      ["skipped", "Fora do estado pedido (SC)."],
      ["skipped", "Número de atendimento (0800, 0300, 4003 ou similar)."],
      ["skipped", "Já está no CRM."],
    ]);
  });

  it("busca que estourou o tempo aproveita o que já achou (e já foi pago)", async () => {
    mocks.readSearch.mockResolvedValue({ id: "run1", status: "TIMED-OUT", defaultDatasetId: "ds1" });
    mocks.readResults.mockResolvedValue([item("ok", { phone: "(41) 99999-0001" })]);
    const { db, inseridos, campanhaAtualizada } = banco();
    await synchronizeSearch(db as never, {} as never, campanha);
    expect(inseridos).toHaveLength(1);
    const final = campanhaAtualizada.at(-1)!;
    expect(final[0]).toContain("search_status='succeeded'");
    expect(String(final.at(-1))).toContain("parou antes do fim (TIMED-OUT)");
  });

  it("busca que estourou o tempo sem nada achado continua falhando", async () => {
    mocks.readSearch.mockResolvedValue({ id: "run1", status: "TIMED-OUT", defaultDatasetId: "ds1" });
    mocks.readResults.mockResolvedValue([]);
    const { db, inseridos, campanhaAtualizada } = banco();
    await synchronizeSearch(db as never, {} as never, campanha);
    expect(inseridos).toHaveLength(0);
    expect(campanhaAtualizada.at(-1)![0]).toContain("search_status='failed'");
  });

  it("empresa já em outra campanha não entra e vira aviso, não 'indisponível'", async () => {
    mocks.readSearch.mockResolvedValue({ id: "run1", status: "SUCCEEDED", defaultDatasetId: "ds1" });
    mocks.readResults.mockResolvedValue([
      item("velho1", { phone: "(41) 99999-0001" }),
      item("velho2", { phone: "(41) 99999-0002" }),
      item("novo", { phone: "(41) 99999-0003" }),
    ]);
    const { db, inseridos, campanhaAtualizada } = banco([], [
      { place_id: "velho1", phone: null },
      { place_id: "outro", phone: "+5541999990002" },
    ]);
    await synchronizeSearch(db as never, {} as never, campanha);
    expect(inseridos.map((i) => i.phone)).toEqual(["+5541999990003"]);
    const final = campanhaAtualizada.at(-1)!;
    // skipped_count (indisponível/repetido na própria busca) não leva os de outra campanha
    expect(final.at(-2)).toBe(0);
    expect(final.at(-1)).toBe(
      "2 empresas já estavam em outra campanha e não foram repetidas. O Maps não mostrou mais empresas para este termo e local. Para achar outras, mude o termo ou a cidade.",
    );
  });
});

describe("o gosto do dono na entrada", () => {
  it("categoria que o dono recusou duas vezes, sem nenhum gostei, sai com o motivo", async () => {
    mocks.readSearch.mockResolvedValue({ id: "run1", status: "SUCCEEDED", defaultDatasetId: "ds1" });
    mocks.readResults.mockResolvedValue([
      item("naturais", { phone: "(41) 99999-0001", categoryName: "Loja de produtos naturais", title: "Essenza Indústria" }),
      item("fabrica", { phone: "(41) 99999-0002" }),
    ]);
    const naoGostei = { categoria: "Loja de produtos naturais", nota: "nao_gostei", referencia: false, error: null };
    const { db, inseridos } = banco([], [], [naoGostei, naoGostei]);
    await synchronizeSearch(db as never, {} as never, campanha);
    expect(inseridos.map((i) => [i.status, i.error])).toEqual([
      ["skipped", "Categoria que você marcou como não gostei 2 vezes: Loja de produtos naturais."],
      ["new", null],
    ]);
  });

  it("um gostei na mesma categoria (ou campanha de referência) impede a recusa aprendida", async () => {
    mocks.readSearch.mockResolvedValue({ id: "run1", status: "SUCCEEDED", defaultDatasetId: "ds1" });
    mocks.readResults.mockResolvedValue([
      item("naturais", { phone: "(41) 99999-0001", categoryName: "Loja de produtos naturais", title: "Essenza Indústria" }),
    ]);
    const naoGostei = { categoria: "Loja de produtos naturais", nota: "nao_gostei", referencia: false, error: null };
    const deReferencia = { categoria: "Loja de produtos naturais", nota: null, referencia: true, error: null };
    const { db, inseridos } = banco([], [], [naoGostei, naoGostei, deReferencia]);
    await synchronizeSearch(db as never, {} as never, campanha);
    expect(inseridos.map((i) => i.status)).toEqual(["new"]);
  });
});

describe("busca repetida traz empresas novas", () => {
  const repetida = (limit: number, alcance: number, budget_usd = 1) =>
    ({
      ...campanha,
      search: { ...campanha.search, limit, alcance, budget_usd },
    }) as unknown as Campaign;

  it("lê até o alcance e fica com as primeiras novas, na ordem do Maps, até o limite", async () => {
    mocks.readSearch.mockResolvedValue({ id: "run1", status: "SUCCEEDED", defaultDatasetId: "ds1", usageTotalUsd: 0.03 });
    mocks.readResults.mockResolvedValue([
      item("velho1", { phone: "(41) 99999-0001" }),
      item("novo1", { phone: "(41) 99999-0002" }),
      item("velho2", { phone: "(41) 99999-0003" }),
      item("novo2", { phone: "(41) 99999-0004" }),
      item("novo3", { phone: "(41) 99999-0005" }),
    ]);
    const { db, inseridos, campanhaAtualizada } = banco([], [
      { place_id: "velho1", phone: null },
      { place_id: "velho2", phone: null },
    ]);
    await synchronizeSearch(db as never, {} as never, repetida(2, 5));
    expect(mocks.readResults).toHaveBeenCalledWith("chave", "ds1", 5);
    expect(inseridos.map((i) => i.phone)).toEqual(["+5541999990002", "+5541999990004"]);
    const final = campanhaAtualizada.at(-1)!;
    // a terceira nova sobrou: não é "repetida ou indisponível"
    expect(final.at(-2)).toBe(0);
    expect(final.at(-1)).toBe("2 empresas já estavam em outra campanha e não foram repetidas.");
  });

  it("diz quando foi o teto de gasto que impediu de achar todas as novas", async () => {
    mocks.readSearch.mockResolvedValue({ id: "run1", status: "SUCCEEDED", defaultDatasetId: "ds1", usageTotalUsd: 0.96 });
    mocks.readResults.mockResolvedValue([
      item("velho1", { phone: "(41) 99999-0001" }),
      item("novo1", { phone: "(41) 99999-0002" }),
    ]);
    const { db, inseridos, campanhaAtualizada } = banco([], [{ place_id: "velho1", phone: null }]);
    await synchronizeSearch(db as never, {} as never, repetida(5, 6));
    expect(inseridos).toHaveLength(1);
    expect(String(campanhaAtualizada.at(-1)!.at(-1))).toContain(
      "O teto de gasto (US$ 1.00) acabou antes de a busca achar 5 empresas novas. Aumente o teto para ir mais fundo.",
    );
  });

  it("campanha de antes desta versão (sem alcance) lê só até o limite", async () => {
    mocks.readSearch.mockResolvedValue({ id: "run1", status: "SUCCEEDED", defaultDatasetId: "ds1" });
    mocks.readResults.mockResolvedValue([item("ok", { phone: "(41) 99999-0001" })]);
    const { db } = banco();
    await synchronizeSearch(db as never, {} as never, campanha);
    expect(mocks.readResults).toHaveBeenCalledWith("chave", "ds1", 20);
  });

  it("ao criar, conta as empresas da mesma busca (sem diferenciar acento e caixa) e pede mais fundo", async () => {
    mocks.startSearch.mockResolvedValue({ id: "run9", status: "RUNNING", defaultDatasetId: "ds9" });
    const contagens: unknown[][] = [];
    const inseridas: unknown[] = [];
    const db = {
      release: vi.fn(),
      query: vi.fn(async (sql: string, params: unknown[] = []) => {
        if (sql.includes("pg_try_advisory_lock")) return { rows: [{ locked: true }] };
        if (sql.includes("request_id=$2")) return { rows: [] };
        if (sql.startsWith("select credential_encrypted"))
          return { rows: [{ credential_encrypted: Buffer.from("00", "hex") }] };
        if (sql.startsWith("select id,search from prospecting_campaigns"))
          return {
            rows: [
              { id: "a", search: { niche: "Fábrica de Alimentos", location: "londrina, pr" } },
              { id: "b", search: { niche: "fabrica de alimentos", location: "Londrina, PR" } },
              { id: "c", search: { niche: "distribuidora", location: "Londrina, PR" } },
            ],
          };
        if (sql.startsWith("select count(*)::int as n from prospecting_candidates")) {
          contagens.push(params);
          return { rows: [{ n: 7 }] };
        }
        if (sql.startsWith("insert into prospecting_campaigns")) {
          inseridas.push(params[3]);
          return { rows: [{ id: "nova", organization_id: "o1" }] };
        }
        if (sql.startsWith("select * from prospecting_campaigns where organization_id=$1 and id=$2"))
          return { rows: [{ id: "nova" }] };
        return { rows: [], rowCount: 0 };
      }),
    };
    const pool = { connect: async () => db };
    const search = {
      name: "fábrica de alimentos · Londrina, PR",
      niche: "fábrica de alimentos",
      location: "Londrina, PR",
      limit: 10,
      budget_usd: 1,
      enrich: true,
    };
    await createSearch(pool as never, {} as never, "o1", "req1", search);
    expect(contagens).toEqual([["o1", ["a", "b"]]]);
    expect(inseridas).toEqual([{ ...search, alcance: 17 }]);
    expect(mocks.startSearch).toHaveBeenCalledWith("chave", search, 17);
  });

  it("primeira busca de um termo e local pede só o limite", async () => {
    mocks.startSearch.mockResolvedValue({ id: "run9", status: "RUNNING" });
    const db = {
      release: vi.fn(),
      query: vi.fn(async (sql: string) => {
        if (sql.includes("pg_try_advisory_lock")) return { rows: [{ locked: true }] };
        if (sql.startsWith("select credential_encrypted"))
          return { rows: [{ credential_encrypted: Buffer.from("00", "hex") }] };
        if (sql.startsWith("insert into prospecting_campaigns")) return { rows: [{ id: "nova" }] };
        if (sql.startsWith("select * from prospecting_campaigns where organization_id=$1 and id=$2"))
          return { rows: [{ id: "nova" }] };
        return { rows: [] };
      }),
    };
    const search = { name: "x", niche: "laticínio", location: "Maringá, PR", limit: 10, budget_usd: 1, enrich: true };
    await createSearch({ connect: async () => db } as never, {} as never, "o1", "req2", search);
    expect(mocks.startSearch).toHaveBeenCalledWith("chave", search, 10);
    expect(db.query.mock.calls.some(([sql]) => String(sql).startsWith("select count(*)"))).toBe(false);
  });
});
