import { randomUUID } from "node:crypto";

import { fail, ok } from "@/lib/api/wrappers";
import { requireRole } from "@/lib/auth/require-role";
import { getRequestPool } from "@/lib/agent-engine/db/request-pool";
import { previaDoMercado } from "@/lib/prospecting/mercado/campanha";
import { filtrosDoMercadoSchema } from "@/lib/prospecting/mercado/filtros";

export const dynamic = "force-dynamic";
const headers = { "Cache-Control": "no-store" };

/**
 * A prévia da aba Mercado (fork da Genuine): quantas empresas o filtro pega,
 * quantas ainda não estão em campanha, as cidades e uma amostra, na ordem em
 * que iriam para a campanha. Só leitura; quem cria a campanha é a ação
 * `market_campaign` de `POST /api/v1/prospecting`.
 *
 * Os filtros vêm em `?filtros=<json>`, validados pelo mesmo schema da criação.
 */
export async function GET(req: Request) {
  const requestId = randomUUID();
  const auth = await requireRole("admin", { requestId, resource: "prospecting" });
  if (!auth.ok) return auth.response;
  let bruto: unknown = {};
  try {
    bruto = JSON.parse(new URL(req.url).searchParams.get("filtros") ?? "{}");
  } catch {
    bruto = null;
  }
  const filtros = filtrosDoMercadoSchema.safeParse(bruto);
  if (!filtros.success)
    return fail("validation_failed", "Confira os filtros do mercado.", 422, { requestId, headers });
  try {
    return ok(await previaDoMercado(getRequestPool(), auth.org.orgId, filtros.data), {
      requestId,
      headers,
    });
  } catch {
    return fail(
      "prospecting_unavailable",
      "Não foi possível consultar o mercado. Tente novamente.",
      500,
      { requestId, headers },
    );
  }
}
