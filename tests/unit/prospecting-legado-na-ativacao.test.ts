import { beforeEach, describe, expect, it, vi } from "vitest";
import type pg from "pg";
import type { SupabaseClient } from "@supabase/supabase-js";

/**
 * Fork da Genuine: a régua de aceite do fork encontra a escolha de empresas do
 * original (#1896) dentro de `activateCampaign`.
 *
 * Candidato de antes da régua (sem `aceite` gravado) é reavaliado ao iniciar,
 * e só se o operador o deixou marcado: a desmarcada sai com o motivo do
 * operador, nunca com o da régua. Roda a função de verdade contra um `pg` falso,
 * como `prospeccao-ativacao-respeita-a-selecao.test.ts` do original.
 */

const createContact = vi.fn();
const createLead = vi.fn();
const beginService = vi.fn();
vi.mock("@/app/api/v1/contacts/_handler", () => ({
  createContactHandler: (...a: unknown[]) => createContact(...a),
}));
vi.mock("@/app/api/v1/leads/_handler", () => ({
  createLeadHandler: (...a: unknown[]) => createLead(...a),
}));
vi.mock("@/lib/atendimento/origem", () => ({
  beginServiceAtOrigin: (...a: unknown[]) => beginService(...a),
}));
vi.mock("@/lib/agent-engine/agent/router-config", () => ({
  loadActiveRouter: async () => null,
}));
vi.mock("@/lib/agent-engine/agent/agent-config", () => ({
  loadPublishedAgentConfig: async () => ({ agentId: AGENT }),
}));

const ORG = "00000000-0000-4000-8000-0000000000a1";
const CAMP = "00000000-0000-4000-8000-0000000000a2";
const AGENT = "00000000-0000-4000-8000-0000000000a3";
const PIPE = "00000000-0000-4000-8000-0000000000a5";
const STAGE_A = "00000000-0000-4000-8000-0000000000a6";
const STAGE_B = "00000000-0000-4000-8000-0000000000a7";
const config = {
  agent_id: AGENT,
  channel_session_id: "00000000-0000-4000-8000-0000000000a4",
  pipeline_id: PIPE,
  stage_id: STAGE_A,
  qualified_stage_id: STAGE_B,
  instruction: "Apresente o serviço com calma.",
  qualification: "Tem interesse e orçamento.",
  daily_limit: 10,
  interval_minutes: 15,
  legal_basis_ref: "legítimo interesse",
  funnel_entry: "on_send" as const,
};

const { activateCampaign } = await import("@/lib/prospecting/store");
const { RAZAO_NAO_SELECIONADA } = await import("@/lib/prospecting/schema");

type Linha = Record<string, unknown>;
function fakePool(candidatos: Linha[]) {
  const updates: { sql: string; params: unknown[] }[] = [];
  const responder = (sql: string): Linha[] => {
    if (sql.includes("pg_try_advisory_lock")) return [{ locked: true }];
    if (sql.includes("from ai_agents a join ai_agent_versions"))
      return [{ tool_ids: ["crm_move_lead_stage"], pipeline_ids: [PIPE] }];
    if (sql.includes("from channel_sessions")) return [{ provider: "waha", status: "WORKING" }];
    if (sql.includes("from crm_stages")) return [{ id: STAGE_A }, { id: STAGE_B }];
    if (sql.startsWith("select * from prospecting_campaigns"))
      return [
        {
          id: CAMP,
          name: "C",
          status: "draft",
          search_status: "succeeded",
          config: null,
          search: { name: "C", niche: "fábrica de alimentos", location: "Curitiba, PR", limit: 10 },
        },
      ];
    if (sql.includes("status='running'")) return [];
    if (sql.startsWith("select * from prospecting_candidates")) return candidatos;
    return [];
  };
  const client = {
    query: async (sql: string, params: unknown[] = []) => {
      if (sql.startsWith("update prospecting_candidates")) updates.push({ sql, params });
      return { rows: responder(sql) };
    },
    release: () => {},
  };
  return { pool: { connect: async () => client } as unknown as pg.Pool, updates };
}

/** Candidato de antes da régua: `data` sem `aceite`. */
const legado = (id: string, selected: boolean, phone: string, extra: Linha = {}) => ({
  id,
  campaign_id: CAMP,
  status: "new",
  selected,
  phone,
  contact_id: null,
  lead_id: null,
  data: {
    key: `place-${id}`,
    name: `Fábrica ${id}`,
    phone,
    category: "Fábrica de alimentos",
    ...extra,
  },
});

const motivoDe = (updates: { params: unknown[] }[], id: string) =>
  updates.find((u) => u.params[1] === id)?.params[2];

describe("régua do legado na ativação, depois da escolha do operador", () => {
  beforeEach(() => {
    createContact.mockReset();
    createLead.mockReset();
    beginService.mockReset();
  });

  it("legado marcado com 0800 sai com o motivo da régua e não entra na fila", async () => {
    const { pool, updates } = fakePool([legado("a", true, "+5508001234567")]);
    await activateCampaign(pool, {} as SupabaseClient, ORG, CAMP, config);
    expect(motivoDe(updates, "a")).toBe("Número de atendimento (0800, 0300, 4003 ou similar).");
    expect(updates.some((u) => u.sql.includes("status='queued'"))).toBe(false);
  });

  it("legado fora do estado pedido sai com o motivo da região", async () => {
    const { pool, updates } = fakePool([legado("b", true, "+5548999990001", { state_code: "SC" })]);
    await activateCampaign(pool, {} as SupabaseClient, ORG, CAMP, config);
    expect(motivoDe(updates, "b")).toBe("Fora do estado pedido (SC).");
  });

  it("legado desmarcado sai com o motivo do operador, não com o da régua", async () => {
    const { pool, updates } = fakePool([legado("c", false, "+5508001234567")]);
    await activateCampaign(pool, {} as SupabaseClient, ORG, CAMP, config);
    expect(updates).toHaveLength(1);
    expect(motivoDe(updates, "c")).toBe(RAZAO_NAO_SELECIONADA);
  });

  it("legado bom e marcado entra na fila (modo on_send: sem criar nada no CRM)", async () => {
    const { pool, updates } = fakePool([legado("d", true, "+5541999990002")]);
    await activateCampaign(pool, {} as SupabaseClient, ORG, CAMP, config);
    expect(updates.some((u) => u.sql.includes("status='queued'") && u.params[1] === "d")).toBe(
      true,
    );
    expect(createContact).not.toHaveBeenCalled();
  });
});
