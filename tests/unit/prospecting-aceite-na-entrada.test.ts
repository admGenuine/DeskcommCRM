import { beforeEach, describe, expect, it, vi } from "vitest";

import type * as Provider from "@/lib/prospecting/provider";

const mocks = vi.hoisted(() => ({
  readSearch: vi.fn(),
  readResults: vi.fn(),
}));
vi.mock("@/lib/prospecting/provider", async (original) => ({
  ...(await original<typeof Provider>()),
  readSearch: mocks.readSearch,
  readResults: mocks.readResults,
}));
vi.mock("@/lib/webhooks/secrets", () => ({
  decryptWebhookSecret: async () => "chave",
  encryptWebhookSecret: async () => "00",
}));
vi.mock("@/app/api/v1/contacts/_handler", () => ({ createContactHandler: vi.fn() }));
vi.mock("@/app/api/v1/leads/_handler", () => ({ createLeadHandler: vi.fn() }));

import { synchronizeSearch, type Campaign } from "@/lib/prospecting/store";

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

function banco(noCrm: string[] = [], emOutraCampanha: { place_id: string; phone: string | null }[] = []) {
  const inseridos: { status: string; error: string | null; phone: string | null }[] = [];
  const campanhaAtualizada: unknown[][] = [];
  const db = {
    query: vi.fn(async (sql: string, params: unknown[] = []) => {
      if (sql.startsWith("select credential_encrypted"))
        return { rows: [{ credential_encrypted: Buffer.from("00", "hex") }] };
      if (sql.startsWith("select place_id,phone from prospecting_candidates"))
        return { rows: emOutraCampanha };
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
    expect(final.at(-1)).toBe("2 empresas já estavam em outra campanha e não foram repetidas.");
  });
});
