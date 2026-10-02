import { z } from "zod";

import { ufDoLugar } from "./aceite/regiao";
import { avaliarTelefoneBR } from "./aceite/telefone";
import { NOTAS, type Avaliacao } from "./aprendizado";

export const campaignConfigSchema = z
  .object({
    agent_id: z.string().uuid(),
    channel_session_id: z.string().uuid(),
    pipeline_id: z.string().uuid(),
    stage_id: z.string().uuid(),
    qualified_stage_id: z.string().uuid(),
    instruction: z.string().trim().min(10).max(2000),
    qualification: z.string().trim().min(10).max(2000),
    daily_limit: z.number().int().min(1).max(50).default(10),
    interval_minutes: z.number().int().min(5).max(1440).default(15),
    legal_basis_ref: z.string().trim().min(3).max(500),
  })
  .strict();
export const searchSchema = z
  .object({
    name: z.string().trim().min(2).max(120),
    niche: z.string().trim().min(2).max(120),
    location: z.string().trim().min(2).max(160),
    limit: z.number().int().min(1).max(100).default(20),
    budget_usd: z.number().min(0.5).max(10).default(1),
    enrich: z.boolean().default(true),
  })
  .strict();
export const prospectingInputSchema = z.discriminatedUnion("action", [
  z
    .object({ action: z.literal("configure"), api_key: z.string().trim().min(10).max(500) })
    .strict(),
  z
    .object({ action: z.literal("search"), search: searchSchema, request_id: z.string().uuid() })
    .strict(),
  z
    .object({ action: z.literal("start"), id: z.string().uuid(), config: campaignConfigSchema })
    .strict(),
  z.object({ action: z.literal("pause"), id: z.string().uuid() }).strict(),
  z.object({ action: z.literal("resume"), id: z.string().uuid() }).strict(),
  // O dono avalia uma empresa (`aprendizado.ts`).
  z
    .object({
      action: z.literal("rate"),
      id: z.string().uuid(),
      nota: z.enum(NOTAS),
      motivo: z.string().trim().max(300).nullish(),
    })
    .strict(),
  // O dono marca (ou desmarca) a campanha como referência do perfil ideal.
  z
    .object({
      action: z.literal("reference"),
      id: z.string().uuid(),
      ativa: z.boolean(),
      motivo: z.string().trim().max(300).nullish(),
    })
    .strict(),
]);
export type CampaignConfig = z.infer<typeof campaignConfigSchema>;
export type SearchInput = z.infer<typeof searchSchema>;
export interface Prospect {
  key: string;
  name: string;
  phone: string | null;
  /** `celular` ou `fixo` quando o telefone passou na régua; `null` quando não passou. */
  phone_kind?: "celular" | "fixo" | null;
  /** Por que o telefone foi recusado (`lib/prospecting/aceite/telefone.ts`). */
  phone_issue?: string | null;
  website: string | null;
  category: string | null;
  /** Todas as categorias do lugar no Maps; a régua de segmento lê para salvar fábrica. */
  categories?: string[];
  address: string | null;
  city?: string | null;
  /** UF do lugar (`aceite/regiao.ts`), `null` quando não dá para saber. */
  state_code?: string | null;
  country_code?: string | null;
  maps_url: string | null;
  rating: number | null;
  reviews: number | null;
  emails: string[];
  socials: string[];
  /** Veredito da régua de aceite gravado na entrada; ausente em candidato de antes da régua. */
  aceite?: { aprovado: boolean; motivo?: string };
  /** A avaliação do dono ("gostei" / "não gostei"), ausente até ele avaliar. */
  avaliacao?: Avaliacao;
}

/** Telefone pela régua de `aceite/telefone.ts`; número estrangeiro nunca vira brasileiro. */
export function normalizeProspect(item: Record<string, unknown>): Prospect | null {
  const str = (key: string, limit = 500) =>
    typeof item[key] === "string" ? (item[key] as string).trim().slice(0, limit) : null;
  const name = str("title", 200);
  const place = str("placeId", 200);
  if (!name || !place || item.permanentlyClosed === true || item.temporarilyClosed === true)
    return null;
  const telefone = avaliarTelefoneBR(str("phoneUnformatted") || str("phone"));
  const phone = telefone.ok ? telefone.e164 : null;
  const urls = (key: string) =>
    Array.isArray(item[key])
      ? (item[key] as unknown[])
          .filter((v): v is string => typeof v === "string" && v.length < 500)
          .slice(0, 5)
      : [];
  return {
    key: place,
    name,
    phone,
    phone_kind: telefone.ok ? telefone.tipo : null,
    phone_issue: telefone.ok ? null : telefone.motivo,
    website: str("website"),
    category: str("categoryName"),
    categories: urls("categories"),
    address: str("address"),
    city: str("city", 120),
    state_code: ufDoLugar(str("address"), str("state", 120)),
    country_code: str("countryCode", 4),
    maps_url: str("url"),
    rating: typeof item.totalScore === "number" ? item.totalScore : null,
    reviews: typeof item.reviewsCount === "number" ? item.reviewsCount : null,
    emails: urls("emails"),
    socials: ["instagrams", "facebooks", "linkedIns"].flatMap(urls),
  };
}

export function safePublicLink(value: string | null): string | undefined {
  try {
    const u = new URL(value ?? "");
    return ["http:", "https:"].includes(u.protocol) ? u.href : undefined;
  } catch {
    return undefined;
  }
}

/** Public business context shared by prospecting and the Inbox; no raw provider payload. */
export const prospectEnrichmentSchema = z.object({
  name: z.string().max(200),
  category: z.string().max(500).nullable(),
  address: z.string().max(500).nullable(),
  website: z.string().max(500).nullable(),
  maps_url: z.string().max(500).nullable(),
  rating: z.number().min(0).max(5).nullable(),
  reviews: z.number().int().nonnegative().nullable(),
  emails: z.array(z.string().max(500)).max(5),
  socials: z.array(z.string().max(500)).max(15),
});
export type ProspectEnrichment = z.infer<typeof prospectEnrichmentSchema>;
