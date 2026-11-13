/**
 * GET /api/v1/campaigns/:id/metricas-por-modelo — enviados, entregues, lidos e
 * falhas de cada modelo de uma campanha que alterna modelos (fork da Genuine,
 * 2026-11-13).
 *
 * Ao lado de `metrics/route.ts`, que não muda. A conta é a de
 * `lib/campanhas/metricas-por-modelo.ts`; as linhas vêm pela sessão (RLS) e com
 * o filtro explícito da organização, como as métricas da campanha. A categoria
 * de cada modelo vem do espelho do número principal, pela fronteira de canal.
 * A situação (ativo ou pulado, e as recusas) vem de `situacao-do-modelo.ts`.
 */
import { randomUUID } from "node:crypto";

import type { NextRequest } from "next/server";

import { fail, ok } from "@/lib/api/wrappers";
import { requireRole } from "@/lib/auth/require-role";
import { lerModeloDaCampanha } from "@/lib/campanhas/modelo-da-campanha";
import {
  metricasPorModelo,
  type CarimbosDoDestinatario,
  type RegistroDoModelo,
} from "@/lib/campanhas/metricas-por-modelo";
import { situacaoDoModelo } from "@/lib/campanhas/situacao-do-modelo";
import { modeloDaConexao } from "@/lib/channels/modelos-da-conexao";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

/** Teto de linhas lidas por chamada, o mesmo das métricas. Acima disso a resposta se declara parcial. */
const TETO = 20_000;

export async function GET(
  _req: NextRequest,
  ctx: { params: Promise<{ id: string }> },
): Promise<Response> {
  const requestId = randomUUID();
  const authz = await requireRole("manager", { requestId, resource: "campaigns" });
  if (!authz.ok) return authz.response;
  const { id } = await ctx.params;
  const org = authz.org.orgId;

  const supabase = await createClient();
  const { data: campanha } = await supabase
    .from("campaigns")
    .select("id, channel_session_id")
    .eq("organization_id", org)
    .eq("id", id)
    .maybeSingle();
  // Campanha de outra organização responde igual a campanha sem modelo: não revela que existe.
  if (!campanha) return ok({ modelos: [], parcial: false }, { requestId });

  const [registros, destinatarios, pulos] = await Promise.all([
    supabase
      .from("campaign_recipient_templates")
      .select("recipient_id, template_name, template_language")
      .eq("organization_id", org)
      .eq("campaign_id", id)
      .limit(TETO),
    supabase
      .from("campaign_recipients")
      .select("id, status, sent_at, delivered_at, read_at, replied_at")
      .eq("organization_id", org)
      .eq("campaign_id", id)
      .limit(TETO),
    // Quantas vezes a plataforma recusou cada modelo nesta campanha (`modelo-indisponivel.ts`).
    supabase
      .from("campaign_template_skips")
      .select("template_name, template_language, motivo, vezes, ultima_em")
      .eq("organization_id", org)
      .eq("campaign_id", id),
  ]);
  if (registros.error) return fail("internal_error", registros.error.message, 500, { requestId });
  if (destinatarios.error) {
    return fail("internal_error", destinatarios.error.message, 500, { requestId });
  }

  const admin = createAdminClient();
  const modelo = await lerModeloDaCampanha(admin, org, id).catch(() => null);
  const canal = (campanha as { channel_session_id: string }).channel_session_id;
  const metricas = metricasPorModelo(
    (registros.data ?? []) as unknown as RegistroDoModelo[],
    (destinatarios.data ?? []) as unknown as CarimbosDoDestinatario[],
    modelo?.itens ?? [],
  );

  const modelos = [];
  for (const m of metricas) {
    const definicao = await modeloDaConexao(admin, {
      organizationId: org,
      channelSessionId: canal,
      name: m.template_name,
      language: m.template_language,
    }).catch(() => null);
    const item = modelo?.itens.find(
      (i) => i.template_name === m.template_name && i.template_language === m.template_language,
    );
    const pulo = (
      (pulos.data ?? []) as Array<{
        template_name: string;
        template_language: string;
        motivo: string;
        vezes: number;
        ultima_em: string | null;
      }>
    ).find(
      (p) => p.template_name === m.template_name && p.template_language === m.template_language,
    );
    modelos.push({
      ...m,
      categoria: definicao?.category ?? null,
      status: definicao?.status ?? null,
      peso: item?.peso ?? null,
      situacao: situacaoDoModelo({
        status: definicao?.status ?? null,
        qualidade: definicao?.qualityScore ?? null,
        pulos: pulo ?? null,
      }),
    });
  }

  return ok(
    {
      modelos,
      parcial: (registros.data ?? []).length >= TETO || (destinatarios.data ?? []).length >= TETO,
    },
    { requestId },
  );
}
