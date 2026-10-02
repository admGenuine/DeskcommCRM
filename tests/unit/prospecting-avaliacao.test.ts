import { describe, expect, it, vi } from "vitest";

vi.mock("@/app/api/v1/contacts/_handler", () => ({ createContactHandler: vi.fn() }));
vi.mock("@/app/api/v1/leads/_handler", () => ({ createLeadHandler: vi.fn() }));

import { avaliarEmpresa, marcarReferencia } from "@/lib/prospecting/avaliacao";
import { carregarPerfilAprendido } from "@/lib/prospecting/perfil-aprendido";
import { prospectingInputSchema } from "@/lib/prospecting/schema";

const ID = "11111111-1111-4111-8111-111111111111";

function pool(linha: Record<string, unknown> | undefined) {
  const updates: unknown[][] = [];
  const db = {
    release: vi.fn(),
    query: vi.fn(async (sql: string, params: unknown[] = []) => {
      if (sql.includes("pg_try_advisory_lock")) return { rows: [{ locked: true }] };
      if (sql.includes("from prospecting_candidates p")) return { rows: linha ? [linha] : [] };
      if (sql.startsWith("update prospecting_candidates")) updates.push(params);
      return { rows: [], rowCount: 1 };
    }),
  };
  return { pool: { connect: async () => db }, db, updates };
}

describe("avaliar uma empresa", () => {
  it("não gostei tira da fila, grava a avaliação no data e filtra a organização", async () => {
    const { pool: p, updates } = pool({
      id: ID,
      status: "new",
      phone: "+5541999998888",
      error: null,
      anonimizada: false,
      campaign_status: "draft",
    });
    const r = await avaliarEmpresa(p as never, "org1", "user1", {
      id: ID,
      nota: "nao_gostei",
      motivo: "  só revende ",
    });
    expect(r).toMatchObject({
      status: "skipped",
      error: "Você marcou como não gostei: só revende",
    });
    const [org, id, avaliacao, status, error] = updates[0]!;
    expect([org, id, status, error]).toEqual([
      "org1",
      ID,
      "skipped",
      "Você marcou como não gostei: só revende",
    ]);
    expect(JSON.parse(String(avaliacao))).toMatchObject({
      nota: "nao_gostei",
      motivo: "só revende",
      por: "user1",
    });
  });

  it("gostei devolve à fila a empresa que a régua de perfil recusou", async () => {
    const { pool: p, updates } = pool({
      id: ID,
      status: "skipped",
      phone: "+5541999998888",
      error: "Categoria fora do perfil: Padaria.",
      anonimizada: false,
      campaign_status: "draft",
    });
    const r = await avaliarEmpresa(p as never, "org1", "user1", { id: ID, nota: "gostei" });
    expect(r).toMatchObject({
      status: "new",
      error: null,
      avaliacao: { nota: "gostei", motivo: null },
    });
    expect(updates[0]!.slice(3)).toEqual(["new", null]);
  });

  it("empresa de outra organização (ou inexistente) é 404, sem escrever", async () => {
    const { pool: p, updates } = pool(undefined);
    await expect(
      avaliarEmpresa(p as never, "org1", "user1", { id: ID, nota: "gostei" }),
    ).rejects.toMatchObject({
      status: 404,
    });
    expect(updates).toHaveLength(0);
  });

  it("empresa anonimizada não é avaliada", async () => {
    const { pool: p, updates } = pool({
      id: ID,
      status: "skipped",
      phone: null,
      error: null,
      anonimizada: true,
      campaign_status: "draft",
    });
    await expect(
      avaliarEmpresa(p as never, "org1", "user1", { id: ID, nota: "gostei" }),
    ).rejects.toMatchObject({
      status: 409,
    });
    expect(updates).toHaveLength(0);
  });
});

describe("campanha de referência", () => {
  it("marca com motivo e desmarca limpando o motivo, sempre na organização", async () => {
    const chamadas: unknown[][] = [];
    const p = {
      query: vi.fn(async (_sql: string, params: unknown[]) => {
        chamadas.push(params);
        return { rows: [{ id: ID, referencia_em: params[2] ? new Date() : null }] };
      }),
    };
    expect(
      await marcarReferencia(p as never, "org1", {
        id: ID,
        ativa: true,
        motivo: " fábricas médias ",
      }),
    ).toEqual({
      id: ID,
      referencia: true,
    });
    expect(
      await marcarReferencia(p as never, "org1", { id: ID, ativa: false, motivo: "ignorado" }),
    ).toEqual({
      id: ID,
      referencia: false,
    });
    expect(chamadas).toEqual([
      ["org1", ID, true, "fábricas médias"],
      ["org1", ID, false, null],
    ]);
  });

  it("campanha sem busca concluída (ou de outra organização) é 404", async () => {
    const p = { query: vi.fn(async () => ({ rows: [] })) };
    await expect(
      marcarReferencia(p as never, "org1", { id: ID, ativa: true }),
    ).rejects.toMatchObject({ status: 404 });
  });
});

describe("perfil aprendido lido do banco", () => {
  it("lê só a organização e ignora empresa anonimizada", async () => {
    const db = {
      query: vi.fn(async () => ({
        rows: [
          {
            categoria: "Loja de produtos naturais",
            nota: "nao_gostei",
            referencia: false,
            error: null,
          },
          {
            categoria: "Loja de produtos naturais",
            nota: "nao_gostei",
            referencia: false,
            error: null,
          },
          { categoria: "Fabricante de alimentos", nota: null, referencia: true, error: null },
        ],
      })),
    };
    const perfil = await carregarPerfilAprendido(db as never, "org1");
    const [sql, params] = db.query.mock.calls[0] as unknown as [string, unknown[]];
    expect(params).toEqual(["org1"]);
    expect(sql).toContain("p.organization_id = $1");
    expect(sql).toContain("suppression_salt is null");
    expect(perfil.categorias.find((c) => c.categoria === "Loja de produtos naturais")?.recusa).toBe(
      true,
    );
    expect(perfil.de_referencia).toBe(1);
  });
});

describe("entrada da API", () => {
  it.each([
    [{ action: "rate", id: ID, nota: "gostei" }, true],
    [{ action: "rate", id: ID, nota: "nao_gostei", motivo: "x".repeat(300) }, true],
    [{ action: "rate", id: ID, nota: "nao_gostei", motivo: "x".repeat(301) }, false],
    [{ action: "rate", id: ID, nota: "talvez" }, false],
    [{ action: "rate", id: "nao-e-uuid", nota: "gostei" }, false],
    [{ action: "reference", id: ID, ativa: true, motivo: null }, true],
    [{ action: "reference", id: ID }, false],
    [{ action: "reference", id: ID, ativa: true, organization_id: "outra" }, false],
  ])("%j → %s", (body, valido) => {
    expect(prospectingInputSchema.safeParse(body).success).toBe(valido);
  });
});
